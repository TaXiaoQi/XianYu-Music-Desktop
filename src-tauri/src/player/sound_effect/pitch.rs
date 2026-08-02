//! 变调/变速机架（阶段 8）。
//!
//! 三种模式：
//! 1. preservesPitch=false, pitchShift=100：纯变速变调 → 改变 Source 的 sample_rate()，
//!    样本直通无质量损失（rodio 按新采样率播放）。
//! 2. preservesPitch=true, rate≠100：变速不变调 → OLA 时间拉伸（Hann 窗 50% 重叠）。
//! 3. pitchShift≠100：变调不变速 → OLA 时间拉伸 + 线性重采样。
//!
//! OLA（Overlap-Add）固定窗时间拉伸：音调不变，仅改变时长。
//! 重采样：线性插值，改变音调。
//! 组合：stretch = 1/rate（preservesPitch 时），resample = pitch。
//!   输出样本数/输入样本数 = stretch × resample。
//!
//! 按声道独立处理，保持立体声相位关系。无互相关搜索（固定 OLA），瞬态有轻微伪影，
//! 对中等范围（0.5x~2x）的音乐播放可接受。

use rodio::source::SeekError;
use rodio::Source;
use std::collections::VecDeque;
use super::SoundEffectSettings;

const FRAME_SIZE: usize = 512;
const HOP_OUT: usize = 256; // 50% 重叠

/// 单声道的 OLA + 重采样状态
struct OlaChannel {
    /// 输入样本缓冲（该声道去交错后的样本）
    input: VecDeque<f32>,
    /// OLA 重叠累加环形缓冲（大小 FRAME_SIZE）
    ola: Vec<f32>,
    /// OLA 下一次写入位置
    ola_pos: usize,
    /// OLA 原始输出流（时间拉伸后、重采样前）
    ola_out: VecDeque<f32>,
    /// 重采样在 ola_out 上的浮点读取位置
    res_pos: f32,
    /// OLA 帧在 input 上的浮点读取位置
    in_pos: f32,
    /// Hann 窗
    window: Vec<f32>,
}

impl OlaChannel {
    fn new() -> Self {
        // Hann 窗
        let window: Vec<f32> = (0..FRAME_SIZE)
            .map(|i| {
                let n = i as f32 / (FRAME_SIZE - 1) as f32;
                0.5 - 0.5 * (2.0 * std::f32::consts::PI * n).cos()
            })
            .collect();
        Self {
            input: VecDeque::with_capacity(FRAME_SIZE * 4),
            ola: vec![0.0; FRAME_SIZE],
            ola_pos: 0,
            ola_out: VecDeque::with_capacity(FRAME_SIZE * 2),
            res_pos: 0.0,
            in_pos: 0.0,
            window,
        }
    }

    fn clear(&mut self) {
        self.input.clear();
        self.ola.fill(0.0);
        self.ola_pos = 0;
        self.ola_out.clear();
        self.res_pos = 0.0;
        self.in_pos = 0.0;
    }

    /// 从 input 在 in_pos 处取 FRAME_SIZE 样本，加窗写入 ola，输出 HOP_OUT 样本到 ola_out。
    /// 返回 false 表示输入不足（需补充）。
    fn process_frame(&mut self, stretch: f32) -> bool {
        let need = self.in_pos as usize + FRAME_SIZE;
        if self.input.len() < need {
            return false;
        }
        // 加窗写入 OLA 缓冲
        for i in 0..FRAME_SIZE {
            let s = self.input[(self.in_pos as usize) + i];
            self.ola[(self.ola_pos + i) % FRAME_SIZE] += s * self.window[i] * 2.0; // ×2 补偿 50% 重叠
        }
        // 输出 HOP_OUT 样本
        for i in 0..HOP_OUT {
            self.ola_out
                .push_back(self.ola[(self.ola_pos + i) % FRAME_SIZE]);
        }
        // 清空已输出的位置（避免下次累加脏数据）
        for i in 0..HOP_OUT {
            self.ola[(self.ola_pos + i) % FRAME_SIZE] = 0.0;
        }
        self.ola_pos = (self.ola_pos + HOP_OUT) % FRAME_SIZE;
        self.in_pos += HOP_OUT as f32 / stretch;

        // 清理 input 头部已消费样本（保留 2*FRAME_SIZE 安全余量，避免下次 process_frame 越界）
        // [关键修复] 原代码 `self.in_pos as usize - FRAME_SIZE` 在 in_pos < FRAME_SIZE 时
        // usize 减法溢出 panic（音频线程崩溃 → 播放一直加载）。改为先检查阈值再 drain，
        // 逻辑等价（仅当 in_pos > 2*FRAME_SIZE 时清理 in_pos - 2*FRAME_SIZE 个样本）。
        let in_pos_usize = self.in_pos as usize;
        if in_pos_usize > FRAME_SIZE * 2 {
            let d = in_pos_usize - FRAME_SIZE * 2;
            for _ in 0..d {
                self.input.pop_front();
            }
            self.in_pos -= d as f32;
        }
        true
    }

