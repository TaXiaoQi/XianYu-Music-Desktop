# 音效系统重新实现计划（rodio 引擎特性 + Freeverb）

## 摘要

按 rodio 引擎特性（`Source` 是逐样本 `Iterator`，音频回调必须**无锁、无分配、无 I/O**）重新实现混响与跨线程参数同步，根除反复出现的卡爆 / 音爆 / 切换预设爆音问题。

核心三改：
1. **混响**：FFT 分块卷积（`PartitionedConvolver`）→ **Freeverb（Schroeder/Moorer）算法**。8 并联梳状 + 4 串联全通，每样本 O(1)，无 FFT / 无 IR / 无重建 / 无缓存 / 无预构建。
2. **跨线程同步**：`Arc<Mutex<Settings>> + dirty AtomicBool + try_lock` → **`Arc<ArcSwap<Settings>>`** 无锁读取，`Arc::ptr_eq` 检测变更。
3. **音频线程违规清理**：移除 `channels()/sample_rate()/current_frame_len()` 内的 `eprintln!`（cpal 在音频线程调用这些，stderr I/O 阻塞）；移除 `SoundEffectSource::new()` 中的后台 `prebuild_all` 线程。

不动：`pitch.rs` / `channel.rs` / `shaper.rs` / `dynamics.rs` / `modulation.rs` / `spatial.rs`（非报障点，保留现有实现，仅验证热路径无分配）。

---

## 当前状态分析（Phase 1 探查结论）

### 文件与状态
| 文件 | 当前实现 | 问题 |
|---|---|---|
| [reverb.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs) | FFT 卷积（`PartitionedConvolver`）+ 全局 `CONV_CACHE`(`Mutex`) + `Drop` 保存 + `prebuild_all` | 音频线程每帧做 FFT；`update_params` 在音频线程 `try_lock` + 重建 86 FFT 分区（2-5ms 阻塞→爆音） |
| [mod.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs) L471-489 | `Arc<Mutex<Settings>>` + `AtomicBool dirty` + 每 64 帧 `try_lock` | Mutex 锁开销；争用时跳过更新；`dirty` 双重机制冗余 |
| mod.rs L750-783 | `channels()/sample_rate()/current_frame_len()` 内 `eprintln!`（用 `static AtomicBool::swap` 控制只打印一次） | cpal/rodio 在**音频线程**调用这些方法，`eprintln!` 走 stderr 是阻塞 I/O → 卡顿 |
| mod.rs L565-572 | `SoundEffectSource::new` 中 `std::thread::spawn(reverb::prebuild_all)` | 后台线程与音频线程竞争；Freeverb 后无需预构建 |
| [convolution.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/convolution.rs) | 分块 FFT 卷积（块 1024，FFT 2048） | 仅被 reverb.rs 引用；Freeverb 后成死代码 |
| [ir_loader.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/ir_loader.rs) | 嵌入 13 个 wav IR + 9 个算法 IR 生成，hound 解码 | 仅被 reverb.rs `build_convolver` 引用；Freeverb 后成死代码 |
| [Cargo.toml](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/Cargo.toml) L56-57 | `rustfft=6.4.1`, `hound=3.5` | 仅被 convolution.rs / ir_loader.rs 使用；移除后可删依赖 |

### 构造与写入点（保持 API 兼容）
- 主链构造：[runtime.rs:733-759](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/runtime.rs) `normalized_source → Equalizer → SoundEffectSource → UserVolumeSource → ClipGuardSource → TimedSource → sink.append`
- Handle 创建：[runtime.rs:997-1004](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/runtime.rs)
- UI 写入：[runtime.rs:1400-1404](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/runtime.rs) `AudioCommand::SetSoundEffectSettings → thread_se_handle.set_settings(settings)`
- 设备恢复重建：[output/shared.rs:135-146](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/output/shared.rs)

→ 结论：`SoundEffectHandle` 的对外方法 `new()` / `set_settings()` 签名不变，`SoundEffectSource::new(inner, handle)` 签名不变，`process(&mut [f32], u16, &Settings)` 签名不变。**前端 API、runtime.rs、output/shared.rs 无需改动。**

