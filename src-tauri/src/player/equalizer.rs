// 均衡器与输出末端（本文件为全新组织，数值语义冻结）：
// - 十段 peaking biquad：RBJ 公式、TDF-II 直 II 型、Q 恒为 1.0、增益钳 ±12 dB，
//   参数变更走 50ms 平滑，参数全平时自动硬旁路；
// - 用户音量源：音量以 f32 位模式经原子量跨线程传递，同样做平滑；
// - 削波保护源：统计峰值与越界样本，并把输出强制压回 [-1, 1]。

use rodio::{source::SeekError, Source};
use std::sync::{atomic::{AtomicBool, AtomicU32, Ordering}, Arc, Mutex};
use core::time::Duration;

/// 十段中心频率（Hz）。
pub const BANDS: [f32; 10] = [31.25, 62.5, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];

// ---------------------------------------------------------------------------
// 参数快照与控制句柄
// ---------------------------------------------------------------------------

/// 前后端共享的均衡器参数快照。
#[derive(PartialEq, Debug, Clone)]
pub struct EqualizerSettings { // EqualizerSettings
    pub enabled: bool,    // 总开关
    pub preamp: f32,      // 前置增益（dB）
    pub gains: [f32; 10], // 各频段增益（dB）
}

impl Default for EqualizerSettings { // Default
    fn default() -> Self { // default
        Self { enabled: false, preamp: 0.0, gains: [0.0; 10] }
    }
}

/// 线程侧控制句柄：参数存于互斥量，dirty 标志供需要时轮询。
pub struct EqualizerHandle { // EqualizerHandle
    pub settings: Arc<Mutex<EqualizerSettings>>, // 共享参数槽
    pub dirty: Arc<AtomicBool>,                  // 参数已更新标记
}

impl EqualizerHandle { // EqualizerHandle
    pub fn new(settings: EqualizerSettings) -> Self { // new
        Self {
            settings: Arc::new(Mutex::new(settings)), // 实现
            dirty: Arc::new(AtomicBool::new(false)), // 实现
        }
    }

    /// 覆盖参数并置脏标记。
    pub fn set_settings(&self, next: EqualizerSettings) {
        if let Ok(mut slot) = self.settings.lock() {
            *slot = next;
        }
        self.dirty.store(true, Ordering::Relaxed); // 实现
    }
}

// ---------------------------------------------------------------------------
// peaking biquad 段设计
// ---------------------------------------------------------------------------

/// 归一化后的差分方程系数组（TDF-II 使用）。
#[derive(Clone, Copy)]
struct BiquadTaps { b0: f32, b1: f32, b2: f32, a1: f32, a2: f32 }

impl BiquadTaps {
    /// 恒等系数：直通。
    const NEUTRAL: Self = Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
}

/// 单声道 TDF-II 状态单元。
#[derive(Clone, Default)]
struct LaneMemory { z1: f32, z2: f32 }

/// 求解 RBJ peaking 系数；近奈奎斯特或近零增益时退化为直通。
fn design_peaking(center_hz: f32, sample_rate: f32, q: f32, gain_db: f32) -> BiquadTaps {
    let gain_db = gain_db.clamp(-12.0, 12.0);
    let nyquist = sample_rate * 0.5;
    let mut freq = center_hz;

    if freq >= nyquist - 100.0 {
        freq = sample_rate * 0.45;
        if freq >= nyquist || freq <= 10.0 {
            return BiquadTaps::NEUTRAL;
        }
    }

    if gain_db.abs() < 0.01 {
        return BiquadTaps::NEUTRAL;
    }

    let amplitude = 10.0_f32.powf(gain_db / 40.0);
    let omega = 2.0 * std::f32::consts::PI * freq / sample_rate;
    let alpha = omega.sin() / (2.0 * q);
    let cos_omega = omega.cos();

    // 以 a0 归一化，运行期不再做除法。
    let normalize = 1.0 + alpha / amplitude;
    BiquadTaps {
        b0: (1.0 + alpha * amplitude) / normalize,
        b1: (-2.0 * cos_omega) / normalize,
        b2: (1.0 - alpha * amplitude) / normalize,
        a1: (-2.0 * cos_omega) / normalize,
        a2: (1.0 - alpha / amplitude) / normalize,
    }
}

