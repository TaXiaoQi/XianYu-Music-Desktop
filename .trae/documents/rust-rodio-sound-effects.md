# Rust rodio 复现 YinDongMusic 全部音效 — 实现计划

## Context

XY-Music-Desktop 已从 YinDongMusic 迁移了音效面板界面（6 tab：混响/音调变速/均衡器/音效/专业/录制），但音效未接功能。YinDongMusic 的音效在前端 WebAudio 实现（BiquadFilter/ConvolverNode/AudioWorklet/PannerNode/WaveShaper 等），共 36 个待实现音效（EQ 已有）。

用户要求：**在 Rust rodio 引擎侧复现全部音效**（不搞前端 WebAudio 双引擎），变调用 phase vocoder，混响两套（算法+卷积）都做。

XY 现有 Rust 音频基础设施成熟，可直接复用：
- [equalizer.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/equalizer.rs) — 10 段 Biquad peaking EQ（TDF2 + 50ms 参数平滑 + hard bypass），已完整实现
- **Handle 模式**：`EqualizerHandle { settings: Arc<Mutex<EqualizerSettings>>, dirty: Arc<AtomicBool> }`，音频线程 `try_lock` 非阻塞读取（每 256 帧），参数平滑渐变避免 click
- Source 链：`Decoder → Equalizer → UserVolumeSource → TimedSource → ClipGuardSource → Sink`
- 命令通道：`AudioCommand` mpsc enum（已有 `SetEqualizerSettings`）
- 依赖：rodio 0.20（vendored `vendor/rodio-0.20.1`）、rustfft 6.4.1、symphonia 0.5.5

## 架构设计（复用 Handle 模式）

### 1. 统一音效参数结构

新建 `src-tauri/src/player/sound_effect.rs`：

```rust
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundEffectSettings {
    // 变调/倍速
    pub pitch_shift: f32,           // 0.5~2.0 (50%~200%)
    pub playback_rate: f32,         // 0.5~2.0
    pub preserves_pitch: bool,
    // 混响
    pub reverb_kind: ReverbKind,    // None|Algo|Conv
    pub reverb_preset: String,      // 预设 label
    pub reverb_dry: f32,            // 干信号增益
    pub reverb_wet: f32,            // 湿信号增益
    // 空间
    pub spatial_mode: SpatialMode,  // None|Surround3D|D8|D36|Virtual
    pub spatial_speed: f32,         // 旋转速度(秒/圈)
    pub spatial_radius: f32,        // 虚拟距离
    pub spatial_intensity: f32,
    // 调制类（每个效果 enabled + 参数）
    pub vibrato: ModulationParams,
    pub pitch_drift: ModulationParams,
    pub tremolo: ModulationParams,
    pub flanger: FlangerParams,
    pub phaser: PhaserParams,
    pub delay: DelayParams,
    // 动态类
    pub compressor: CompressorParams,
    pub multiband: MultibandParams,
    pub limiter: LimiterParams,
    pub noise_gate: NoiseGateParams,
    pub expander: ExpanderParams,
    pub agc: AgcParams,
    pub de_esser: DeEsserParams,
    // 波形整形
    pub distortion: DistortionParams,
    pub exciter: ExciterParams,
    pub sub_bass: SubBassParams,
    pub lo_fi: LoFiParams,
    pub bitcrush: BitcrushParams,
    // 声道处理
    pub vocal_removal: bool,
    pub stereo_widen: f32,          // 0~2
    pub mono_merge: bool,
    pub channel_swap: bool,
    pub stereo_separation: StereoSepParams,
    pub crossfeed: CrossfeedParams,
    pub bass_boost: BassBoostParams,
    pub dynamic_eq: DynamicEqParams,
    // 组合
    pub v4a_enabled: bool,
    pub bypass: bool,               // AB 旁通
}
```

`SoundEffectHandle`（复用 EqualizerHandle 模式）：`settings: Arc<Mutex<SoundEffectSettings>>` + `dirty: Arc<AtomicBool>`。

### 2. Source 链顺序（YinDongMusic 节点图移植）