    /// 从 ola_out 线性重采样读取一个样本。resample>1 升调（产出更多样本），<1 降调。
    /// 返回 None 表示 ola_out 不足。
    fn read_resampled(&mut self, resample: f32) -> Option<f32> {
        loop {
            let idx = self.res_pos as usize;
            if idx + 1 >= self.ola_out.len() {
                // 不足，需要更多 OLA 输出
                return None;
            }
            let frac = self.res_pos - idx as f32;
            let s0 = self.ola_out[idx];
            let s1 = self.ola_out[idx + 1];
            let out = s0 + (s1 - s0) * frac;
            self.res_pos += resample;
            // 消费已过样本
            let consume = self.res_pos as usize;
            if consume > 0 {
                for _ in 0..consume {
                    self.ola_out.pop_front();
                }
                self.res_pos -= consume as f32;
            }
            return Some(out);
        }
    }
}

pub struct PitchRateProcessor {
    channels: usize,
    sample_rate: f32,
    /// 时间拉伸因子（>1 减速，<1 加速）。1 = 不拉伸
    stretch: f32,
    /// 重采样比（>1 升调，<1 降调）。1 = 不重采样
    resample: f32,
    /// 是否激活 OLA+重采样处理
    active: bool,
    /// 是否仅改变 sample_rate（纯变速变调，样本直通）
    sample_rate_mode: bool,
    /// sample_rate 倍率（sample_rate_mode 时生效）
    rate_multiplier: f32,
    chans: Vec<OlaChannel>,
    /// inner 是否已 EOF
    eof: bool,
}

