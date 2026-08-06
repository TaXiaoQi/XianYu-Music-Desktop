# 播放引擎替换：完完全全移植 YinDongMusic 的播放引擎与均衡器

## Context（背景与目标）

XY-Music-Desktop 当前播放架构为 **100% Rust rodio**：本地与在线音频全部经 `play_audio` Tauri 命令进入 Rust 音频线程，管线为 `BufferedSource → VolumeNormalizer → Equalizer → SoundEffectSource(直通占位) → UserVolume → ClipGuard → sink`。Rust 侧 10 段 EQ 生效，但 `set_sound_effect_settings` 自述「直通占位」（音效未真正接线），前端 `src/utils/audio/soundEffectEngine.ts` 虽存在却是**死代码**（无调用方）。频谱来自 Rust `get_audio_visualizer_samples`。

YinDongMusic 采用**双路径**架构：
- **默认（共享模式）**：`new Audio()` 创建 HTML `<audio>` 元素 → `getLocalAudioUrl`/`getProxiedAudioUrl` 把本地路径/远程 URL 转成本地代理 URL（注入 CORS 头）→ `audio.src` → 通过 Web Audio 图（`MediaElementSource → Analyser → 10×BiquadFilter EQ → Convolver混响 → Compressor → EffectsRack → Panner(8D/36D/虚拟环绕) → safetyLimiter → Gain → destination`）播放。进度/结束由 `timeupdate`/`ended` 事件驱动，音量由 `networkAudio.volume` 控制。
- **WASAPI 独占模式（USB DAC）**：`play_audio({outputMode:'wasapiExclusive'})` 走 Rust rodio + `set_audio_effects`（Rust 端 EQ/混响/环绕/变调）。

**目标**：完全移除 XY 的 Rust-rodio 主播放路径与 Rust EQ/音效/频谱/流缓存/响度，改用 YinDong 的 HTML `<audio>` + Web Audio 双路径方案；响度归一化丢弃；旧 Rust 播放代码删除。