---

## 提议改动

### 改动 1：Cargo.toml — 添加 arc-swap，移除 rustfft/hound

**文件**：[Cargo.toml](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/Cargo.toml)

- L56 删除 `rustfft = "6.4.1"`
- L57 删除 `hound = "3.5"`
- 在依赖区添加 `arc-swap = "1"`
- L71-74 `[profile.dev] opt-level = 1` 注释更新（原因为卷积内循环；Freeverb 无 FFT 内循环，但保留 opt-level=1 对 DSP 整体有益，**保留该配置**，仅改注释说明用途泛化为 DSP 热路径）

**前提**：先执行 `rg -n "rustfft|hound" src/` 确认仅 convolution.rs / ir_loader.rs 使用（探查已确认），方可删除依赖。

### 改动 2：reverb.rs — 完全重写为 Freeverb

**文件**：[reverb.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs)（全文重写）

**算法**：标准 Freeverb（Jezar @ Dreampoint / STK FreeVerb 实现），44100Hz 调谐常量，按采样率线性缩放延迟长度。

**结构**：

```rust
//! 混响机架 —— Freeverb（Schroeder/Moorer）算法实现。
//! 每声道：8 并联低通反馈梳状滤波器 + 4 串联全通滤波器。
//! 每样本 O(1)，无 FFT / 无 IR / 无重建 / 无缓存 / 无预构建。
//! 22 个预设映射到 (room_size, damping, width, input_gain) 参数组合。

use super::dsp::{SmoothedValue, soft_clip};
use super::{ReverbKind, SoundEffectSettings};

const FIXED_GAIN: f32 = 0.015;      // 输入增益（补偿 8 梳状并联求和）
const SCALE_WET: f32 = 3.0;
const SCALE_DRY: f32 = 2.0;
const SCALE_DAMP: f32 = 0.4;
const SCALE_ROOM: f32 = 0.28;
const OFFSET_ROOM: f32 = 0.7;
const ALLPASS_FEEDBACK: f32 = 0.5;
const LIMITER_CEILING: f32 = 0.9;

// 44100Hz 调谐的梳状/全通延迟长度（标准 Freeverb 常量）
const COMB_L: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const COMB_R: [usize; 8] = [1139, 1211, 1300, 1379, 1445, 1514, 1580, 1640]; // +23 立体声扩散
const ALLPASS_L: [usize; 4] = [556, 441, 341, 225];
const ALLPASS_R: [usize; 4] = [579, 464, 364, 248]; // +23
const STEREO_SPREAD: usize = 23;

struct Comb { buffer: Vec<f32>, idx: usize, feedback: f32, filter_store: f32, damp1: f32, damp2: f32 }
struct AllPass { buffer: Vec<f32>, idx: usize, feedback: f32 }

impl Comb {
    fn new(len: usize) -> Self { Self { buffer: vec![0.0; len], idx:0, feedback:0.5, filter_store:0.0, damp1:0.5, damp2:0.5 } }
    #[inline] fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.idx];
        self.filter_store = output * self.damp2 + self.filter_store * self.damp1;
        self.buffer[self.idx] = input + self.filter_store * self.feedback;
        self.idx = if self.idx + 1 >= self.buffer.len() { 0 } else { self.idx + 1 };
        output
    }
    fn clear(&mut self) { self.buffer.fill(0.0); self.idx = 0; self.filter_store = 0.0; }
}
impl AllPass {
    fn new(len: usize) -> Self { Self { buffer: vec![0.0; len], idx: 0, feedback: ALLPASS_FEEDBACK } }
    #[inline] fn process(&mut self, input: f32) -> f32 {
        let bufout = self.buffer[self.idx];
        let output = -input + bufout;
        self.buffer[self.idx] = input + bufout * self.feedback;
        self.idx = if self.idx + 1 >= self.buffer.len() { 0 } else { self.idx + 1 };
        output
    }
    fn clear(&mut self) { self.buffer.fill(0.0); self.idx = 0; }
}

pub struct ReverbRack {
    sample_rate: f32,
    channels: usize,
    enabled: SmoothedValue,
    combs_l: [Comb; 8],
    combs_r: [Comb; 8],
    allpass_l: [AllPass; 4],
    allpass_r: [AllPass; 4],
    cur_preset: String,
    cur_kind: ReverbKind,
    room_size: f32,
    damping: f32,
    width: f32,
    input_gain: f32,
    limiter_gain: f32,
}
```