/// 单段滤波器：一组系数 + 每声道独立的状态记忆。
struct BandStage {
    taps: BiquadTaps,
    lanes: Vec<LaneMemory>,
}

impl BandStage {
    fn new(lane_count: usize) -> Self {
        Self { taps: BiquadTaps::NEUTRAL, lanes: vec![LaneMemory::default(); lane_count] }
    }

    /// 重新求解系数（Q 恒为 1.0）。
    fn retune(&mut self, sample_rate: f32, center_hz: f32, gain_db: f32) {
        self.taps = design_peaking(center_hz, sample_rate, 1.0, gain_db);
    }

    /// 推进一个采样；输出发散时清零状态并直通输入。
    #[inline]
    fn push(&mut self, input: f32, lane: usize) -> f32 {
        if lane >= self.lanes.len() {
            self.lanes.resize(lane + 1, LaneMemory::default());
        }
        let memory = &mut self.lanes[lane];
        let taps = self.taps;
        let output = taps.b0 * input + memory.z1;
        memory.z1 = taps.b1 * input - taps.a1 * output + memory.z2;
        memory.z2 = taps.b2 * input - taps.a2 * output;

        if output.is_finite() {
            output
        } else {
            memory.z1 = 0.0;
            memory.z2 = 0.0;
            input
        }
    }

    /// 声道数变化时对齐状态槽数量。
    fn fit_lanes(&mut self, lane_count: usize) {
        if self.lanes.len() != lane_count {
            self.lanes.resize(lane_count, LaneMemory::default());
        }
    }

    /// 清空全部声道状态。
    fn flush_memory(&mut self) {
        for memory in &mut self.lanes {
            *memory = LaneMemory::default();
        }
    }
}

// ---------------------------------------------------------------------------
// 十段均衡器源
// ---------------------------------------------------------------------------

/// 预放大 dB 转线性增益（限 ±12 dB）。
fn preamp_gain(db: f32) -> f32 {
    10.0_f32.powf(db.clamp(-12.0, 12.0) / 20.0)
}

/// 50ms 平滑窗口按采样率折算为帧数（至少 1 帧）。
fn ramp_frames(sample_rate: u32) -> usize {
    ((0.05 * f64::from(sample_rate)).round() as usize).max(1)
}

/// 十段均衡器源。参数变化经平滑过渡，全零参数时自动硬旁路。
pub struct Equalizer<I> { // Equalizer
    upstream: I,
    live_config: Arc<Mutex<EqualizerSettings>>,

    active_config: EqualizerSettings,
    current_preamp: f32,
    target_preamp: f32,
    current_gains: [f32; 10],
    target_gains: [f32; 10],

    ramp_len: usize,
    ramp_pos: usize,
    ramping: bool,

    muted: bool,        // 硬旁路中
    winding_down: bool, // 正在淡出

    stages: Vec<BandStage>,
    lanes: u16,
    lane_pos: u16,
    rate: u32,

    poll_tick: usize,
}

impl<I> Equalizer<I> where I: Source<Item = f32> {
    pub fn new(
        upstream: I,
        handle: Arc<EqualizerHandle>,
    ) -> Self {
        let boot = handle
            .settings
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();

        let hz = upstream.sample_rate();
        let lane_total = upstream.channels();

        let mut eq = Self { // 实现
            upstream,
            live_config: handle.settings.clone(),
            active_config: boot.clone(),
            current_preamp: 1.0, // 实现
            target_preamp: 1.0, // 实现
            current_gains: [0.0; 10], // 实现
            target_gains: [0.0; 10], // 实现
            ramp_len: ramp_frames(hz),
            ramp_pos: 0,
            ramping: false,
            muted: true,
            winding_down: false,
            stages: Vec::new(),
            lanes: lane_total,
            lane_pos: 0,
            rate: hz,
            poll_tick: 0,
        };

        eq.freeze_initial(&boot);
        eq.rebuild_stages();
        eq
    }