> 这是一个大型架构替换，按阶段交付，每阶段独立可验证。来源参考目录：`XY-Music-Desktop\YinDongMusic\`（vendored 完整副本）。

---

## 范围决策（已与用户确认）
1. WASAPI 独占模式：**一并移植双路径**。
2. 响度归一化：**丢弃**，对齐 YinDong。
3. 旧 Rust 播放代码：**删除**（不留 dormant）。

---

## 阶段 1：移植 Rust 端 URL 代理 + WASAPI 独占基础设施

**目标**：为 HTML `<audio>` 路径提供带 CORS 头的本地代理；为 WASAPI 独占路径提供 Rust rodio + 音效后端。

### 1.1 移植 `audio_proxy.rs`
- 复制 `YinDongMusic\src-tauri\src\audio_proxy.rs` → `src-tauri\src\audio_proxy.rs`
- 提供 `AudioProxyState`（本地 HTTP 代理服务，`proxied_url(url, None)` 为远程 URL 代下载并注入 CORS，`local_url(path)` 读本地文件并注入 CORS）。这是 Web Audio `createMediaElementSource`（要求 `crossOrigin="anonymous"`）的硬前提。
- 在 `lib.rs::run()` 的 `tauri::Builder` 链 `.setup()` 中 `.manage(AudioProxyState::new(...))` 注册状态。

### 1.2 移植 WASAPI 独占 + 音效后端
- 复制 `YinDongMusic\src-tauri\src\player\usb.rs` → `src-tauri\src\player/usb.rs`（`get_usb_dac_devices`、`enable_usb_exclusive_mode`、`disable_usb_exclusive_mode`、`query_exclusive_status`）
- 复制 `YinDongMusic\src-tauri\src\player\output\{mod.rs,shared.rs,wasapi_exclusive.rs}` → `src-tauri\src\player/output/`
- 复制 `YinDongMusic\src-tauri\src\player\effects\{mod.rs,chain.rs,equalizer.rs,pitch_shift.rs,reverb.rs,surround.rs,types.rs}` → `src-tauri\src\player/effects/`（Rust 端 DSP，**仅 WASAPI 独占模式使用**）
- 复制 `YinDongMusic\src-tauri\src\player\commands.rs` 的 `play_audio`（WASAPI 独占分支：网络歌曲下载到临时文件再 rodio 播放）、`set_audio_effects`、`get_bitstream_info`
- 保留并适配 `device.rs`（cpal 设备枚举，WASAPI 路径用）

### 1.3 移植 URL 代理命令
- 把 `get_local_audio_url`、`get_proxied_audio_url`（见 `YinDongMusic\src-tauri\src\app_runtime.rs:239-263`）加入 XY 的 `app_runtime` 模块（或新建 `src-tauri\src\audio_proxy_commands.rs`）。

### 1.4 命令注册
- `src-tauri\src\lib.rs` `generate_handler!` 与 `permissions\app-commands.toml` 同步**新增**：`get_local_audio_url`、`get_proxied_audio_url`、`get_usb_dac_devices`、`enable_usb_exclusive_mode`、`disable_usb_exclusive_mode`、`query_exclusive_status`、`set_audio_effects`、`get_bitstream_info`。

> 阶段 1 完成后 `cargo check` 应通过（新代码与旧代码并存，尚未接线）。

---

## 阶段 2：删除旧 Rust 播放代码

**删除文件**（`src-tauri\src\player\`）：
- `buffered_source.rs`、`equalizer.rs`（旧 10 段）、`loudness.rs`、`spectrum.rs`、`stream_cache.rs`、`runtime.rs`（旧 rodio 管线）

**改写** `commands.rs`：移除 `set_equalizer_settings`、`set_sound_effect_settings`、`get_audio_visualizer_samples`、`get_track_loudness_info`、`update_loudness_settings`、`get_playback_progress`、`get_playback_duration`、`get_playback_ready`、`get_playback_start_failed`、`set_stream_cache_max_size`、`get_stream_cache_info`、`clear_stream_cache`、`is_stream_cached`、`copy_stream_cache`、`wait_stream_complete`、`set_playback_speed`。保留 `play_audio`（改为仅 WASAPI 独占）、`pause_audio`、`resume_audio`、`stop_audio`、`seek_audio`、`set_volume`、`update_playback_metadata`、`get_output_devices`、`get_current_output_device`、`set_output_device`、`set_audio_output_mode`。

**`lib.rs` 与 `app-commands.toml`**：同步移除上述被删命令；移除 `use player::{...}` 中对应导入。

**`Cargo.toml`**：移除 `rustfft`（spectrum 专用）；保留 `rodio` + `symphonia`（WASAPI 独占解码仍需）。清理其他仅旧管线使用的依赖。

> 阶段 2 完成后 `cargo build` 应通过；前端此刻会大面积报调用缺失命令，进入阶段 3-6 修复。

---

## 阶段 3：移植前端 Web Audio 引擎 + 音效 Store

### 3.1 替换 `src\utils\audio\soundEffectEngine.ts`
用 `YinDongMusic\src\utils\audio\soundEffectEngine.ts` 整体替换。核心音频图（参考其 L149-283、L349-379）：
```
MediaElementSource → Analyser(fftSize=256) → 10×BiquadFilter(peaking, 31/62/125/250/500/1k/2k/4k/8k/16k, Q=1.4)
  → [pitchShifter AudioWorklet] → convolverSourceGain + convolver(IR) → convolverDynamicsCompressor
  → [EffectsRack 延迟创建] → panner(HRTF) → safetyLimiter(-1dB) → gainNode → destination
  + MediaStreamDestination(录音分支)