**关键方法**：

- `new()` → `prepare(44100, 2)` 初始化（梳状/全通按 44100 创建；`prepare()` 会按真实采样率重建长度）。
- `prepare(sample_rate, channels)` → 按采样率缩放延迟长度：`scale_len(base) = max(1, round(base * sr / 44100))`；`channels!=2` 时退化为单声道（combs_r 不用）。**所有 Vec 在此一次性分配，热路径零分配。**
- `reset()` → 所有 comb/allpass `clear()`，`limiter_gain=1.0`。
- `update_params(&Settings)`：
  - `active = reverb_kind != None && !reverb_preset.is_empty()`；`enabled.set_target(if active {1.0} else {0.0})`。
  - 查表得到预设参数 `(room, damp, width, gain_boost)`（见映射表）。
  - 仅当 `room_size/damping/width/input_gain` 变化时重算 comb 系数：`feedback = room * SCALE_ROOM + OFFSET_ROOM`（范围 0.70-0.98）；`damp1 = damp * SCALE_DAMP`（damp2 = 1-damp1）。**重算系数只改字段，不重建 Vec，不分配，O(1)。**
  - 不再做任何 `try_lock` / 缓存 / IR 加载 / FFT。
- `process(&mut [f32], u16, &Settings)`：
  - `w = enabled.tick()`；`w < 0.001` 直通。
  - `input_l = frame[0]*FIXED_GAIN*input_gain`；`input_r = frame[1]*FIXED_GAIN*input_gain`（单声道时 input_r = input_l）。
  - L 通路：8 comb 并联求和 → 4 allpass 串联 → `out_l`；R 通路同理 → `out_r`。
  - 干湿混合（保留现有 dry/wet 语义与平滑）：
    ```
    dry_gain = 1.0 + (s.reverb_dry - 1.0) * w   // w=0 → 1.0(bypass), w=1 → s.reverb_dry
    wet = s.reverb_wet * w
    wet1 = wet * (width*0.5 + 0.5)
    wet2 = wet * (width*0.5 - 0.5)
    wet_out_l = out_l*wet1 + out_r*wet2
    wet_out_r = out_r*wet1 + out_l*wet2
    mixed_l = frame[0]*dry_gain + wet_out_l   // frame[0] 是原始输入(卷积前)
    mixed_r = frame[1]*dry_gain + wet_out_r
    ```
    注意：必须先保存原始 `frame[0]/frame[1]`（参考现 reverb.rs L201-202 `in_l/in_r`），因为 dry 路径用原始输入而非处理后值。
  - 砖墙限制器（保留现 reverb.rs L228-241 逻辑，已验证有效）：瞬时峰值 → `target_gain = ceiling/peak`，attack 0.5/release 0.0005，`comp = 1.0+(limiter_gain-1.0)*w`。
  - `frame[0] = soft_clip(mixed_l*comp)`；`frame[1] = soft_clip(mixed_r*comp)`。

**移除**：`CONV_CACHE` / `conv_cache()` / `save_convolver_to_cache()` / `impl Drop` / `build_convolver()` / `prebuild_all()` / `ALL_PRESETS` / 对 `ir_loader`、`convolution`、`PartitionedConvolver` 的全部引用。

**预设 → Freeverb 参数映射表**（`room_size` 0-1, `damping` 0-1, `width` 0-1, `input_gain` 倍率）：

