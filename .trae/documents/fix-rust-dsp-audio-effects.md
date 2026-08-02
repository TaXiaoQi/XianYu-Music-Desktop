# 修复 Rust DSP 音效对齐 YinDongMusic 质量方案

## 背景与决策

用户选择**保持 Rust rodio 播放架构，修复 Rust DSP 对齐 YinDongMusic 质量**（不切换到前端 WebAudio 播放）。

当前 XY 音频完全由 Rust rodio 播放（`playbackApi.playAudio`），WebAudio 图已断开。所有音效由 `SoundEffectSource::next` 在 Rust Source 链中处理。本次针对用户反馈的 6 类失效问题逐一修复。

## 当前状态分析（根因）

经逐文件对比 YinDongMusic 的 WebAudio 实现（`YinDongMusic/src/utils/audio/advancedEffects.ts` + `soundEffectEngine.ts`）与 Rust 实现，确认以下根因：

### 根因 1：音调升降无声音（CRITICAL）— [pitch.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs)

[pitch.rs:217-223](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs#L217-L223) 中，变调分支的时间拉伸因子**方向反转**：

```rust
if (pitch - 1.0).abs() >= 0.001 {
    stretch *= 1.0 / pitch;   // ❌ 错误：应为 stretch *= pitch
}
```

**数学推导**：
- `stretch` 语义：`>1 = 减速 = 产出更多样本`（[pitch.rs:141](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs#L141) 注释）
- `resample` 语义：`>1 = 升调 = 产出更少样本`（[pitch.rs:111](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs#L111) 注释）
- 输出样本数 = 输入 × `stretch` / `resample`

**变调不变速**（pitchShift=120, preservesPitch=true, rate=100）期望：输出数=输入数，音调×1.2。
- 正确：`stretch = pitch = 1.2`，`resample = pitch = 1.2` → 输出/输入 = 1.2/1.2 = 1.0 ✓
- 当前错误：`stretch = 1/pitch = 0.833`，`resample = pitch = 1.2` → 输出/输入 = 0.833/1.2 = 0.694 ❌

后果：升调时输出样本数仅输入的 69% → `produce_sample` 持续 underrun → `fill` 填 0 → **静音**。降调时反向溢出 → 失真。

### 根因 2：Bass 重低音增强有问题 — [channel.rs:206-230](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L206-L230)

1. **每样本重算 biquad 系数**：`set_lowshelf(120.0, sr, self.bass_gain_target, 0.707)` 在每个音频帧调用，系数剧烈变化产生 click 杂音，且 CPU 开销大。
2. **动态方向反转**：Rust 在低频能量大时**降低**增益（`reduction`，防轰耳），但 YinDongMusic 的动态低音是**增强**增益（`boost = 1 + avg * 0.5`，鼓点时加强低音）——方向完全相反。
3. **包络跟踪全频带**：`bass_env.process(frame[0].abs())` 跟踪的是全频带峰值，不是低频能量。YinDongMusic 用 AnalyserNode FFT 仅取前 1/8 频段（低频）。

### 根因 3：动态均衡有问题 — [channel.rs:232-254](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L232-L254)

1. **每样本重算系数**：同 Bass 问题，`set_highshelf` 每帧调用。
2. **平滑系数错误**：`* 0.001`（[channel.rs:244](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L244)），约 1000 样本（23ms）收敛 1dB，过慢。
3. **缺失低频补偿**：YinDongMusic 的 DynamicEQ 包含 `lowBoost`（低 shelf +3dB @ 80Hz，[advancedEffects.ts:698-701](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L698-L701)），Rust 完全缺失——只做高频衰减，不补低频。

### 根因 4：V4A 全套音效有问题 — [mod.rs:584-600](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs#L584-L600)

`apply_params` 中 V4A 仅设置两个固定 shelf（低频 +3dB@120Hz、高频 +2dB@8kHz），**不启用任何子效果**。

YinDongMusic 的 `setV4A`（[advancedEffects.ts:1656-1671](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L1656-L1671)）会强制启用：BassBoost（gain 6, dynamic）+ DynamicEQ + StereoWiden（1.4）+ Compressor（-20dB, ratio 4）。Rust 的 V4A 只是一个 2 段 EQ，不是「全套」。

### 根因 5：环境混响不明显 + 增益单独调没效果 — [reverb.rs:267-273](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs#L267-L273)

1. **soft_clip 压缩混响**：`soft_clip(out_l) * wet` 对混响尾音做 tanh 压缩，增益变化被饱和曲线抹平——拖动 `envGain` 滑块时听感变化不明显。
2. **Freeverb 内部增益过低**：`gain = 0.015` + 8 梳状求和，湿信号电平偏低，被 1.8× 干信号盖过。
3. **增益滑块有效范围过小**：UI 滑块 0-300，但映射 `reverbWet = envGain/10`，envGain=9（教堂）→ wet=0.9；envGain=300（满格）→ wet=30.0（严重削波）。0-30 以上的范围全部削波听感相同，故「单独调没效果」。

### 根因 6：8D/36D 环绕音效不对 — [spatial.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs) + [soundEffectStore.ts:373](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L373)

1. **spatialIntensity 映射错误**：[soundEffectStore.ts:373](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L373) 对所有模式都传 `surroundIntensity.value`（3D 环绕的控制值），但 8D/36D 应为全强度（YinDongMusic 的 8D panner 是 100% 湿，无 intensity 混合）。
2. **过度衰减**：`atten = 1.0 / (1.0 + radius * 0.3)`，radius=4 时 atten=0.45（-7dB），信号被大幅衰减。
3. **ITD 过弱且方向怪**：最大 0.6ms（26 样本），且交叉馈送逻辑把 `out_r` 写入左耳延迟线（[spatial.rs:163-170](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L163-L170)），是模糊的近似而非真正的耳间时间差。
4. **36D 缺垂直定位**：仅靠低通截止频率变化模拟「上下」，无真正的垂直声像 cue。YinDongMusic 用 PannerNode 的 Y 轴位置做 HRTF 垂直定位。

### 顺手清理：调试日志噪音

[mod.rs:722-750](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs#L722-L750) 中 `channels()`/`sample_rate()`/`current_frame_len()` 含 `eprintln!` 诊断输出，首次调用时打印到 stderr。生产环境应移除。

## 提议修改

### 修改 1：修复 pitch stretch 方向（CRITICAL）

**文件**：[pitch.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs)

**改动**：[pitch.rs:217-223](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs#L217-L223)

```rust
// 修改前
if (pitch - 1.0).abs() >= 0.001 {
    stretch *= 1.0 / pitch;
}

// 修改后
if (pitch - 1.0).abs() >= 0.001 {
    stretch *= pitch;  // 变调：时间拉伸与重采样同向，输出样本数守恒
}
```

**验证数学**：preservesPitch=true, pitch=1.2, rate=1.0
- stretch = 1/rate × pitch = 1.0 × 1.2 = 1.2
- resample = pitch = 1.2
- 输出/输入 = 1.2/1.2 = 1.0 ✓（时长不变，音调×1.2 ✓）

组合场景（preservesPitch=true, rate=2, pitch=1.5）：
- stretch = 1/2 × 1.5 = 0.75
- resample = 1.5
- 输出/输入 = 0.75/1.5 = 0.5 ✓（2× 速，音调×1.5 ✓）

**新增单元测试**：在 [pitch.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs) 末尾加 `test_pitch_shift_sample_balance` —— 喂 44100 个样本（1 秒），pitchShift=120，断言产出样本数 ≈ 44100（±5%）。

### 修改 2：重写 Bass Boost（对齐 YinDongMusic 动态增强方向）

**文件**：[channel.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs)

**改动**：重写 [channel.rs:206-230](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L206-L230) 的 Bass Boost 处理块。

**新逻辑**：
1. 用 `bass_env_lp`（Biquad lowpass @ 150Hz）先提取低频，再过 `bass_env`（包络跟随器）跟踪低频能量。
2. **动态增强**（非降低）：`boost = 1.0 + bass_env_value * 0.5`（鼓点时增益×1.5），与 YinDongMusic [advancedEffects.ts:681](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L681) 一致。
3. 增益平滑：用 `SmoothedValue`（50ms 时间常数）平滑 `bass_gain_target × boost`，避免每样本跳变。
4. **仅当平滑增益变化 > 0.1dB 时才重算 biquad 系数**（避免每样本 set_lowshelf）。

**ChannelRack 新增字段**：
- `bass_detect_lp: [Biquad; 2]`（低频提取，150Hz lowpass）
- `bass_boost_smooth: SmoothedValue`（动态增强倍率平滑）

**update_params 改动**：仅在 `s.bass_boost.gain` 变化时设置 `bass_shelf` 系数（缓存上次 gain 值，差异 > 0.1 才更新）。

### 修改 3：重写 Dynamic EQ（补低频补偿 + 修平滑）

**文件**：[channel.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs)

**改动**：重写 [channel.rs:232-254](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L232-L254) 的 Dynamic EQ 处理块。

**新逻辑**（对齐 YinDongMusic [advancedEffects.ts:694-760](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L694-L760)）：
1. **低频补偿**（新增）：`dyn_low_shelf`（80Hz, +3dB）—— 始终作用于通过的信号。
2. **高频压缩**：分频 5kHz，高频段过动态衰减（检测高频能量 > 阈值时衰减）。
3. **平滑系数**：`dyn_reduction` 用 `SmoothedValue`（30ms 时间常数）替代 `* 0.001` 手动平滑。
4. **仅当 reduction 变化 > 0.1dB 时才重算** `dyn_high_shelf` 系数。

**ChannelRack 新增字段**：`dyn_reduction_smooth: SmoothedValue`

### 修改 4：V4A 启用全套子效果

**文件**：[mod.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs)

**改动**：重写 [mod.rs:584-600](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs#L584-L600) 的 `apply_params` V4A 分支。

**新逻辑**：当 `s.v4a_enabled` 为 true 时，构造一个**覆盖版** `SoundEffectSettings`（clone `s` 后强制设置子效果参数），传给各机架的 `update_params`：

```rust
fn apply_params(&mut self, s: &SoundEffectSettings) {
    // V4A 启用时：强制启用 BassBoost + DynamicEQ + StereoWiden + Compressor
    let effective = if s.v4a_enabled {
        let mut e = s.clone();
        e.bass_boost.enabled = true;
        e.bass_boost.gain = 6.0;
        e.bass_boost.dynamic = true;
        e.dynamic_eq.enabled = true;
        e.stereo_widen.enabled = true;
        e.stereo_widen.amount = 1.4;
        e.compressor.enabled = true;
        e.compressor.threshold = -20.0;
        e.compressor.ratio = 4.0;
        e.compressor.attack = 3.0;   // ms
        e.compressor.release = 100.0; // ms
        e
    } else {
        s.clone()
    };
    self.pitch.update_params(&effective);
    self.channel_rack.update_params(&effective);
    self.shaper_rack.update_params(&effective);
    self.dynamics_rack.update_params(&effective);
    self.modulation_rack.update_params(&effective);
    self.reverb_rack.update_params(&effective);
    self.spatial_rack.update_params(&effective);
    // V4A 额外的低/高 shelf 保留（额外音色染色）
    if s.v4a_enabled {
        self.v4a_low.set_lowshelf(120.0, self.sample_rate as f32, 3.0, 0.707);
        self.v4a_high.set_highshelf(8000.0, self.sample_rate as f32, 2.0, 0.707);
    } else {
        self.v4a_low.set_passthrough_inline();
        self.v4a_high.set_passthrough_inline();
    }
}
```

注意：`SoundEffectSettings` 需派生 `Clone`（[mod.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs) 顶部结构体已有 `#[derive(Clone, Debug, Default, Serialize, Deserialize)]`，确认即可）。

### 修改 5：修复混响增益有效性

**文件**：[reverb.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs)

**改动 5a**：移除 wet 路径的 `soft_clip`（[reverb.rs:270-271](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs#L270-L271)），改为直接 `out_l * wet`，让增益变化线性可闻。

```rust
// 修改前
let nl = in_l * dry + soft_clip(out_l) * wet;
let nr = in_r * dry + soft_clip(out_r) * wet;

// 修改后（移除 soft_clip，让 wet 增益线性生效；最终限幅在 mod.rs 的 audioBoost 软限幅处）
let nl = in_l * dry + out_l * wet;
let nr = in_r * dry + out_r * wet;
```

**改动 5b**：提升 Freeverb 内部增益 `gain` 从 `0.015` → `0.028`（[reverb.rs:116](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs#L116)），让湿信号更明显。

**改动 5c**：dry 公式调整，让增益在整个滑块范围（0-300）都有可闻变化：

```rust
// 修改前：dry = lerp(1.0, dry_gain, w) —— dry_gain 直接为 s.reverb_dry（0-30）
// 修改后：dry = lerp(1.0, dry_gain, w) 不变，但前端映射改为 /100（见修改 7）
```

实际 dry/wet 公式保持不变，通过修改 7（前端映射）让滑块全范围可用。

**改动 5d**：最终输出加软限幅防削波（在 [reverb.rs:272-273](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs#L272-L273) 赋值前）：

```rust
let nl = dsp::soft_clip(in_l * dry + out_l * wet);
let nr = dsp::soft_clip(in_r * dry + out_r * wet);
```

这样：湿信号本身不被压缩（增益可闻），但合成后总输出有限幅（防爆音）。

### 修改 6：修复 8D/36D 空间音效

**文件 6a**：[spatial.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs)

**改动 6a-1**：8D/36D 模式使用全强度（无 dry/wet 混合），仅 3D 模式用 intensity 混合。重写 [spatial.rs:100-123](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L100-L123) `process`：

```rust
pub fn process(&mut self, frame: &mut [f32], channels: u16, s: &SoundEffectSettings) {
    if channels != 2 || frame.len() < 2 { return; }
    let w = self.enabled.tick();
    if w < 0.001 { return; }
    let in_l = frame[0];
    let in_r = frame[1];

    let (out_l, out_r) = match s.spatial_mode {
        SpatialMode::D8 | SpatialMode::Surround3d => self.process_rotational(in_l, in_r, s),
        SpatialMode::D36 => self.process_36d(in_l, in_r, s),
        SpatialMode::Virtual => self.process_virtual(in_l, in_r, s),
        SpatialMode::None => (in_l, in_r),
    };

    // 8D/36D：全湿（g=1.0，完全空间化）；3D：按 intensity 混合
    let g = match s.spatial_mode {
        SpatialMode::D8 | SpatialMode::D36 => 1.0,
        _ => (s.spatial_intensity / 10.0).clamp(0.1, 1.0),
    };
    let g = g * w;  // 应用 enabled 平滑
    frame[0] = in_l * (1.0 - g) + out_l * g;
    frame[1] = in_r * (1.0 - g) + out_r * g;
}
```

**改动 6a-2**：改进 `process_rotational`（[spatial.rs:126-175](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L126-L175)）：
- 减弱衰减：`atten = 1.0 / (1.0 + radius * 0.15)`（原 0.3 太强）
- 等功率 pan 律：`l_gain = (1.0 - pan).cos()` ... 实际用 `((1.0-pan)*PI/2).cos()` 更准确，简化用 `(1.0-pan).sqrt()` 保留
- 增强 ITD：最大 0.7ms = 30 样本（原 26 可接受，但交叉馈送逻辑需修正）
- 修正交叉馈送：声源偏右时，左耳收到的应是**同源延迟**信号，不是 `out_r`

```rust
// 修正后的 ITD：声源偏右(pan>0.5)，左耳延迟接收 src（同源，非 out_r）
let itd_samples = (pan - 0.5).abs() * 30.0;  // 最大 0.7ms
if pan > 0.5 {
    // 声源偏右，左耳延迟接收
    self.cross_dl[0].write(src * 0.4);
    out_l += self.cross_dl[0].read(itd_samples) * atten;
} else {
    self.cross_dl[1].write(src * 0.4);
    out_r += self.cross_dl[1].read(itd_samples) * atten;
}
```

**改动 6a-3**：改进 `process_36d`（[spatial.rs:178-209](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L178-L209)）：
- 垂直摆动用**双频段** cue：上方时高频略增（head shadow 减弱），下方时低通增强（地面吸收）
- 距离波动影响衰减 + ITD（远 → 衰减更多 + 延迟更长）

```rust
// 垂直 cue：vert>0（上方）→ 高频通透；vert<0（下方）→ 低通加重
let vert = self.vert_lfo.tick_sine(); // -1..1
let air_cutoff = if vert >= 0.0 {
    8000.0 + vert * 4000.0  // 上方：8-12kHz
} else {
    8000.0 + vert * 4000.0  // 下方：4-8kHz（更闷）
};
```

**改动 6a-4**：修正 `process_virtual`（[spatial.rs:212-248](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L212-L248)）的中置增益溢出：当前 `center * 0.7` + `sl * 0.5 * spread` + `rl * 0.4 * spread` + 直通 `in_l`，spread=2 时增益爆表。改为归一化：

```rust
let mut out_l = in_l * 0.7 + center * 0.5 + sl * 0.3 * spread;
let mut out_r = in_r * 0.7 + center * 0.5 + sr * 0.3 * spread;
```

**文件 6b**：[soundEffectStore.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts)

**改动 6b**：修正 `spatialIntensity` 映射（[soundEffectStore.ts:373](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L373)）：

```typescript
// 修改前
spatialIntensity: surroundIntensity.value,

// 修改后：8D/36D 用全强度（10 → Rust 内 1.0），3D 用 surroundIntensity，virtual 用 spread
spatialIntensity: enable3DSurround.value
  ? surroundIntensity.value
  : (enable8D.value || enable36D.value)
    ? 10  // 8D/36D 全强度
    : 10,
```

### 修改 7：修正混响增益滑块映射（让全范围可用）

**文件**：[soundEffectStore.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts)

**改动 7a**：[soundEffectStore.ts:367-368](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L367-L368) 映射改为 /100：

```typescript
// 修改前
reverbDry: originalGain.value / 10,
reverbWet: envGain.value / 10,

// 修改后：100% = unity（1.0），300% = 3.0×
reverbDry: originalGain.value / 100,
reverbWet: envGain.value / 100,
```

**改动 7b**：[soundEffectStore.ts:67-68](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L67-L68) 预设映射改为 ×100：

```typescript
// 修改前
originalGain.value = Math.round(conv.mainGain * 10);
envGain.value = Math.round(conv.sendGain * 10);

// 修改后：mainGain 1.8 → 180（180% = 1.8×）
originalGain.value = Math.round(conv.mainGain * 100);
envGain.value = Math.round(conv.sendGain * 100);
```

**改动 7c**：[soundEffectStore.ts:92-93](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L92-L93) 算法混响默认增益调整：

```typescript
// 修改前
originalGain.value = 10;
envGain.value = 20;

// 修改后：算法混响默认 100% 干 + 30% 湿（明显但不轰）
originalGain.value = 100;
envGain.value = 30;
```

**改动 7d**：[soundEffectStore.ts:59-60](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L59-L60) 默认值调整：

```typescript
// 修改前
const originalGain = ref(0)
const envGain = ref(300)

// 修改后：100% = unity
const originalGain = ref(100)
const envGain = ref(30)
```

**持久化兼容**：旧用户存储的 originalGain=18（旧映射 = 1.8×）在新映射下变为 0.18×（几乎静音）。需在 `applyEffectSnapshot` 中加迁移：若 `originalGain` 或 `envGain` 旧值范围疑似旧映射（>30 且 <400），×10 转换为新映射等价值。具体：检测保存快照无 `_gainMapV2` 标记时，对 originalGain/envGain 乘 10（18→180 = 1.8× 不变）。

### 修改 8：移除调试日志

**文件**：[mod.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs)

**改动**：移除 [mod.rs:722-750](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs#L722-L750) 中 `channels()`/`sample_rate()`/`current_frame_len()` 的 `eprintln!` 诊断块及 `AtomicBool`/`AtomicU64` 静态变量，简化为直接返回值。

同时移除 [mod.rs:557-560](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs#L557-L560) `SoundEffectSource::new` 末尾的 `eprintln!` 构造日志。

## 假设与决策

1. **不切换播放引擎**：用户明确选择保留 Rust rodio 播放，所有修复在 Rust DSP 层完成。
2. **HRTF 近似**：8D/36D 仍用立体声 pan + ITD + 频谱 cue 近似（Rust 无内置 HRTF），但修正强度映射、衰减、ITD 方向，使听感接近 YinDongMusic。
3. **V4A 不依赖前端开关**：V4A 启用时由 Rust 强制覆盖子效果参数，不依赖前端单独启用各效果（与 YinDongMusic `setV4A` 一致）。
4. **增益映射迁移**：旧持久化数据通过 `applyEffectSnapshot` 内的版本标记迁移，避免老用户升级后混响静音。
5. **不动 EQ 链路**：10 段 EQ 已有独立的 `set_equalizer_settings` 同步（[soundEffectStore.ts:446-465](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts#L446-L465)），本次不改动。

## 验证步骤

按以下顺序执行验证（每步通过后再下一步）：

1. **Rust 编译**：`cargo check`（cwd=`src-tauri`），确认 0 error 0 warning。
2. **Rust 单元测试**：`cargo test sound_effect`，确认含新增的 `test_pitch_shift_sample_balance` 全部通过。
3. **前端类型检查**：`npx vue-tsc --noEmit`，确认 exit 0。
4. **前端 lint**：`npx eslint src/features/playback/soundEffectStore.ts src/components/common/SoundEffectBtn/EqualizerPanel.vue`，确认 exit 0。
5. **前端测试**：`npx vitest run`（EQ 相关测试），确认无回归。
6. **手动验证清单**（用户启动 `tauri dev` 后）：
   - [ ] 音调滑块拖到 120/80：声音正常（不静音、不变速）
   - [ ] Bass 增益滑块：低频明显增强，鼓点时动态加强（非降低）
   - [ ] 动态均衡开关：低频有 +3dB 补偿感，高频刺耳被压制
   - [ ] V4A 开关：低频增强 + 立体声拓宽 + 压缩感同时生效
   - [ ] 混响选「教堂」：明显空间感；拖动「环境音效增益」0→300，湿信号从无到强线性变化
   - [ ] 8D 开关：耳机中声源明显绕头旋转（非被衰减的微弱声）
   - [ ] 36D 开关：旋转 + 上下层次感