```
关键导出：`connectAudioElement`/`disconnectAudioElement`/`setBiquadFilterGain`/`applyEqPreset`/`resetBiquadFilter`/`setConvolver`/`setAlgorithmicReverb`/`setPanner8D`/`setPanner36D`/`setVirtualSurround`/`setPitchShifter`/`setPlaybackRate`/`setPreservesPitch`/`setVocalRemoval`/`setV4A`/`setAudioBoost`/`setBypass`/`getAnalyser`/`getAudioContext` 等。

### 3.2 移植 `src\utils\audio\advancedEffects.ts`
效果架（26 模块节点链）、算法混响 IR 生成器、高级 EQ 预设。

### 3.3 移植 `src\features\playback\soundEffectStore.ts`
Pinia store：`eqBands`(10 段)、混响、8D/36D、虚拟环绕、变调、调制、动态处理等 reactive 字段；`watch` → 调引擎 setter；暴露 `connectAudio`/`disconnectAudio`（桥接 `connectAudioElement`）；USB 独占模式下将前端音效参数转换为 `EffectParams` 同步到 Rust（参考 L692-700）。

### 3.4 移植预设与 IR 资源
- EQ 频段/预设：`freqs`/`freqsPreset`（soundEffectEngine.ts 内）
- 卷积 IR `.wav` 文件：复制 `YinDongMusic\public\`（或 `src\assets\`）下的 IR 资源到 XY 对应目录，确认 `loadBuffer` 加载路径正确。

---

## 阶段 4：重写前端播放主流程（双路径）

**改写** `src\composables\playerPlayback.ts`，对齐 `YinDongMusic\src\composables\playerPlayback.ts:554-700`：

1. **URL 解析**：复用 XY 现有 `lx://`/`plugin://` 解析逻辑（`playerPlayback.ts:746+` 的 `getStoredPlugins`/`ensureLxPluginInstance`/`lxPluginGetMusicUrl`），产出 `resolvedAudioPath`（http(s) URL 或本地路径）。
2. **停止旧播放**：`soundEffectStore.disconnectAudio()` → 停 `networkAudio`（pause+清 src+移除监听）→ 条件停 Rust（非独占模式 `pauseAudio`）。
3. **分流**：
   - `usbExclusiveEnabled === true` → `playbackApi.playAudio({outputMode:'wasapiExclusive', ...})` + `setVolume` + `updatePlaybackMetadata`；进度轮询 `getPlaybackProgress`。
   - 否则 → `audioSrc = isNetwork ? getProxiedAudioUrl(url) : getLocalAudioUrl(path)` → `new Audio()` + `crossOrigin='anonymous'` + `audio.volume` + `audio.src` → `soundEffectStore.connectAudio(audio)` → 等 `canplay` → `audio.play()`；绑 `timeupdate`/`ended`。
4. **进度时钟**：HTML 模式用 `requestAnimationFrame` 基于 `playbackStartOffset` 更新 `currentTime`（参考 L198-239）；WASAPI 模式轮询 Rust。
5. **暂停/恢复/seek/音量**：双路径分支（HTML: `networkAudio.pause/play/currentTime/volume`；WASAPI: `pauseAudio/resumeAudio/seekAudio/setVolume`）。
6. **移除响度**：删除所有 `getTrackLoudnessInfo`/`updateLoudnessSettings` 调用点与相关 session 逻辑。

---

## 阶段 5：契约 + 设置 Store 对齐

### 5.1 `src\services\tauri\contracts.ts`
- 新增：`EffectParams`、`BitstreamInfo`（参考 YinDong `contracts.ts`）
- `PlayAudioOptions` 增加 `outputMode: 'wasapiExclusive' | 'shared'`
- 删除：`SoundEffectSettings`（Rust 版）、`LoudnessRecord`、`UpdateLoudnessSettingsOptions`、流缓存相关类型

### 5.2 `src\features\settings\store.ts`
- `audio` 新增 `usbExclusiveEnabled: boolean`
- `audio.equalizer` 对齐前端 BiquadFilter：10 段 @ `freqs=[31,62,125,250,500,1000,2000,4000,8000,16000]`，保留 `enabled/preamp/gains`
- 音效字段交由 `soundEffectStore` 管理（混响/空间/变调等），设置 store 仅持久化其快照
- 删除 loudness 相关设置

---

## 阶段 6：重接 UI 与 playbackApi