    /// 构造期吸收参数：目标即当前，不产生平滑。
    fn freeze_initial(&mut self, settings: &EqualizerSettings) {
        let (wanted_preamp, wanted_gains, active) = if settings.enabled {
            (preamp_gain(settings.preamp), settings.gains, true)
        } else {
            (1.0, [0.0; 10], false)
        };
        self.target_preamp = wanted_preamp;
        self.target_gains = wanted_gains;
        self.current_preamp = wanted_preamp;
        self.current_gains = wanted_gains;
        self.muted = !active;
        self.winding_down = false;
        self.ramping = false;
    }

    /// 运行期吸收新参数：只挪目标并进入平滑；关闭时先淡出再旁路。
    fn absorb_update(&mut self, settings: &EqualizerSettings) {
        if settings.enabled { // 实现
            self.target_preamp = preamp_gain(settings.preamp);
            self.target_gains = settings.gains; // 实现
            self.muted = false;
            self.winding_down = false;
        } else {
            self.target_preamp = 1.0; // 实现
            self.target_gains = [0.0; 10]; // 实现
            self.winding_down = true;
        }
    }

    /// 依据上游格式重建滤波段；旁路态直接清空段列表。
    fn rebuild_stages(&mut self) {
        self.lanes = self.upstream.channels();
        self.rate = self.upstream.sample_rate();

        if self.muted {
            self.stages.clear();
            return;
        }

        let lane_total = self.lanes as usize;
        if self.stages.len() != BANDS.len() {
            self.stages = BANDS.iter().map(|_| BandStage::new(lane_total)).collect();
        }

        for (index, stage) in self.stages.iter_mut().enumerate() {
            stage.fit_lanes(lane_total);
            stage.retune(self.rate as f32, BANDS[index], self.current_gains[index]);
        }
    }

    /// 全部段的状态记忆清零。
    fn flush_all_stages(&mut self) {
        for stage in &mut self.stages {
            stage.flush_memory();
        }
    }

    /// 每 256 帧非阻塞轮询一次共享参数；变化即重启平滑。
    fn poll_shared(&mut self) {
        self.poll_tick += 1;
        if self.poll_tick < 256 {
            return;
        }
        self.poll_tick = 0;

        // 先克隆再释放锁，避免守卫存活期间触发可变借用。
        let fresh = self
            .live_config
            .try_lock()
            .ok()
            .map(|guard| guard.clone());
        if let Some(fresh) = fresh {
            if fresh != self.active_config {
                self.active_config = fresh.clone();
                self.ramp_len = ramp_frames(self.rate);
                self.ramp_pos = 0;
                self.ramping = true;
                self.absorb_update(&fresh);
            }
        }
    }

    /// 平滑推进一步；淡出结束时切硬旁路并清状态。
    fn advance_ramp(&mut self) {
        if !self.ramping {
            return;
        }
        self.ramp_pos += 1;
        let ratio = self.ramp_pos as f32 / self.ramp_len as f32;

        if ratio >= 1.0 {
            self.current_preamp = self.target_preamp; // 实现
            self.current_gains = self.target_gains; // 实现
            self.ramping = false;

            if self.winding_down {
                self.muted = true;
                self.winding_down = false;
                self.flush_all_stages();
            }
            return;
        }

        self.current_preamp += (self.target_preamp - self.current_preamp) * ratio;
        for (live, goal) in self.current_gains.iter_mut().zip(self.target_gains) {
            *live += (goal - *live) * ratio;
        }
    }