```
Decoder → Equalizer(已有) → PitchShifterSource → ReverbSource → SpatialSource
  → EffectsRackSource(调制+动态+波形整形+声道) → UserVolumeSource(已有)
  → TimedSource(已有) → ClipGuardSource(已有) → Sink
```

每个新 Source 都 `impl Source for X<I>`（参照 equalizer.rs 的 Iterator+Source 实现），构造时传入 `Arc<SoundEffectHandle>`，音频线程 `try_lock` 非阻塞读参数 + 50ms 平滑渐变。

### 3. 文件组织

```
src-tauri/src/player/
  sound_effect.rs        — SoundEffectSettings + SoundEffectHandle + 各参数结构体
  pitch_shifter.rs       — Phase vocoder 变调源
  reverb.rs              — 算法混响(Freeverb) + 卷积混响(FFT overlap-save)
  spatial.rs             — 3D/8D/36D/虚拟环绕(立体声 panner 简化)
  effects_rack.rs        — 调制类 + 动态类 + 波形整形 + 声道处理(合并到一个 Source)
  hrtf/                  — HRTF IR 数据(可选,后续升级)
  resources/filters/*.wav — 13 个卷积混响 IR(嵌入 binary)
```

### 4. commands

`AudioCommand` 加 `SetSoundEffectSettings { settings: SoundEffectSettings }`。

新增 `#[tauri::command] set_sound_effect_settings(settings: SoundEffectSettings, state: State<PlayerState>)`，在 [commands.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/commands.rs) 注册（参照现有 `set_equalizer_settings`），通过 `tx.send(AudioCommand::SetSoundEffectSettings{...})`。

前端 [playbackApi.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/tauri/playbackApi.ts) 加 `setSoundEffectSettings(settings)`，[contracts.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/tauri/contracts.ts) 加对应 TS 类型。

### 5. 前端改造

[soundEffectStore.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/features/playback/soundEffectStore.ts)：
- 删除所有 `watch → setBiquadFilterGain/setConvolver/setPanner...` 的 WebAudio 调用
- 改为一个统一的 `watchEffect` 收集所有音效状态 → 构建 `SoundEffectSettings` → 调 `playbackApi.setSoundEffectSettings(settings)`（防抖 50ms）
- EQ 部分保留调用现有 `set_equalizer_settings`（EQ 已有独立通路）
- 删除 `syncEffectsToBackend` 空操作，改为真正的同步

[soundEffectEngine.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/utils/audio/soundEffectEngine.ts) + [advancedEffects.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/utils/audio/advancedEffects.ts)：WebAudio 节点逻辑不再使用（可保留文件作为算法参考，或删除）。`convolutions`/`algorithmicReverbs` 预设数据表保留（前端选择预设时读取参数发给 Rust）。

## 分阶段实现（9 阶段，每阶段可独立验证）

### 阶段 1：基础设施 + 前端通路
- 新建 `sound_effect.rs`：定义 `SoundEffectSettings` + 所有参数结构体 + `SoundEffectHandle`
- [runtime.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/runtime.rs)：在 Source 链插入空的 `SoundEffectSource`（直通占位，后续填充效果）
- [types.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/types.rs)：`AudioCommand` 加 `SetSoundEffectSettings`
- [commands.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/commands.rs)：`set_sound_effect_settings` command + 注册到 [lib.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/lib.rs)
- 前端：`playbackApi.setSoundEffectSettings` + contracts 类型 + soundEffectStore 改为调 command（先只接 EQ+变调占位）
- **验证**：cargo check + typecheck，前端调面板滑块 Rust 收到参数

### 阶段 2：声道处理类（易，快速见效）
在 `effects_rack.rs` 实现（都是立体声样本的简单数学运算）：
- **消人声**：`out = L - R`（中置消除）
- **单声道合并**：`L' = R' = (L+R)/2`
- **声道交换**：`L'=R, R'=L`
- **立体声拓宽**：M/S 处理 `L' = L*(1+w)/2 + R*(1-w)/2`
- **立体声分离度**：M/S 宽度 + 中心电平
- **Bass Boost**：低频 shelving Biquad（复用 equalizer.rs 的 BiquadFilter，type=lowshelf）
- **动态均衡**：低频/高频动态压缩（Biquad 分频 + 包络跟随）
- **Crossfeed**：L 延迟 ~0.3ms + 低通后送 R（模拟音箱），用环形缓冲延迟线