impl PitchRateProcessor {
    pub fn new(channels: u16, sample_rate: u32) -> Self {
        let ch = channels as usize;
        Self {
            channels: ch,
            sample_rate: sample_rate as f32,
            stretch: 1.0,
            resample: 1.0,
            active: false,
            sample_rate_mode: false,
            rate_multiplier: 1.0,
            chans: (0..ch.max(1)).map(|_| OlaChannel::new()).collect(),
            eof: false,
        }
    }

    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        if channels != self.channels {
            self.channels = channels;
            self.chans = (0..channels.max(1)).map(|_| OlaChannel::new()).collect();
        } else {
            for c in &mut self.chans {
                c.clear();
            }
        }
    }

    pub fn reset(&mut self) {
        for c in &mut self.chans {
            c.clear();
        }
    }

    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        // 防御：0 或负值/NaN 视为 100（原调原速），避免极端值导致 OLA 缓冲爆炸或破音。
        let raw_rate = if !s.playback_rate.is_finite() || s.playback_rate <= 0.0 {
            100.0
        } else {
            s.playback_rate
        };
        let raw_pitch = if !s.pitch_shift.is_finite() || s.pitch_shift <= 0.0 {
            100.0
        } else {
            s.pitch_shift
        };
        let rate = (raw_rate / 100.0).clamp(0.25, 4.0);
        let pitch = (raw_pitch / 100.0).clamp(0.25, 4.0);

        let pitch_changed = (pitch - 1.0).abs() >= 0.001;
        let rate_changed = (rate - 1.0).abs() >= 0.001;

        // ================================================================
        // OLA 变调原理（关键修复）：
        // process_frame 中 in_pos += HOP_OUT / stretch，所以：
        //   stretch > 1 → in_pos 增量小 → 每帧读更少输入 → 输出更多样本 → EXPAND（减速）
        //   stretch < 1 → in_pos 增量大 → 每帧读更多输入 → 输出更少样本 → COMPRESS（加速）
        // read_resampled 中 res_pos += resample，所以：
        //   resample > 1 → 跳过样本 → 输出更少 → DOWNSAMPLE（升调+加速）
        //   resample < 1 → 重复样本 → 输出更多 → UPSAMPLE（降调+减速）
        //
        // 变调不变速（pitch shift）：需要 OLA EXPAND（stretch=pitch, 产出更多样本）+
        //   重采样 DOWNSAMPLE（resample=pitch, 跳回原数量并升调）。
        //   净样本数 = input * stretch / resample = input * pitch / pitch = input（速度不变✓）
        //   音调 = resample = pitch（升调✓）
        //
        // [旧 bug] 旧代码 stretch=1/pitch（COMPRESS）+ resample=pitch（DOWNSAMPLE），
        //   净样本 = input * (1/pitch) / pitch = input/pitch²（更少→更快 pitch²×），
        //   导致「跟着一起变速」——速度变 pitch² 倍而非不变！
        // ================================================================

        if !s.preserves_pitch {
            // === preservesPitch=false（变速变调，黑胶式）===
            // 速度+音调来自 rate 由 sample_rate 处理（样本直通，无 OLA）：
            //   sample_rate = inner * rate → 速度 rate×、音调 rate×
            // pitchShift 额外变调（变调不变速）：OLA stretch=pitch + resample=pitch
            //   净速度不变，音调 = rate * pitch
            self.rate_multiplier = rate;
            if !pitch_changed {
                self.sample_rate_mode = true;
                self.active = false;
                self.stretch = 1.0;
                self.resample = 1.0;
            } else {
                self.sample_rate_mode = false;
                self.stretch = pitch.clamp(0.25, 4.0); // EXPAND：产出更多样本供重采样消耗
                self.resample = pitch.clamp(0.25, 4.0); // DOWNSAMPLE：跳回原数量并升调
                self.active = true;
            }
            return;
        }

        // === preservesPitch=true（变速不变调）===
        // sample_rate 不变（rate_multiplier=1），速度由 OLA 时间拉伸处理。
        self.sample_rate_mode = false;
        self.rate_multiplier = 1.0;

        if !pitch_changed {
            // 纯变速（不变调）：OLA COMPRESS stretch=1/rate（加速），无重采样
            self.stretch = (1.0 / rate).clamp(0.25, 4.0);
            self.resample = 1.0;
            self.active = rate_changed;
        } else {
            // 变速+变调：stretch = pitch/rate, resample = pitch
            //   净样本 = input * (pitch/rate) / pitch = input/rate → 速度 rate×✓
            //   音调 = resample = pitch✓
            //   消耗率 = resample/stretch = pitch/(pitch/rate) = rate
            self.stretch = (pitch / rate).clamp(0.25, 4.0);
            self.resample = pitch.clamp(0.25, 4.0);
            self.active = true;
        }
    }

    /// 是否激活（非直通）
    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.active || self.sample_rate_mode
    }

    /// 有效采样率。
    /// - sample_rate_mode（纯变速变调直通）：inner_rate * rate_multiplier
    /// - OLA 激活且 rate_multiplier≠1（preservesPitch=false + 变调）：inner_rate * rate_multiplier
    ///   （速度由 sample_rate 处理，OLA 只做额外变调，净速度不变）
    /// - 其余：inner_rate 不变
    pub fn effective_sample_rate(&self, inner_rate: u32) -> u32 {
        if self.sample_rate_mode
            || (self.active && (self.rate_multiplier - 1.0).abs() >= 0.001)
        {
            ((inner_rate as f32) * self.rate_multiplier).round().max(1.0) as u32
        } else {
            inner_rate
        }
    }

    /// 从 inner 读取并填充一帧（channels 个样本）到 out。
    /// 返回 false 表示 inner 已结束且缓冲已耗尽。
    pub fn fill<I: Source<Item = f32>>(
        &mut self,
        inner: &mut I,
        out: &mut [f32],
    ) -> bool {
        let ch = self.channels.max(1);
        if !self.active && !self.sample_rate_mode {
            // 直通
            for i in 0..ch.min(out.len()) {
                if let Some(s) = inner.next() {
                    out[i] = s;
                } else {
                    return false;
                }
            }
            return true;
        }
        if self.sample_rate_mode {
            // 纯变速变调：样本直通，sample_rate 已调整
            for i in 0..ch.min(out.len()) {
                if let Some(s) = inner.next() {
                    out[i] = s;
                } else {
                    return false;
                }
            }
            return true;
        }

        // OLA + 重采样模式
        if !self.eof {
            self.ensure_input(inner);
        }
        let mut all_drained = true;
        for i in 0..ch.min(out.len()) {
            if let Some(s) = self.produce_sample(i) {
                out[i] = s;
                all_drained = false;
            } else {
                out[i] = 0.0;
            }
        }
        if self.eof && all_drained {
            return false;
        }
        true
    }

    /// 从 inner 非阻塞增量读取样本补充各声道 input。
    ///
    /// [关键修复] 原 ensure_input 每次只读 1 帧，但 OLA 变调时消耗率 = resample/stretch。
    /// 对于 pitch>1（升调），消耗率 = pitch² > 1，每输出 1 样本消耗 >1 输入样本，
    /// 而 ensure_input 只补充 1 样本 → 缓冲持续净流出 → 几百样本后耗尽 → 持续静音/卡顿。
    ///
    /// 现按消耗率动态决定每次读取帧数（向上取整，上限 16），并把缓冲目标设为
    /// `in_pos + FRAME_SIZE*2`（process_frame 需要 in_pos+FRAME_SIZE 可用，留 FRAME_SIZE
    /// 余量防抖）。每次 fill() 最多读 16 帧（覆盖 pitch≤4.0 的极端情况），本地文件几乎
    /// 无开销；网络流式播放单次最多阻塞 16×inner.next()（约 0.4ms~160ms，远好于旧 1024 次）。
    fn ensure_input<I: Source<Item = f32>>(&mut self, inner: &mut I) {
        if self.eof {
            return;
        }
        // 消耗率：每输出 1 样本平均消耗的输入样本数。stretch→0 / resample→∞ 时趋向 ∞，
        // clamp 到 [1, 16] 控制单次读取上限。
        let consumption = (self.resample / self.stretch).clamp(1.0, 16.0);
        let max_per_call = consumption.ceil() as usize;
        // 动态缓冲目标：process_frame 需要 in_pos + FRAME_SIZE 可用，留 FRAME_SIZE 余量。
        // 用各声道最大 in_pos 计算（声道间 in_pos 几乎同步，取最大保守）。
        let max_in_pos = self
            .chans
            .iter()
            .map(|c| c.in_pos)
            .fold(0.0_f32, f32::max) as usize;
        let target = max_in_pos + FRAME_SIZE * 2;

        for _ in 0..max_per_call {
            let need_more = self.chans.iter().any(|c| c.input.len() < target);
            if !need_more {
                break;
            }
            // 读取一帧交错样本（channels 个样本，每声道 1 个）
            let mut frame_eof = false;
            for ci in 0..self.channels {
                match inner.next() {
                    Some(s) => {
                        if ci < self.chans.len() {
                            self.chans[ci].input.push_back(s);
                        }
                    }
                    None => {
                        frame_eof = true;
                        if ci < self.chans.len() {
                            self.chans[ci].input.push_back(0.0);
                        }
                    }
                }
            }
            if frame_eof {
                self.eof = true;
                // 尾部补 0 让 OLA 自然衰减
                for _ in 0..FRAME_SIZE {
                    for ci in 0..self.channels {
                        if ci < self.chans.len() {
                            self.chans[ci].input.push_back(0.0);
                        }
                    }
                }
                break;
            }
        }
    }

    /// 产出第 ci 声道的一个样本（OLA + 重采样）。None 表示缓冲完全耗尽。
    fn produce_sample(&mut self, ci: usize) -> Option<f32> {
        if ci >= self.chans.len() {
            return None;
        }
        let stretch = self.stretch;
        let resample = self.resample;
        let mut guard = 0;
        loop {
            // 尝试重采样读取
            if let Some(s) = self.chans[ci].read_resampled(resample) {
                return Some(s);
            }
            // ola_out 不足，处理一个 OLA 帧
            if !self.chans[ci].process_frame(stretch) {
                // input 不足且无法补充
                return None;
            }
            guard += 1;
            if guard > 64 {
                // 安全阀，避免死循环
                return Some(0.0);
            }
        }
    }
}

/// 可选的 Source 装饰器：包裹已处理的 Source 以应用 sample_rate 调整。
/// 当前未直接使用（sample_rate 调整由 SoundEffectSource 转发），保留备用。
#[allow(dead_code)]
pub struct PitchRateSource<I> {
    inner: I,
    rate: f32,
}

impl<I: Source<Item = f32>> PitchRateSource<I> {
    #[allow(dead_code)]
    pub fn new(inner: I, rate: f32) -> Self {
        Self { inner, rate }
    }
}

impl<I: Source<Item = f32>> Iterator for PitchRateSource<I> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        self.inner.next()
    }
}

impl<I: Source<Item = f32>> Source for PitchRateSource<I> {
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        ((self.inner.sample_rate() as f32) * self.rate).round().max(1.0) as u32
    }
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn total_duration(&self) -> Option<std::time::Duration> {
        self.inner.total_duration()
    }
    fn try_seek(&mut self, pos: std::time::Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)
    }
}