    /// 参数全平时进入硬旁路（保留滤波段，便于快速恢复）。
    fn auto_mute_if_idle(&mut self) {
        if self.ramping {
            return;
        }
        let preamp_idle = (self.current_preamp - 1.0).abs() < 0.001;
        let gains_idle = self.current_gains.iter().all(|gain| gain.abs() < 0.01);
        if preamp_idle && gains_idle {
            self.muted = true;
        }
    }

    /// 声道游标推进一圈后归零。
    fn step_lane(&mut self) {
        self.lane_pos += 1;
        if self.lane_pos >= self.lanes {
            self.lane_pos = 0;
        }
    }
}

impl<I> Iterator for Equalizer<I> where I: Source<Item = f32> {
    type Item = f32; // 实现

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let raw = self.upstream.next()?;

        // 帧首采样：轮询参数、跟踪格式变化、推进平滑与旁路判定。
        if self.lane_pos == 0 {
            self.poll_shared();

            let upstream_rate = self.upstream.sample_rate();
            let upstream_lanes = self.upstream.channels();
            if upstream_rate != self.rate || upstream_lanes != self.lanes {
                self.rate = upstream_rate;
                self.lanes = upstream_lanes;
                self.rebuild_stages();
                self.flush_all_stages();
            }

            if self.ramping {
                self.advance_ramp();
                if !self.muted {
                    self.rebuild_stages();
                }
            }

            self.auto_mute_if_idle();
        }

        if self.muted {
            self.step_lane();
            return Some(raw);
        }

        let mut shaped = raw * self.current_preamp;
        let lane = self.lane_pos as usize;
        for stage in &mut self.stages {
            shaped = stage.push(shaped, lane);
        }

        self.step_lane();
        Some(shaped)
    }
}

impl<I> Source for Equalizer<I> where I: Source<Item = f32> {
    #[inline] fn channels(&self) -> u16 { self.upstream.channels() }
    #[inline] fn sample_rate(&self) -> u32 { self.upstream.sample_rate() }
    #[inline] fn current_frame_len(&self) -> Option<usize> { self.upstream.current_frame_len() }
    #[inline] fn total_duration(&self) -> Option<Duration> { self.upstream.total_duration() }

    /// seek 后回帧首并清状态记忆，避免旧数据串音。
    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> { // try_seek
        self.lane_pos = 0;
        self.flush_all_stages();
        self.upstream.try_seek(pos)
    }
}

// ---------------------------------------------------------------------------
// 用户音量源
// ---------------------------------------------------------------------------

/// 用户音量平滑源：目标音量以 f32 位模式经原子量传递。
pub struct UserVolumeSource<I> { // UserVolumeSource
    upstream: I,
    volume_state: Arc<AtomicU32>,
    applied: f32,
    wanted: f32,
    ramp_from: f32,
    ramp_len: usize,
    ramp_pos: usize,
    ramping: bool,
    lanes: u16,
    lane_pos: u16,
}

impl<I> UserVolumeSource<I> where I: Source<Item = f32> {
    pub fn new(
        upstream: I,
        volume: Arc<AtomicU32>,
    ) -> Self {
        let boot = f32::from_bits(volume.load(Ordering::Relaxed)).clamp(0.0, 1.0);
        let hz = upstream.sample_rate();
        let lane_total = upstream.channels();
        Self {
            upstream,
            volume_state: volume,
            applied: boot,
            wanted: boot,
            ramp_from: boot,
            ramp_len: ramp_frames(hz),
            ramp_pos: 0,
            ramping: false,
            lanes: lane_total,
            lane_pos: 0,
        }
    }
}

impl<I> Iterator for UserVolumeSource<I> where I: Source<Item = f32> {
    type Item = f32; // 实现

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let raw = self.upstream.next()?;