| preset | room | damp | width | gain | 风格说明 |
|---|---|---|---|---|---|
| phone | 0.15 | 0.85 | 0.0 | 1.0 | 小+暗(电话) |
| church | 0.95 | 0.20 | 1.0 | 1.0 | 大+亮(教堂) |
| hall | 0.85 | 0.30 | 1.0 | 1.0 | 大厅 |
| cinema | 0.75 | 0.40 | 0.8 | 1.0 | 影院 |
| restaurant | 0.45 | 0.60 | 0.6 | 1.0 | 中+暗 |
| bathroom | 0.30 | 0.50 | 0.5 | 1.0 | 小浴室 |
| room | 0.40 | 0.50 | 0.7 | 1.0 | 房间 |
| stereo | 0.60 | 0.30 | 1.0 | 1.0 | 立体声 |
| matrixReverb1 | 0.70 | 0.25 | 0.9 | 1.0 | 矩阵1 |
| matrixReverb2 | 0.80 | 0.35 | 0.9 | 1.0 | 矩阵2 |
| cardioidSpread | 0.55 | 0.35 | 0.85 | 1.0 | 心形扩散 |
| magneticStereo | 0.65 | 0.40 | 0.95 | 1.0 | 磁性立体声 |
| feedbackSuppressor | 0.50 | 0.70 | 0.6 | 1.0 | 高阻尼抑反馈 |
| algoStudio | 0.40 | 0.30 | 0.8 | 1.0 | 录音室 |
| algoHall | 0.90 | 0.25 | 1.0 | 1.0 | 大厅 |
| algoBathroom | 0.25 | 0.55 | 0.5 | 1.0 | 浴室 |
| algoTunnel | 0.98 | 0.10 | 1.0 | 1.0 | 隧道(长+亮) |
| algoValley | 1.00 | 0.05 | 1.0 | 1.0 | 山谷(极大) |
| algoMetal | 0.60 | 0.05 | 0.4 | 1.2 | 金属(亮) |
| algoPlate | 0.55 | 0.15 | 0.7 | 1.1 | 板式 |
| algoSpring | 0.50 | 0.20 | 0.5 | 1.1 | 弹簧 |
| algoPreDelay | 0.75 | 0.30 | 0.9 | 1.0 | 预延迟(用稍大 room 模拟) |

实现为 `fn preset_params(kind: &ReverbKind, preset: &str) -> (f32,f32,f32,f32)`，`match` 返回；未匹配返回 `(0.5, 0.5, 1.0, 1.0)` 默认。

### 改动 3：mod.rs — ArcSwap 无锁同步 + 移除音频线程日志 + 移除预构建线程

**文件**：[mod.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs)

**3a. SoundEffectHandle 改为 ArcSwap**（L471-490）：

```rust
use arc_swap::ArcSwap;
use std::sync::Arc;

pub struct SoundEffectHandle {
    pub settings: Arc<ArcSwap<SoundEffectSettings>>,
}

impl SoundEffectHandle {
    pub fn new(settings: SoundEffectSettings) -> Self {
        Self { settings: Arc::new(ArcSwap::from_pointee(settings)) }
    }
    pub fn set_settings(&self, new_settings: SoundEffectSettings) {
        self.settings.store(Arc::new(new_settings));
    }
    /// 音频线程用：无锁加载当前快照
    pub fn load(&self) -> arc_swap::Guard<Arc<SoundEffectSettings>> {
        self.settings.load()
    }
}
```

移除 `Arc<Mutex<...>>`、`AtomicBool dirty`、`use std::sync::atomic::{AtomicBool, Ordering}` 中相关项（`Ordering` 若仍被其他原子用则保留）。

**3b. SoundEffectSource 增加 `last_loaded: Arc<SoundEffectSettings>` 字段**（L496-524）：用于 `Arc::ptr_eq` 检测变更。`new()` 中初始化为 `handle.load()` 的 clone。

**3c. sync_settings 改为无锁**（L656-672）：

