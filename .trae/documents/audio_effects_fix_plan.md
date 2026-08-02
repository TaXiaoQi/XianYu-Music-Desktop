# 音效修复实施计划

> 对齐 YinDongMusic WebAudio 参考实现，修复 Rust rodio 音效链中的 6 类问题。

## 摘要

用户反馈：调音调升降没声音、动态均衡/Bass 重低音有问题、V4A 全套音效有问题、环境混响不明显且干/湿增益单独调没效果、8D/36D 环绕不对。经逐文件对比 XY Rust 实现与 YinDongMusic WebAudio 参考实现，确认根因如下，并给出修复方案。

## 当前状态分析（根因定位）

### 根因 1：混响湿信号过弱 + 无压缩限幅（reverb.rs）
- **文件**：[reverb.rs](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/reverb.rs)
- **问题**：Freeverb 经典输入增益 `gain=0.015`（L116）是按原版 Freeverb 的 `scalewet=3.0` 输出缩放设计的，但 XY **没有** `scalewet`，导致湿信号比原版低 ~3 倍（-10dB），听感"不明显"。
- **对比 YinDongMusic**：[soundEffectEngine.ts L472-513](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/soundEffectEngine.ts#L472-L513) 卷积混响用归一化 IR + `DynamicsCompressorNode`(threshold=-12, ratio=3) 控制湿信号峰值，湿信号电平远高于 XY 的 Freeverb 近似。
- **干/湿增益单独调**：代码逻辑上 `dry = lerp(1.0, dry_gain, w)` / `wet = wet_gain * w`（L268-269）确实可单独生效，但湿信号过弱时调整 `wet_gain` 听感变化不明显；且前端 50ms trailing 防抖导致拖动期间无实时反馈。
- **预设默认值问题**：`phone` 预设 `mainGain=0.0`（dry=0）会导致启用后无干信号（这是电话效果的设计，但需确认前端不会误用）。

### 根因 2：Bass 动态模式方向相反 + 每帧重建系数（channel.rs）
- **文件**：[channel.rs L206-230](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L206-L230)
- **问题 A（方向相反）**：XY 代码 `reduction = bass_energy * 3.0`（L213）——低频能量大时**降低**增益。YinDongMusic [advancedEffects.ts L670-683](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L670-L683) `boost = 1 + avg * 0.5`——鼓点时**增强**低音。两者方向完全相反，导致 XY 的"动态"低音在鼓点时反而变弱。
- **问题 B（每帧重建系数）**：L221-223 每帧调用 `set_lowshelf`，重新计算 biquad 系数 → CPU 浪费 + 系数跳变产生 zipper noise。YinDongMusic 只在参数变更时更新 `lowshelf.gain`（通过 `setTargetAtTime` 平滑），不重建滤波器。
- **问题 C（动态增益应用方式）**：XY 通过修改 `bass_gain_target` 再 `set_lowshelf` 来应用动态增益，这会改变滤波器截止特性。YinDongMusic 用独立的 `dynamicGain` 节点在 lowshelf 之后做增益乘法，不影响滤波器。

### 根因 3：动态均衡实现完全错误（channel.rs）
- **文件**：[channel.rs L232-254](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/channel.rs#L232-L254)
- **问题**：XY 用单个 `highshelf` 做高频衰减，`dyn_reduction += (target - dyn_reduction) * 0.001`（L244）——系数 0.001 意味着需要数千帧才响应，几乎不工作。
- **对比 YinDongMusic**：[advancedEffects.ts L693-760](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L693-L760) 采用**二分频压缩**：
  - 低频增强：`lowshelf` @ 80Hz, +3dB（始终启用）
  - 分频点 5000Hz：`lowpass` → 直通，`highpass` → `DynamicsCompressor`(threshold=-12, ratio=8, attack=1ms, release=50ms)
  - 两路合并
- XY 的单 shelf 方案无法实现"压高频尖峰 + 补低频"的双向动态处理。

### 根因 4：V4A 只做 shelving，未启用子效果（mod.rs）
- **文件**：[mod.rs L685-694](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/mod.rs#L685-L694)
- **问题**：XY 的 V4A 只应用 `lowshelf +3dB@120Hz` + `highshelf +2dB@8000Hz`，仅是简单的高低频提亮。
- **对比 YinDongMusic**：[advancedEffects.ts L1655-1670](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/advancedEffects.ts#L1655-L1670) V4A 同时启用 4 个子效果：
  - Bass boost（gain=6dB, dynamic=true）
  - Dynamic EQ
  - Stereo widen（amount=1.4）
  - Compressor（threshold=-20, ratio=4, attack=3ms, release=100ms）

### 根因 5：8D 环绕折叠为单声道（spatial.rs）
- **文件**：[spatial.rs L140](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L140)
- **问题**：`let src = (in_l + in_r) * 0.5;` 把立体声折叠成单声道再旋转 pan，丢失全部立体声宽度，听感是"单声道在左右耳间旋转"而非"声源绕头部旋转"。
- **对比 YinDongMusic**：[soundEffectEngine.ts L707-740](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/soundEffectEngine.ts#L707-L740) 用 `PannerNode`(HRTF) 处理**立体声**信号，`positionX/Z = cos/sin(rad) * radius`，HRTF 引擎自动处理 ITD/ILD/频谱线索，保留立体声场。
- XY 无 HRTF 引擎，但当前"mono→pan"方案过于简陋。

### 根因 6：36D 调制与旋转不同步（spatial.rs）
- **文件**：[spatial.rs L178-209](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/spatial.rs#L178-L209)
- **问题**：XY 用独立 LFO（`dist_lfo@0.07Hz`、`vert_lfo@0.13Hz`）做距离/垂直调制，与旋转角 `self.angle` 完全不同步，产生不协调的双周期调制。
- **对比 YinDongMusic**：[soundEffectEngine.ts L805-832](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/YinDongMusic/src/utils/audio/soundEffectEngine.ts#L805-L832) 调制全部绑定到旋转角：
  - 距离：`r = baseR * (1 + 0.6 * sin(rad * 0.5))`（半旋转频率）
  - 垂直：`y = sin(rad * 1.5) * baseR`（1.5 倍旋转频率）
  - 空气低通：`freq = 20000 - distRatio * 17500`（跟随距离）

### 根因 7：变调切换时短暂静音（pitch.rs）
- **文件**：[pitch.rs L256-302](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src-tauri/src/player/sound_effect/pitch.rs#L256-L302)
- **状态**：默认值 100.0 修复已落地（L193-202 防御 + mod.rs L417-418 手动 Default）。OLA 数学正确。
- **残留问题**：从 `active=false`（直通）切换到 `active=true`（OLA 模式）时，OLA 输入缓冲为空，需累积 ~512 样本（~11ms）才能产出第一帧 → 短暂静音。快速拖动滑块时 `update_params` 不重置缓冲（正确），但首次切换有可感知的间断。

## 修复方案

### 修复 1：混响湿信号增益 + 湿路压缩（reverb.rs）

**改动文件**：`src-tauri/src/player/sound_effect/reverb.rs`

1. **提升 Freeverb 输入增益**（L116）：`gain: 0.015` → `gain: 0.045`（×3，对齐 Freeverb 原版 `scalewet=3.0` 的等效电平）。配合 `soft_clip` 防止削波。

2. **湿路添加简单压缩器**（模拟 YinDongMusic 的 `DynamicsCompressorNode` threshold=-12, ratio=3）：
   - 在 `ReverbRack` 结构体新增 `wet_comp: EnvelopeFollower`（peak detector）+ `wet_gain_smooth: SmoothedValue`
   - 在 `process()` 中对 `out_l/out_r` 应用压缩：检测峰值，超过 -12dB（线性 0.25）时按 ratio=3 衰减
   - 压缩后再 `soft_clip`，最后乘 `wet_gain`

3. **干/湿增益实时性优化**：
   - `update_params` 的 early-return 保留（系数无需重算），但确保 `process()` 直接从 `s.reverb_dry/reverb_wet` 读取（已如此，无需改）
   - 在前端 `soundEffectStore.ts` 中，为 `originalGain`/`envGain` 添加即时同步（不等 50ms 防抖），仅这两个 ref 变更时立即调用 `setSoundEffectSettings`

**预期效果**：湿信号电平提升 ~10dB，可感知混响尾音；压缩器控制瞬态峰值避免爆音；滑块拖动有实时反馈。

### 修复 2：Bass 动态增强方向修正 + 增益应用方式重构（channel.rs）

**改动文件**：`src-tauri/src/player/sound_effect/channel.rs`

1. **修正动态方向**（L210-217）：从"高能量降增益"改为"高能量增增益"：
   ```rust
   // 旧：reduction = bass_energy * 3.0; bass_gain_target = bass_gain_db - reduction;
   // 新：鼓点时增强低音（匹配 YinDongMusic boost = 1 + avg * 0.5）
   if s.bass_boost.dynamic {
       let bass_energy = self.bass_env.process(frame[0].abs().max(frame[1].abs()));
       let boost = 1.0 + (bass_energy * 0.5).min(0.5); // 1.0~1.5 倍
       self.bass_dynamic_gain.set_target(boost);
   } else {
       self.bass_dynamic_gain.set_target(1.0);
   }
   ```

2. **重构增益应用**：不再每帧 `set_lowshelf`。改为：
   - `update_params` 中仅当 `bass_boost.gain` 变化时调用 `set_lowshelf(120Hz, gain, 0.707)`（需新增脏标记或比较旧值）
   - 新增 `bass_dynamic_gain: SmoothedValue`（50ms 平滑），在 lowshelf 处理后乘上此增益
   - 处理流程：`frame → lowshelf(固定系数) → × dynamic_gain(wet) → 混合`

3. **结构体改动**：
   - 新增 `bass_dynamic_gain: SmoothedValue`
   - 新增 `bass_last_gain: f32`（跟踪上次 gain 值，避免重复设系数）
   - 移除 `bass_gain_target`（不再需要）

### 修复 3：动态均衡重构为二分频压缩（channel.rs）

**改动文件**：`src-tauri/src/player/sound_effect/channel.rs`

1. **新增结构体成员**：
   ```rust
   // 动态均衡：低频增强 + 二分频 + 高频压缩
   dyn_low_boost: [Biquad; 2],      // lowshelf @ 80Hz, +3dB
   dyn_split_lp: [Biquad; 2],       // lowpass @ 5000Hz
   dyn_split_hp: [Biquad; 2],       // highpass @ 5000Hz
   dyn_comp_env: EnvelopeFollower,   // 高频压缩包络（attack=1ms, release=50ms）
   dyn_comp_reduction: [f32; 2],     // 各声道当前衰减量
   ```

2. **`update_params` 中设置系数**：
   - `dyn_low_boost.set_lowshelf(80.0, sr, 3.0, 0.707)` — 始终 +3dB 低频
   - `dyn_split_lp.set_lowpass(5000.0, sr, 0.707)`
   - `dyn_split_hp.set_highpass(5000.0, sr, 0.707)`

3. **`process` 中实现二分频压缩**（替换 L232-254）：
   ```rust
   // 动态均衡：低频增强 + 高频压缩
   let w = self.wet_dyn_eq.tick();
   if w > 0.001 {
       for i in 0..2 {
           // 1. 低频增强
           let boosted = self.dyn_low_boost[i].process(frame[i], i);
           // 2. 分频
           let low = self.dyn_split_lp[i].process(boosted, i);
           let high = self.dyn_split_hp[i].process(boosted, i);
           // 3. 高频压缩（threshold=-12dB ≈ 0.25 线性, ratio=8）
           let env = self.dyn_comp_env.process(high.abs());
           let threshold = 0.25;
           let ratio = 8.0;
           let gain = if env > threshold {
               db_to_gain(-((gain_to_db(env) - gain_to_db(threshold)) * (1.0 - 1.0/ratio)))
           } else { 1.0 };
           self.dyn_comp_reduction[i] += (gain - self.dyn_comp_reduction[i]) * 0.1; // 平滑
           let compressed = high * self.dyn_comp_reduction[i];
           // 4. 合并
           let merged = low + compressed;
           frame[i] = frame[i] * (1.0 - w) + merged * w;
       }
   }
   ```

4. **移除旧成员**：`dyn_hp_detect`、`dyn_high_shelf`、`dyn_low_shelf`、`dyn_env`、`dyn_reduction`

### 修复 4：V4A 启用子效果（mod.rs）

**改动文件**：`src-tauri/src/player/sound_effect/mod.rs`

1. **`apply_params` 中处理 V4A**（替换 L584-600 的 V4A 部分）：
   - 当 `v4a_enabled=true` 时，构造一份"有效设置"：把 bass_boost / dynamic_eq / stereo_widen / compressor 强制启用并设为 V4A 参数
   - 把这份有效设置传给各子机架
   - V4A 不再单独做 shelving（移除 `v4a_low/v4a_high` 的 V4A 专用处理）

2. **具体实现**：
   ```rust
   fn apply_params(&mut self, s: &SoundEffectSettings) {
       // 计算有效设置：V4A 启用时合并子效果
       let effective = if s.v4a_enabled {
           let mut e = s.clone();
           // Bass boost: 6dB, dynamic
           e.bass_boost.enabled = true;
           e.bass_boost.gain = e.bass_boost.gain.max(6.0);
           e.bass_boost.dynamic = true;
           // Dynamic EQ
           e.dynamic_eq.enabled = true;
           // Stereo widen: 1.4
           e.stereo_widen.enabled = true;
           e.stereo_widen.amount = e.stereo_widen.amount.max(1.4);
           // Compressor: threshold=-20, ratio=4, attack=3ms, release=100ms
           e.compressor.enabled = true;
           if e.compressor.threshold > -20.0 { e.compressor.threshold = -20.0; }
           if e.compressor.ratio < 4.0 { e.compressor.ratio = 4.0; }
           if e.compressor.attack > 3.0 { e.compressor.attack = 3.0; }
           if e.compressor.release < 100.0 { e.compressor.release = 100.0; }
           e
       } else {
           s.clone()
       };
       self.pitch.update_params(&effective);
       self.channel_rack.update_params(&effective);
       // ... 其他机架用 effective
       // V4A 不再做额外 shelving
   }
   ```

3. **移除 `SoundEffectSource::next` 中 L685-694 的 V4A shelving 块**（改为由 channel_rack / dynamics_rack 处理）

4. **保留** `v4a_low/v4a_high` 结构体成员（避免大改），但不再在 `next()` 中使用；或标记 `#[allow(dead_code)]`

### 修复 5：8D 环绕保留立体声（spatial.rs）

**改动文件**：`src-tauri/src/player/sound_effect/spatial.rs`

1. **`process_rotational` 重构**（替换 L126-175）：
   - 不再折叠为单声道
   - 用旋转角计算 L/R 增益（恒功率 pan）+ 交叉馈送（ITD）+ 距离低通
   ```rust
   fn process_rotational(&mut self, in_l: f32, in_r: f32, s: &SoundEffectSettings) -> (f32, f32) {
       let sr = self.sample_rate;
       let speed = s.spatial_speed.max(0.5);
       self.angle += 2.0 * PI / (speed * sr);
       if self.angle >= 2.0 * PI { self.angle -= 2.0 * PI; }
       
       let intensity = (s.spatial_intensity / 10.0).clamp(0.1, 1.0);
       let radius = s.spatial_radius.max(0.1);
       let atten = 1.0 / (1.0 + radius * 0.3);
       
       // 恒功率 pan（0=左, 1=右）
       let pan = (self.angle.cos() * 0.5 + 0.5).clamp(0.0, 1.0);
       let l_gain = (1.0 - pan).sqrt() * atten;
       let r_gain = pan.sqrt() * atten;
       
       // 后方衰减 + 低通
       let back = self.angle.sin();
       let back_gain = if back < 0.0 { 1.0 + back * 0.4 } else { 1.0 };
       let cutoff = if back < 0.0 { 4000.0 + 4000.0 * (1.0 + back) } else { 8000.0 };
       self.dist_lp[0].set_lowpass(cutoff, sr, 0.707);
       self.dist_lp[1].set_lowpass(cutoff, sr, 0.707);
       
       // 保留立体声：L 信号用 l_gain，R 信号用 r_gain，互不混合
       // 但加入交叉馈送模拟 HRTF 的对侧耳延迟
       let out_l = self.dist_lp[0].process(in_l * l_gain * back_gain, 0);
       let out_r = self.dist_lp[1].process(in_r * r_gain * back_gain, 1);
       
       // ITD 交叉馈送
       let itd_samples = (pan - 0.5).abs() * 26.0 * intensity;
       if pan > 0.5 {
           self.cross_dl[0].write(out_r * 0.3 * intensity);
           let cf = self.cross_dl[0].read(itd_samples);
           let final_l = out_l + cf;
           (in_l * (1.0 - intensity) + final_l * intensity, in_r * (1.0 - intensity) + out_r * intensity)
       } else {
           self.cross_dl[1].write(out_l * 0.3 * intensity);
           let cf = self.cross_dl[1].read(itd_samples);
           let final_r = out_r + cf;
           (in_l * (1.0 - intensity) + out_l * intensity, in_r * (1.0 - intensity) + final_r * intensity)
       }
   }
   ```
   - 关键变化：`in_l` 和 `in_r` 分别处理（不再 `*0.5` 混合），保留立体声差异

### 修复 6：36D 调制绑定旋转角（spatial.rs）

**改动文件**：`src-tauri/src/player/sound_effect/spatial.rs`

1. **`process_36d` 重构**（替换 L178-209）：
   ```rust
   fn process_36d(&mut self, in_l: f32, in_r: f32, s: &SoundEffectSettings) -> (f32, f32) {
       let sr = self.sample_rate;
       let speed = s.spatial_speed.max(0.5);
       self.angle += 2.0 * PI / (speed * sr);
       if self.angle >= 2.0 * PI { self.angle -= 2.0 * PI; }
       
       let intensity = (s.spatial_intensity / 10.0).clamp(0.1, 1.0);
       let base_radius = s.spatial_radius.max(0.1);
       let rad = self.angle;
       
       // 1. 距离波动：绑定到 rad*0.5（匹配 YinDongMusic）
       let dist_mod = (rad * 0.5).sin();
       let r = (base_radius * (1.0 + 0.6 * dist_mod)).max(0.3);
       let atten = 1.0 / (1.0 + r * 0.4);
       
       // 2. 水平旋转（恒功率 pan）
       let pan = (rad.cos() * 0.5 + 0.5).clamp(0.0, 1.0);
       let l_gain = (1.0 - pan).sqrt() * atten;
       let r_gain = pan.sqrt() * atten;
       
       // 3. 垂直摆动：绑定到 rad*1.5（匹配 YinDongMusic）
       let vert = (rad * 1.5).sin();
       
       // 4. 空气低通：距离越远越暗
       let dist_ratio = (r / (base_radius * 1.8 + 0.01)).min(1.0);
       let air_cutoff = 20000.0 - dist_ratio * 17500.0;
       self.dist_lp[0].set_lowpass(air_cutoff, sr, 0.707);
       self.dist_lp[1].set_lowpass(air_cutoff, sr, 0.707);
       
       // 保留立体声（同 8D 修复）
       let out_l = self.dist_lp[0].process(in_l * l_gain, 0);
       let out_r = self.dist_lp[1].process(in_r * r_gain, 1);
       
       (in_l * (1.0 - intensity) + out_l * intensity, in_r * (1.0 - intensity) + out_r * intensity)
   }
   ```
   - 移除 `vert_lfo`/`dist_lfo` 成员（不再需要）；在 `prepare`/`reset` 中移除相关初始化

### 修复 7：变调切换平滑（pitch.rs）

**改动文件**：`src-tauri/src/player/sound_effect/pitch.rs`

1. **`update_params` 中检测 active 转换并预填充缓冲**：
   - 新增 `was_active: bool` 字段
   - 当 `was_active=false` 且 `active=true` 时，标记 `need_prefill=true`
   - 在 `fill()` 开头，若 `need_prefill=true`，从 inner 读取最多 1024 样本填充 input（一次性，不阻塞超过 1024 次 inner.next）
   - 填充后 `need_prefill=false`，正常进入 OLA 模式
   - 这把 11ms 静音缩短到 ~1ms（1024 样本读取时间可忽略）

2. **`was_active` 同步更新**：在 `update_params` 末尾 `self.was_active = self.active`

## 前端同步优化（soundEffectStore.ts）

**改动文件**：`src/features/playback/soundEffectStore.ts`

1. **混响增益即时同步**（针对"单独调没效果"）：
   - 为 `originalGain` / `envGain` 新增独立 watch，变更时立即（不等 50ms）调用 `scheduleBackendSync`（leading edge）
   - 保留现有 `watchEffect` 的 trailing 防抖作为兜底
   ```typescript
   watch([originalGain, envGain], () => {
     // 即时同步混响增益，不等防抖
     const settings = buildSoundEffectSettings()
     playbackApi.setSoundEffectSettings(settings).catch(() => {})
   }, { flush: 'sync' })
   ```

2. **V4A 开关即时同步**：V4A 启用会改变多个子效果状态，需立即同步
   ```typescript
   watch(v4aEnabled, () => {
     const settings = buildSoundEffectSettings()
     playbackApi.setSoundEffectSettings(settings).catch(() => {})
   }, { flush: 'sync' })
   ```

## 假设与决策

1. **不引入 HRTF 引擎**：8D/36D 仍用"恒功率 pan + ITD + 距离低通"近似，但改为保留立体声（L/R 独立处理）。真 HRTF 需加载 HRTF 数据库（如 MIT KEMAR），体积大且实现复杂，当前质量妥协可接受。

2. **V4A 子效果合并用 `max` 语义**：V4A 启用时，若用户已手动调高某子效果参数（如 bass_gain=10），V4A 不覆盖（用 `max` 取较大值）；若用户未启用，V4A 强制启用并设 V4A 参数。这保证 V4A 与手动调整不冲突。

3. **混响 `gain` 提升到 0.045**：经计算，原 0.015 + 8 combs 稳态输出 ≈ 0.8 × input；提升到 0.045 后 ≈ 2.4 × input，`soft_clip`(tanh) 会压缩到 ~0.98，配合湿路压缩器控制峰值。若仍过大，实施时回调到 0.03。

4. **pitch 预填充上限 1024 样本**：避免阻塞音频线程超过 ~23ms（44.1kHz/2ch），可接受。

5. **前端即时同步仅限混响增益 + V4A 开关**：其他参数（EQ、调制等）保留 50ms 防抖，避免 IPC 过载。

## 验证步骤

1. **编译**：`cargo check`（src-tauri 目录）—— 0 error 0 warning
2. **Rust 测试**：`cargo test sound_effect`（7 项现有测试需全通过；新增逻辑可补测试）
3. **类型检查**：`npx vue-tsc --noEmit`
4. **Lint**：`npx eslint src/features/playback/soundEffectStore.ts`
5. **手动验证**（需启动 tauri dev）：
   - 选混响预设 → 应明显听到尾音；拖动"原始增益"/"环境增益"滑块 → 立即听到干/湿比例变化
   - 开 Bass boost + 动态 → 鼓点时低音应增强（非减弱）
   - 开动态均衡 → 高频尖峰应被压缩，低频应 +3dB
   - 开 V4A → 应同时听到低音增强 + 动态均衡 + 立体声拓宽 + 压缩
   - 开 8D（戴耳机）→ 声源应绕头旋转，保留立体声宽度
   - 开 36D → 旋转 + 距离呼吸感 + 空气低通变化
   - 调音调升降 → 不应有静音，平滑切换