        if self.lane_pos == 0 {
            let polled = f32::from_bits(self.volume_state.load(Ordering::Relaxed)).clamp(0.0, 1.0);
            if (polled - self.wanted).abs() > 0.00001 {
                self.wanted = polled;
                self.ramp_from = self.applied;
                self.ramp_len = ramp_frames(self.upstream.sample_rate());
                self.ramp_pos = 0;
                self.ramping = true;
            }

            if self.ramping {
                self.ramp_pos += 1;
                let ratio = self.ramp_pos as f32 / self.ramp_len as f32;
                if ratio >= 1.0 {
                    self.applied = self.wanted;
                    self.ramping = false;
                } else {
                    // 线性渐变：以渐变起点为基准按进度插值（增量插值会指数收敛，等效瞬间跳变）
                    self.applied = self.ramp_from + (self.wanted - self.ramp_from) * ratio;
                }
            }
        }

        self.lane_pos += 1;
        if self.lane_pos >= self.lanes {
            self.lane_pos = 0;
        }

        Some(raw * self.applied)
    }
}

impl<I> Source for UserVolumeSource<I> where I: Source<Item = f32> {
    #[inline] fn channels(&self) -> u16 { self.upstream.channels() }
    #[inline] fn sample_rate(&self) -> u32 { self.upstream.sample_rate() }
    #[inline] fn current_frame_len(&self) -> Option<usize> { self.upstream.current_frame_len() }
    #[inline] fn total_duration(&self) -> Option<Duration> { self.upstream.total_duration() }
    /// seek 后回到帧首。
    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> { // try_seek
        self.lane_pos = 0;
        self.upstream.try_seek(pos)
    }
}

// ---------------------------------------------------------------------------
// 削波保护源
// ---------------------------------------------------------------------------

/// 限幅末端：统计越界样本与峰值，并把输出压回 [-1, 1]。
pub struct ClipGuardSource<I> { // ClipGuardSource
    upstream: I,
    overflow: u64,
    total: u64,
    peak: f32,
}

impl<I> ClipGuardSource<I> { // ClipGuardSource
    pub fn new(upstream: I) -> Self {
        Self { upstream, overflow: 0, total: 0, peak: 0.0 }
    }
}

impl<I> Iterator for ClipGuardSource<I> where I: Source<Item = f32> {
    type Item = f32; // 实现

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let raw = self.upstream.next()?;
        self.total += 1;

        let magnitude = raw.abs();
        if magnitude > self.peak {
            self.peak = magnitude;
        }
        if magnitude > 1.0 {
            self.overflow += 1;
        }

        Some(raw.clamp(-1.0, 1.0))
    }
}

impl<I> Source for ClipGuardSource<I> where I: Source<Item = f32> {
    #[inline] fn channels(&self) -> u16 { self.upstream.channels() }
    #[inline] fn sample_rate(&self) -> u32 { self.upstream.sample_rate() }
    #[inline] fn current_frame_len(&self) -> Option<usize> { self.upstream.current_frame_len() }
    #[inline] fn total_duration(&self) -> Option<Duration> { self.upstream.total_duration() }
    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> { self.upstream.try_seek(pos) }
}

#[cfg(test)] // 实现
mod equalizer_tests {
    use super::*; // 实现

    /// 测试专用：按顺序吐出固定采样的源。
    struct FixedFeed {
        samples: Vec<f32>, // 实现
        cursor: usize, // 实现
        lanes: u16,
        hz: u32,
    }

    impl FixedFeed {
        fn new(samples: Vec<f32>, lanes: u16, hz: u32) -> Self {
            Self { samples, cursor: 0, lanes, hz }
        }
    }

    impl Iterator for FixedFeed {
        type Item = f32; // 实现
        fn next(&mut self) -> Option<f32> {
            let value = self.samples.get(self.cursor).copied()?;
            self.cursor += 1;
            Some(value)
        }
    }