```rust
fn sync_settings(&mut self) {
    self.frame_counter += 1;
    if self.frame_counter < 64 { return; }
    self.frame_counter = 0;
    let cur = self.handle.settings.load_full();      // 无锁
    if Arc::ptr_eq(&cur, &self.last_loaded) { return; }  // 指针相同=无变更
    self.last_loaded = cur.clone();
    let s = (*cur).clone();
    self.settings = s.clone();
    self.apply_params(&s);
}
```

移除 `try_lock` / `dirty.store`。

**3d. 移除音频线程 `eprintln!`**（L750-783）：删除 `channels()` / `sample_rate()` / `current_frame_len()` 内的 `static AtomicBool/AtomicU64` + `eprintln!` 全部诊断代码，方法体只保留 `self.channels` / `self.pitch.effective_sample_rate(...)` / `self.inner.current_frame_len()`。如需启动诊断，改为在 `SoundEffectSource::new()` 末尾打印一次（构造发生在非音频线程）。

**3e. 移除后台预构建线程**（L565-572）：删除 `std::thread::spawn(move || reverb::prebuild_all(...))` 整段。Freeverb 无需预构建。

**3f. 模块声明**（L21-30）：删除 `pub mod convolution;` 与 `pub mod ir_loader;`（若改动 5 选择删除文件）。保留 `pub mod channel/dsp/dynamics/modulation/pitch/reverb/shaper/spatial`。

**3g. import 清理**：移除 `use std::sync::{Arc, Mutex}` 中的 `Mutex`（若不再使用）；保留 `Arc`。`AtomicBool/Ordering` 若无其他使用则移除。

### 改动 4：删除死代码文件（验证后）

**前提**：执行 `rg -n "PartitionedConvolver|ir_loader|convolution::" src/` 确认仅 reverb.rs（已重写）与 mod.rs（已删 mod 声明）曾引用。

- 删除 [convolution.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/convolution.rs)
- 删除 [ir_loader.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/ir_loader.rs)
- `resources/filters/*.wav`（13 个 IR 文件）保留磁盘但不再嵌入（`include_bytes!` 已随 ir_loader 删除）。不删磁盘文件，零风险。

### 改动 5（验证项，非重写）：pitch.rs 热路径核查

**文件**：[pitch.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs)

- 确认 `fill(&mut inner, &mut in_frame)` 在 `next()` 热路径中**无 Vec 分配 / 无 clone**（缓冲区在 `prepare()` 预分配）。
- 确认 `effective_sample_rate()` 是纯字段读取（无锁、无计算开销超一次乘除）。
- 确认 `preserves_pitch=false` + `playback_rate` 路径与 `pitch_shift` 路径不冲突（OLA stretch=pitch + resample=pitch 的净样本数不变逻辑已在前序修复中落地，此处仅核对）。
- **如发现热路径分配或锁 → 记录并按相同无锁/无分配原则修复；否则不动。**

---

## 假设与决策

1. **混响算法选 Freeverb**：前序对话已确定 FFT→Freeverb 方向（不重复决策）。Freeverb 每样本 O(1)，彻底消除 FFT/IR/重建/缓存/预构建五类卡顿源。
2. **预设保 API 兼容**：前端 `soundEffectStore.ts` 仍发 `reverb_kind + reverb_preset + reverb_dry + reverb_wet`；`runtime.rs` / `output/shared.rs` 构造点签名不变。22 预设内部映射到 Freeverb 参数，听感靠 (room/damp/width/gain) 区分，不再做真实 IR 卷积（可接受的音色取舍，换取零卡顿）。
3. **不重写其他 6 个机架**：报障集中在混响；pitch 的"无声"高度怀疑是混响阻塞整条 `next()` 链的连带症状（日志显示每次 `SoundEffectSource::new` 后立即 `[REVERB] 重建卷积器`）。修好混响+同步后应消失，不预先重写 pitch。
4. **保留 `[profile.dev] opt-level=1`**：Freeverb 无 FFT 内循环，但 DSP 整体（biquad/comb/allpass）在 opt-level=1 下更稳，保留无害，仅更新注释。
5. **dry/wet 语义不变**：`reverb_dry`/`reverb_wet` 用法与现 reverb.rs 一致（dry_gain = 1+(dry-1)*w, wet=wet*w），前端默认值（dry=0.8, wet=0.5）继续生效。
6. **不删 resources/filters 磁盘文件**：仅删除 `include_bytes!` 引用，避免误删可能他处使用的资源。