### 6.1 `src\services\tauri\playbackApi.ts`
- 删除：`setEqualizerSettings`/`requestEqualizerSettings`/`flushEqualizerSettings` 及 `eqScheduler`/签名缓存、`setSoundEffectSettings`、`getAudioVisualizerSamples`、`getTrackLoudnessInfo`/`updateLoudnessSettings`、流缓存方法、`getPlaybackReady`/`getPlaybackStartFailed`/`getPlaybackDuration`（HTML 模式从 `audio.duration` 取）
- 新增：`getLocalAudioUrl`、`getProxiedAudioUrl`、`getUsbDacDevices`、`enableUsbExclusiveMode`、`disableUsbExclusiveMode`、`setAudioEffects`、`getBitstreamInfo`、`queryExclusiveStatus`

### 6.2 EQ / 音效设置 UI（`src\components\settings\`）
- EQ 面板改为读写 `soundEffectStore.eqBands`（前端 `setBiquadFilterGain`），不再调 `setEqualizerSettings`
- 音效面板（混响/空间/变调等）接 `soundEffectStore`
- 移除响度 UI

### 6.3 `src\components\player\AudioVisualizer.vue`
- 主路径改为 `soundEffectEngine.getAnalyser().getByteFrequencyData()`（参考 YinDong AudioVisualizer L141-178）
- WASAPI 独占模式下回退 `getAudioVisualizerSamples`（保留该命令供独占模式）

### 6.4 输出设备选择
- HTML `<audio>` 路径：`navigator.mediaDevices.enumerateDevices()` + `audio.setSinkId(deviceId)`
- WASAPI 独占路径：保留 `set_output_device`
- 设备选择 UI 按当前路径分流

---

## 阶段 7：验证

1. **构建**：`cargo build`（src-tauri）+ `npx vue-tsc --noEmit`（零错误）+ `npm run tauri dev` 启动。
2. **本地文件播放**（HTML 路径）：选本地歌曲 → `getLocalAudioUrl` 代理 → `<audio>` 起播 → Web Audio 图通 → 调节 EQ 滑块听感变化 → 频谱可视化跳动。
3. **在线播放**（HTML 路径）：落雪/插件源 → `getProxiedAudioUrl` 代理 → 起播 → 混响/8D/变调音效生效。
4. **WASAPI 独占**：设置开启 USB 独占 → `play_audio(wasapiExclusive)` → `set_audio_effects` 生效 → `get_bitstream_info` 显示采样率/位深。
5. **切歌/队列/拖动进度/音量/暂停恢复**：双路径均正常，无重叠播放、无电流声。
6. **输出设备切换**：HTML 路径 `setSinkId` 切换耳机/扬声器；WASAPI 路径 `set_output_device`。
7. **回归**：歌词同步、SMTC 元数据、统计上报（`reportUserBehavior`/`reportAppOpen`）不受影响。

---

## 关键风险与注意事项
- **AudioContext 自动暂停策略**：浏览器要求用户交互后才能 `resume()`，`connectAudioElement` 已处理；首播需确保在用户点击上下文内。
- **CORS 代理性能**：`audio_proxy` 为本地 HTTP 服务，大文件/高码率下需支持 Range 请求（参考 YinDong `audio_proxy.rs` 实现），否则 `<audio>` seek 会失效。
- **`createMediaElementSource` 单例约束**：一个 `HTMLAudioElement` 只能被 `createMediaElementSource` 一次；切歌时 YinDong 用「disconnect 旧 mediaSource + 新建 audio 元素」规避（`connectAudioElement` 已断开旧源）。务必保留此模式，勿复用同一 audio 元素跨歌曲。
- **WASAPI 独占与共享模式互斥**：切换时需先 `disable_usb_exclusive_mode` 再走 HTML 路径，否则设备占用冲突。
- **IR 资源路径**：卷积混响 `.wav` 文件需随包发布，确认 Vite 能正确解析加载路径。
- **删除范围大**：阶段 2 删除后前端会大面积红，阶段 3-6 必须连续完成才能恢复编译；建议阶段 2-6 在同一工作单元内完成，不要中途提交半成品。