### 阶段 3：波形整形类
- **失真**：`out = tanh(in * amount) / tanh(amount)`（软）/ 分段削波（硬）。WaveShaper curve 预计算查表
- **谐波激励**：高通 Biquad → tanh → 干湿混合
- **比特粉碎**：`out = round(in * levels) / levels`（量化精度降低）
- **Lo-Fi**：降采样（每 N 取 1）+ 比特粉碎 + 低通 + 白噪声
- **次谐波**：低通 → 半波整流 `max(0, in)` → 低通 → 干湿混合

### 阶段 4：动态类
- **压缩器**：包络跟随（attack/release 时间常数）→ `gain = min(1, threshold/in)` → makeup gain
- **限制器**：压缩器 ratio=20:1（硬限幅）
- **噪声门**：RMS 检测 → 低于阈值则 gain 衰减到 0（attack/release 平滑）
- **扩展器**：低于阈值降增益（ratio < 1）
- **AGC**：RMS → 目标电平 → 渐变增益
- **去齿音**：高通 Biquad 检测高频能量 → 动态压缩高频
- **多段压缩**：Linkwitz-Riley 分频（3 段）→ 各段独立压缩 → 合并

### 阶段 5：调制类（LFO）
LFO 用相位累加 `phase += rate/sr`，`sin(phase)` 调制。
- **抖音 Tremolo**：`out = in * (1 - depth * sin(phase))`
- **颤音 Vibrato**：延迟线 + LFO 调制 delayTime（环形缓冲 + 分数延迟插值）
- **音调漂移**：慢颤音（低 rate 大 depth）
- **Flanger**：延迟线（0~10ms）+ LFO 调制 + 反馈 + 干湿混合
- **Phaser**：4 级 allpass Biquad + LFO 调制频率 + 反馈
- **延迟回声**：延迟线 + 反馈 + pingpong（左右交叉）+ 干湿

### 阶段 6：混响
**算法混响**（`reverb.rs` Freeverb/Schroeder）：
- 4 个 comb filter（低频衰减）+ 2 个 allpass（扩散）。参照 Freeverb 经典参数
- 9 种预设：room/hall/tunnel/valley/metal/plate/spring，调 duration/decay/preDelay

**卷积混响**（`reverb.rs` FFT 卷积）：
- 13 个 IR wav 嵌入 binary（`include_bytes!("resources/filters/xxx.wav")`），用 symphonia 解码
- 频域卷积 overlap-save（rustfft）：分块 FFT → 乘 IR 的 FFT → IFFT → overlap-add
- 干湿混合：`out = dry * mainGain + wet * sendGain`

### 阶段 7：空间音效（完整 HRTF 卷积）
YinDongMusic 用 WebAudio HRTF PannerNode（浏览器内置 HRTF）。Rust 侧嵌入 HRTF 数据集 + 动态卷积实现真正 3D 定位。

**HRTF 数据集**（新建 `src-tauri/src/player/hrtf/`）：
- 采用 MIT KEMAR 或同等公开数据集，水平 360° 每 5° 采样一个 HRIR（128 点），共 72 组左右耳 IR
- 转为二进制嵌入（`include_bytes!("hrtf/kemar_hrir.bin")`）
- 36D/虚拟环绕需 3D 数据集（含仰角），用 IRCAM Listen 或 SADIE 子集

**动态 HRTF 卷积**（`spatial.rs`，复用阶段 6 的 FFT overlap-save 工具）：
- 声源角度变化时，插值找到对应 HRIR（角度间线性插值）
- 左右声道分别与 HRIR_L/HRIR_R 做卷积（HRIR 128 点 + block 512）
- 角度按 `rotationSpeed` 秒/圈旋转：`angle += 2π * dt / speed`

**各模式**：
- **3D 环绕**：水平圆周旋转，HRTF 卷积
- **8D**：水平圆周 `angle += 2π*dt/speed`，HRTF 卷积
- **36D**：8D + 仰角摆动（3D HRTF）+ 距离波动（gain 1/r 衰减）+ 空气低通（Biquad lowpass 频率随距离衰减）
- **虚拟多声道**：5.1/7.1 每个扬声器固定角度 HRTF 卷积，L 路由到左侧扬声器、R 到右侧、中置 L+R、LFE 低通 120Hz，合并回立体声