---

## 验证步骤

### 编译与类型
1. `cargo check --manifest-path src-tauri/Cargo.toml` 通过（无 warning 关于未使用 mod）。
2. `rg -n "rustfft|hound|PartitionedConvolver|ir_loader|convolution::|prebuild_all|CONV_CACHE" src-tauri/src/` → **零命中**（确认死代码与依赖已清）。
3. 前端 `npx vue-tsc --noEmit` 与 `npm run lint`（若有 soundEffectStore 改动则需，本计划不动前端，预期通过）。

### 单元测试
4. 在 reverb.rs 末尾 `#[cfg(test)] mod tests` 新增：
   - `test_freeverb_process_no_nan`：构造 ReverbRack，prepare(44100,2)，update_params(church)，灌 44100 个 0.5 样本，断言输出无 NaN/Inf 且非全零。
   - `test_preset_mapping_all_22`：遍历 22 预设名，`preset_params` 全部返回有效范围值（room 0-1, damp 0-1, width 0-1, gain>0）。
   - `test_preset_switch_no_alloc`：切换 5 次预设后 buffer 长度不变（仅系数变，Vec 不重建）—— 用 `buffer.len()` 断言。
   - `test_sample_rate_scaling`：prepare(48000,2) 后 comb 长度 > prepare(44100,2) 长度。
   - `test_bypass_passthrough`：reverb_kind=None 时 process 后 frame 等于输入（w 平滑到 0 后）。
5. 保留 mod.rs 既有 `test_serde_camel_case_enums` 测试（API 不变，应通过）。
6. `cargo test --manifest-path src-tauri/Cargo.toml sound_effect` 全绿。

### 手动听感（用户执行）
7. `npm run dev`（或现有 cargo dev 命令）启动应用。
8. 播放任意曲目，依次切换全部 22 个混响预设，**快速来回切换** → 应无爆音/卡顿/静音。
9. 调节 reverb_dry / reverb_wet 滑块 → 实时变化无爆音。
10. 调节 pitch_shift（变调）→ 应有声音且变速不变调（preservesPitch=true 时）/变调变速（false 时）。
11. 观察控制台：**不应再出现** `[REVERB] 重建卷积器` / `[REVERB] 全局缓存命中` / `[SE-DIAG] ...` 日志（已移除）；启动时可有一次构造日志（可选）。
12. 设备切换/恢复（output/shared.rs 路径）→ 音效链不丢失，无爆音。

---

## 风险与回滚

- **风险**：删除 rustfft/hound 依赖若有他处使用 → 验证步骤 2 兜底（零命中才删）。
- **风险**：Freeverb 听感与原 IR 卷积不同 → 已通过 22 预设参数映射提供音色多样性；如某预设听感差，仅调映射表常量，无需改架构。
- **回滚**：改动集中在 reverb.rs（全文重写）+ mod.rs（5 处局部）+ Cargo.toml（2 删 1 增）+ 删 2 文件。git 可按文件级回滚。

---

## 执行顺序

1. Cargo.toml（加 arc-swap，先暂留 rustfft/hound 待验证后删）
2. reverb.rs 全文重写（Freeverb）
3. mod.rs：SoundEffectHandle→ArcSwap、sync_settings 无锁、移除 eprintln!、移除 prebuild 线程
4. `cargo check` → 修编译错误
5. `rg` 验证零命中 → 删 convolution.rs / ir_loader.rs、删 mod 声明、删 rustfft/hound 依赖
6. `cargo check` + `cargo test sound_effect`
7. 通知用户启动应用做听感验证（步骤 7-12）