    impl Source for FixedFeed {
        fn channels(&self) -> u16 { self.lanes }
        fn sample_rate(&self) -> u32 { self.hz }
        fn current_frame_len(&self) -> Option<usize> { Some(self.samples.len() - self.cursor) }
        fn total_duration(&self) -> Option<Duration> { None }
        fn try_seek(&mut self, _pos: Duration) -> Result<(), SeekError> { // try_seek
            self.cursor = 0; // 实现
            Ok(())
        }
    }

    #[test]
    fn extreme_gain_request_keeps_coeffs_finite() {
        let mut stage = BandStage::new(2);
        stage.retune(44100.0, 1000.0, 24.0);
        assert!(stage.taps.b0.is_finite());
        assert!(stage.taps.a1.is_finite());
    }

    #[test]
    fn disabled_settings_leave_samples_untouched() {
        let feed_data = vec![0.1, -0.2, 0.3, -0.4, 0.5, -0.6];
        let settings = EqualizerSettings { enabled: false, preamp: 0.0, gains: [0.0; 10] };
        let mut eq = Equalizer::new(
            FixedFeed::new(feed_data.clone(), 2, 44100),
            Arc::new(EqualizerHandle::new(settings)),
        );

        for &original in &feed_data {
            assert_eq!(eq.next().unwrap(), original);
        }
    }

    #[test]
    fn band_beyond_nyquist_stays_finite() {
        let taps = design_peaking(16000.0, 8000.0, 1.0, 6.0);
        assert!(taps.b0.is_finite());
        assert!(taps.b1.is_finite());
        assert!(taps.b2.is_finite());
        assert!(taps.a1.is_finite());
        assert!(taps.a2.is_finite());
    }

    #[test]
    fn stereo_lanes_process_independently() {
        let mut feed_data = Vec::new();
        for _ in 0..100 { // 实现
            feed_data.push(0.5);
            feed_data.push(-0.5);
        }
        let settings = EqualizerSettings { enabled: true, preamp: 0.0, gains: [6.0; 10] };
        let mut eq = Equalizer::new(
            FixedFeed::new(feed_data, 2, 44100),
            Arc::new(EqualizerHandle::new(settings)),
        );

        let mut left_out = Vec::new(); // 实现
        let mut right_out = Vec::new(); // 实现
        while let Some(l) = eq.next() { // 实现
            left_out.push(l); // 实现
            if let Some(r) = eq.next() { // 实现
                right_out.push(r); // 实现
            }
        }

        assert!(left_out.iter().all(|v| v.is_finite()));
        assert!(right_out.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn clip_guard_squashes_out_of_range_samples() {
        let feed_data = vec![2.5, -3.0, 1.2, -0.99, 0.98, 0.0, 0.5, 1.0, -1.0];
        let expected = [1.0, -1.0, 1.0, -0.99, 0.98, 0.0, 0.5, 1.0, -1.0];
        let mut guard = ClipGuardSource::new(FixedFeed::new(feed_data, 1, 44100));

        for want in expected {
            assert_eq!(guard.next().unwrap(), want);
        }
    }

    #[test]
    fn enabling_equalizer_after_bypass_raises_output() {
        let handle = Arc::new(EqualizerHandle::new(EqualizerSettings::default())); // 实现
        let mut eq = Equalizer::new(
            FixedFeed::new(vec![0.25; 8_000], 1, 44100),
            handle.clone(),
        );

        for _ in 0..300 { // 实现
            assert_eq!(eq.next().unwrap(), 0.25); // 实现
        }

        handle.set_settings(EqualizerSettings { // 实现
            enabled: true, // 实现
            preamp: 6.0, // 实现
            gains: [0.0; 10], // 实现
        });

        let mut last = 0.25; // 实现
        for _ in 0..4_000 { // 实现
            last = eq.next().unwrap(); // 实现
        }

        assert!(
            last > 0.35, // 实现
            "expected enabled preamp to raise output, got {last}" // 实现
        );
    }
}