### 阶段 8：变调（phase vocoder）
`pitch_shifter.rs`：
- STFT：Hann 窗 2048，hop 512（75% overlap）
- FFT（rustfft）→ 幅度相位 → 相位锁定时间拉伸（phase propagation）→ IFFT
- 重采样到目标音调（phaseFactor）
- overlap-add 重建
- `preservesPitch=false` 时用 rodio `speed()`（变速变调）；`preservesPitch=true` 时 speed + phase vocoder 补偿

### 阶段 9：组合 + 收尾
- **V4A 组合**：预设一键启用多效果（前端组装 settings）
- **AB 旁通**：`bypass=true` 时 SoundEffectSource 直通
- 删除/清理 soundEffectEngine.ts + advancedEffects.ts 的 WebAudio 代码（保留预设数据表）
- 录制 tab：保留界面，录制功能用 Rust 侧 OfflineRender（后续单独任务）
- 全面测试 + 性能优化（hard bypass 优化：所有效果关闭时直通）

## 关键技术决策

1. **完整 HRTF**：8D/36D/虚拟环绕嵌入 MIT KEMAR 等 HRTF 数据集 + 动态 FFT 卷积，实现真正 3D 定位。与混响共用 `fft_convolver.rs`（overlap-save）。
2. **IR wav 嵌入**：13 个卷积混响 IR 用 `include_bytes!` 嵌入 binary（增大包体积约 5-10MB，但简单可靠）
3. **统一 Source vs 多 Source**：分 4 个 Source（PitchShifter/Reverb/Spatial/EffectsRack），而非一个巨型 Source。便于维护、可独立 bypass。
4. **参数同步**：前端一个 `watchEffect` 收集所有状态 → 防抖 50ms → 单次 `setSoundEffectSettings` command（避免频繁 IPC）。EQ 保留独立 `set_equalizer_settings`（已有）。
5. **性能**：每个 Source 参照 equalizer.rs 的 hard bypass 优化（效果关闭时零开销直通）+ try_lock 非阻塞 + 参数平滑。

## 验证方案

每阶段完成后：
1. `cargo check`（src-tauri）+ `npm run typecheck` + `npm run lint`
2. 启动 app，打开音效面板，切换到对应 tab，开启效果，拖动参数滑块，听音频变化
3. 对比 YinDongMusic 的听感（同参数下应接近）
4. 验证效果关闭时无音质损失（hard bypass）
5. 验证切歌/seek 时无 click 爆音（参数平滑 + 状态重置）

阶段 1 验证：前端调滑块，Rust 日志打印收到的 settings。
阶段 6/8 验证：重点测 CPU 占用（卷积/phase vocoder 是 CPU 密集型）。

## 风险与回退

- **CPU 过载**：phase vocoder + 卷积混响 + 多段压缩同时启用可能 CPU 过高。加 `audioBoost` 性能档位（降 hop size / 关闭部分效果）。hard bypass 优化保证关闭的效果零开销。
- **phase vocoder 延迟**：STFT 有固有延迟（~50ms），可能影响播放进度同步。在 TimedSource 之前插入 pitchShifter，samples_played 统计仍准确。
- **vendored rodio**：如需改 rodio 源码（如 speed 的 preservesPitch），在 `vendor/rodio-0.20.1` 改。优先不改 vendor，用自定义 Source 包裹。

## 实施顺序与交付节奏

阶段 1（通路）→ 阶段 2（声道易）→ 阶段 3（波形）→ 阶段 5（调制）→ 阶段 4（动态）→ 阶段 6（混响 + FFT 卷积工具）→ 阶段 7（空间 HRTF，复用 FFT 卷积）→ 阶段 8（变调）→ 阶段 9（收尾）。

**分阶段交付**：每完成一个阶段，暂停等你验证听感后再继续下一阶段。先易后难，每阶段都有可听效果。阶段 6（混响）先于阶段 7（HRTF），因为其 FFT 卷积工具被 HRTF 复用。
