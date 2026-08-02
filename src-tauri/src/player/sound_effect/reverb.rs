//! 混响机架 —— Freeverb（Schroeder/Moorer）+ 早期反射。
//!
//! 完全重新制作（2026-08-02，按 rodio 引擎特性）：
//! 旧版用 FFT 分块卷积（PartitionedConvolver），在音频线程每帧做 FFT，
//! `update_params` 还会重建 86 个 FFT 分区（2-5ms 阻塞 → 爆音/卡顿）。
//! 现改为标准 Freeverb：每声道 8 并联低通反馈梳状 + 4 串联全通，
//! **每样本 O(1)，无 FFT / 无 IR / 无重建 / 无缓存 / 无预构建**。
//!
//! 2026-08-02 增强（对齐 YinDongMusic 听感）：
//! - **早期反射**：6 抽头多抽头延迟（11/19/29/37/47/61ms），复刻 YinDongMusic
//!   algoHall IR 的早期反射模式，赋予空间定义感（Freeverb 原生只有平滑尾音，
//!   缺少 IR 混响特有的"房间感"）。
//! - **湿信号增益**：FIXED_GAIN 0.015→0.035 + WET_BOOST=2.5，解决低 mainGain
//!   预设（phone/cinema）输出过小问题（旧版 wet ≈ 0.1×input，提升至 ≈ 0.6×input）。
//! - **长尾音**：room_size 允许 >1.0，反馈增益扩展至 0.995，algoHall/Tunnel/Valley
//!   尾音从 ~0.7s 延长至 ~3s，对齐 YinDongMusic IR 时长（4.5-6.0s）。
//!
//! 算法来源：Jezar @ Dreampoint Freeverb（STK FreeVerb 实现），44100Hz 调谐常量，
//! 其他采样率按 `round(base * sr / 44100)` 线性缩放延迟长度。
//!
//! 22 个预设（13 卷积 + 9 算法）映射到 (room_size, damping, width, input_gain) 参数组合，
//! 保留前端 `reverb_kind + reverb_preset + reverb_dry + reverb_wet` API 不变。
//! dry/wet 语义与旧版一致：`dry_gain = 1 + (dry-1)*w`，`wet = reverb_wet * w`。
//!
//! 性能：所有 Vec 在 `prepare()` 一次性分配，`process()` 热路径零分配、零锁、零 I/O。
//! 参数变更（`update_params`）仅改 comb 的 feedback/damp 系数字段，不重建缓冲区。

use super::dsp::{soft_clip, SmoothedValue};
use super::{ReverbKind, SoundEffectSettings};

// =========================================================================
// Freeverb 常量（标准 Dreampoint/STK 调谐）
// =========================================================================

/// 输入增益，补偿 8 个梳状并联求和（否则输入被加 8 倍 → 削波）。
/// 标准 Freeverb 用 0.015（wet 是唯一输出），此处提升至 0.035（dry+wet 混合时需更强 wet）。
const FIXED_GAIN: f32 = 0.035;
/// 湿信号输出增强：补偿 Freeverb 尾音对瞬态音乐信号的低输出（瞬态 wet ≈ 0.1×input，
/// 乘以 WET_BOOST 后 ≈ 0.25×input，配合 sendGain 可达 0.6-1.5×input，对齐 WebAudio 语义）。
const WET_BOOST: f32 = 2.5;
/// 早期反射增益：早期反射源自原始输入（未衰减），输出幅度接近 dry，故需适度衰减。
/// 0.35 使早期反射清晰可闻但不掩盖 Freeverb 尾音。
const ER_GAIN: f32 = 0.35;
/// room_size → 反馈增益的缩放系数：feedback = room * SCALE_ROOM + OFFSET_ROOM
const SCALE_ROOM: f32 = 0.28;
/// 反馈增益偏移：room=0 → feedback=0.70，room=1 → feedback=0.98
const OFFSET_ROOM: f32 = 0.7;
/// room_size > 1.0 时的扩展斜率：每 +1.0 反馈增益 +0.015（room=2.0 → 0.995，长尾音）
const ROOM_EXTEND_SLOPE: f32 = 0.015;
/// 反馈增益上限（接近 1 会自激，0.995 安全且尾音 ~3s）
const FEEDBACK_MAX: f32 = 0.995;
/// damping → 低通系数的缩放：damp1 = damping * SCALE_DAMP（damp1∈[0,0.4]）
const SCALE_DAMP: f32 = 0.4;
/// 全通滤波器固定反馈增益（Freeverb 标准）
const ALLPASS_FEEDBACK: f32 = 0.5;
/// 砖墙限制器上限（线性幅度）。0.95 ≈ -0.45dB，留余量避免 soft_clip 饱和
const LIMITER_CEILING: f32 = 0.95;

/// 44100Hz 调谐的梳状延迟长度（左声道，标准 Freeverb 常量）
const COMB_L: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
/// 右声道梳状延迟（左 + 23 样本立体声扩散）
const COMB_R: [usize; 8] = [1139, 1211, 1300, 1379, 1445, 1514, 1580, 1640];
/// 左声道全通延迟长度
const ALLPASS_L: [usize; 4] = [556, 441, 341, 225];
/// 右声道全通延迟（左 + 23）
const ALLPASS_R: [usize; 4] = [579, 464, 364, 248];

/// 早期反射抽头延迟（ms），源自 YinDongMusic algoHall 早期反射时间点
/// （~11ms 侧墙, ~19ms 天花板, ~29ms 后墙, ~37ms 楼座, ~47ms 远墙, ~61ms）
const ER_DELAYS_MS: [f32; 6] = [11.0, 19.0, 29.0, 37.0, 47.0, 61.0];
/// 早期反射增益（递减，源自 YinDongMusic algoHall earlyTaps）
const ER_GAINS: [f32; 6] = [0.65, 0.52, 0.45, 0.38, 0.32, 0.25];

// =========================================================================
// 梳状滤波器（低通反馈，Freeverb 核心）
// =========================================================================

/// 低通反馈梳状滤波器：y[n] = x[n] + LPF(y[n-D]) * feedback
struct Comb {
    buffer: Vec<f32>,
    idx: usize,
    /// 反馈增益（room_size 派生，0.70-0.995）
    feedback: f32,
    /// 低通状态（上一帧滤波输出）
    filter_store: f32,
    /// 低通"保留"系数（damping 派生，越大尾音越暗）
    damp1: f32,
    /// 低通"传入"系数 = 1 - damp1
    damp2: f32,
}

impl Comb {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![0.0; len.max(1)],
            idx: 0,
            feedback: 0.5,
            filter_store: 0.0,
            damp1: 0.5,
            damp2: 0.5,
        }
    }

    /// 清空延迟线与低通状态（切换预设/seek 时调用，避免尾音残留）
    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.idx = 0;
        self.filter_store = 0.0;
    }

    /// 处理单样本（内联，热路径）
    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.idx];
        // 一阶低通（damp2 传入新值，damp1 保留旧值）
        self.filter_store = output * self.damp2 + self.filter_store * self.damp1;
        self.buffer[self.idx] = input + self.filter_store * self.feedback;
        self.idx = if self.idx + 1 >= self.buffer.len() {
            0
        } else {
            self.idx + 1
        };
        output
    }
}

// =========================================================================
// 全通滤波器（Schroeder，增加回声密度，不改变频率响应）
// =========================================================================

/// Schroeder 全通：y[n] = -g*x[n] + x[n-D] + g*y[n-D]
struct Allpass {
    buffer: Vec<f32>,
    idx: usize,
    feedback: f32,
}

impl Allpass {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![0.0; len.max(1)],
            idx: 0,
            feedback: ALLPASS_FEEDBACK,
        }
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.idx = 0;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let bufout = self.buffer[self.idx];
        let output = -input + bufout;
        self.buffer[self.idx] = input + bufout * self.feedback;
        self.idx = if self.idx + 1 >= self.buffer.len() {
            0
        } else {
            self.idx + 1
        };
        output
    }
}

// =========================================================================
// 早期反射（6 抽头多抽头延迟，复刻 YinDongMusic IR 早期反射模式）
// =========================================================================

/// 早期反射：6 个并联抽头延迟，模拟声音从不同距离墙面反射回来。
/// 延迟时间点源自 YinDongMusic algoHall IR 生成器的 earlyTaps（11/19/29/37/47/61ms）。
/// 这是 Freeverb 与卷积 IR 听感差异的核心：Freeverb 原生只有平滑尾音，缺少
/// 空间定义感；加入早期反射后听感接近真实房间/IR 混响。
struct EarlyReflections {
    /// 6 个抽头延迟缓冲（延迟长度按采样率缩放）
    delays: [Vec<f32>; 6],
    /// 各缓冲读写索引
    indices: [usize; 6],
    /// 各抽头增益（递减）
    gains: [f32; 6],
}

impl EarlyReflections {
    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate;
        let delays = std::array::from_fn(|i| {
            let len = ((ER_DELAYS_MS[i] * sr / 1000.0).round() as usize).max(1);
            vec![0.0; len]
        });
        Self {
            delays,
            indices: [0; 6],
            gains: ER_GAINS,
        }
    }

    fn clear(&mut self) {
        for d in &mut self.delays {
            d.fill(0.0);
        }
        self.indices = [0; 6];
    }

    /// 处理单样本，返回 6 个抽头延迟加权和。
    /// 输入应为原始信号（未衰减），因为早期反射在真实房间中接近干信号幅度。
    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let mut sum = 0.0_f32;
        for i in 0..6 {
            let out = self.delays[i][self.indices[i]];
            self.delays[i][self.indices[i]] = input;
            self.indices[i] = if self.indices[i] + 1 >= self.delays[i].len() {
                0
            } else {
                self.indices[i] + 1
            };
            sum += out * self.gains[i];
        }
        sum
    }
}

// =========================================================================
// ReverbRack（Freeverb 机架 + 早期反射）
// =========================================================================

pub struct ReverbRack {
    sample_rate: f32,
    channels: usize,
    enabled: SmoothedValue,
    /// 左声道梳状组（8 个，延迟长度按采样率缩放）
    combs_l: [Comb; 8],
    /// 右声道梳状组（+23 样本扩散，提供立体声宽度）
    combs_r: [Comb; 8],
    /// 左声道全通组（4 个串联）
    allpass_l: [Allpass; 4],
    /// 右声道全通组
    allpass_r: [Allpass; 4],
    /// 左声道早期反射（6 抽头）
    early_l: EarlyReflections,
    /// 右声道早期反射
    early_r: EarlyReflections,
    /// 当前预设/kind（变更检测）
    cur_preset: String,
    cur_kind: ReverbKind,
    /// 当前 Freeverb 参数（变更时重算 comb 系数）
    room_size: f32,
    damping: f32,
    width: f32,
    input_gain: f32,
    /// 砖墙限制器增益（1.0=不限制，<1.0=衰减中）
    limiter_gain: f32,
}

impl ReverbRack {
    pub fn new() -> Self {
        Self {
            sample_rate: 44100.0,
            channels: 2,
            enabled: SmoothedValue::new(0.0),
            combs_l: std::array::from_fn(|i| Comb::new(COMB_L[i])),
            combs_r: std::array::from_fn(|i| Comb::new(COMB_R[i])),
            allpass_l: std::array::from_fn(|i| Allpass::new(ALLPASS_L[i])),
            allpass_r: std::array::from_fn(|i| Allpass::new(ALLPASS_R[i])),
            early_l: EarlyReflections::new(44100.0),
            early_r: EarlyReflections::new(44100.0),
            cur_preset: String::new(),
            cur_kind: ReverbKind::None,
            room_size: 0.5,
            damping: 0.5,
            width: 1.0,
            input_gain: 1.0,
            limiter_gain: 1.0,
        }
    }

    /// 按采样率/声道初始化延迟线（一次性分配，热路径零分配）。
    /// 采样率变化时重算梳状/全通/早期反射长度（如 44100→48000）。
    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.enabled.set_time_constant(0.05, sample_rate);
        let scale = |base: usize| -> usize {
            ((base as f32 * sample_rate / 44100.0).round() as usize).max(1)
        };
        for (i, c) in self.combs_l.iter_mut().enumerate() {
            *c = Comb::new(scale(COMB_L[i]));
        }
        for (i, c) in self.combs_r.iter_mut().enumerate() {
            *c = Comb::new(scale(COMB_R[i]));
        }
        for (i, a) in self.allpass_l.iter_mut().enumerate() {
            *a = Allpass::new(scale(ALLPASS_L[i]));
        }
        for (i, a) in self.allpass_r.iter_mut().enumerate() {
            *a = Allpass::new(scale(ALLPASS_R[i]));
        }
        self.early_l = EarlyReflections::new(sample_rate);
        self.early_r = EarlyReflections::new(sample_rate);
        // 重置变更检测，强制下次 update_params 重算 comb 系数
        self.cur_kind = ReverbKind::None;
        self.cur_preset.clear();
        self.limiter_gain = 1.0;
    }

    pub fn reset(&mut self) {
        for c in &mut self.combs_l {
            c.clear();
        }
        for c in &mut self.combs_r {
            c.clear();
        }
        for a in &mut self.allpass_l {
            a.clear();
        }
        for a in &mut self.allpass_r {
            a.clear();
        }
        self.early_l.clear();
        self.early_r.clear();
        self.limiter_gain = 1.0;
    }

    /// 同步参数（每 64 帧由音频线程调用）。
    /// 仅当预设/kind 变化时重算 comb 系数（O(12)，改字段不重建缓冲，零分配）。
    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        let active = s.reverb_kind != ReverbKind::None && !s.reverb_preset.is_empty();
        self.enabled.set_target(if active { 1.0 } else { 0.0 });

        let (room, damp, width, gain) = preset_params(&s.reverb_preset);

        if s.reverb_kind != self.cur_kind
            || s.reverb_preset != self.cur_preset
            || room != self.room_size
            || damp != self.damping
            || width != self.width
            || gain != self.input_gain
        {
            self.cur_kind = s.reverb_kind.clone();
            self.cur_preset = s.reverb_preset.clone();
            self.room_size = room;
            self.damping = damp;
            self.width = width;
            self.input_gain = gain;

            let feedback = feedback_from_room(room);
            let damp1 = damp * SCALE_DAMP;
            let damp2 = 1.0 - damp1;
            for c in &mut self.combs_l {
                c.feedback = feedback;
                c.damp1 = damp1;
                c.damp2 = damp2;
            }
            for c in &mut self.combs_r {
                c.feedback = feedback;
                c.damp1 = damp1;
                c.damp2 = damp2;
            }
        }
    }

    /// 处理一帧（frame[0]=L, frame[1]=R），原地修改。
    pub fn process(&mut self, frame: &mut [f32], channels: u16, s: &SoundEffectSettings) {
        if channels != 2 || frame.len() < 2 {
            return;
        }
        let w = self.enabled.tick();
        if w < 0.001 {
            return;
        }

        // 保存原始输入（dry 路径 + 早期反射路径用）
        let in_l = frame[0];
        let in_r = frame[1];

        // 早期反射：6 抽头多抽头延迟，输入为原始信号（未衰减）。
        // 赋予空间定义感，复刻 YinDongMusic IR 的早期反射模式。
        let er_l = self.early_l.process(in_l) * ER_GAIN;
        let er_r = self.early_r.process(in_r) * ER_GAIN;

        // Freeverb 处理：每声道独立 bank，输入经 FIXED_GAIN 补偿并联求和
        let ig = FIXED_GAIN * self.input_gain;
        let input_l = in_l * ig;
        let input_r = in_r * ig;

        // 左声道：8 梳状并联求和 → 4 全通串联
        let mut out_l = 0.0_f32;
        for c in &mut self.combs_l {
            out_l += c.process(input_l);
        }
        for a in &mut self.allpass_l {
            out_l = a.process(out_l);
        }

        // 右声道
        let mut out_r = 0.0_f32;
        for c in &mut self.combs_r {
            out_r += c.process(input_r);
        }
        for a in &mut self.allpass_r {
            out_r = a.process(out_r);
        }

        // 干/湿混合（保留旧版 dry/wet 语义 + Freeverb 立体声宽度交叉混合）
        //   dry_gain: w=0(bypass)→1.0，w=1→s.reverb_dry
        //   wet1/wet2: width=1→全立体声(L/R 独立)，width=0→窄(L-R/L-R)
        //   wet 信号 = Freeverb 尾音 × WET_BOOST + 早期反射
        let dry_gain = 1.0 + (s.reverb_dry - 1.0) * w;
        let wet = s.reverb_wet * w;
        let wet1 = wet * (self.width * 0.5 + 0.5);
        let wet2 = wet * (self.width * 0.5 - 0.5);
        let wet_sig_l = out_l * WET_BOOST + er_l;
        let wet_sig_r = out_r * WET_BOOST + er_r;
        let wet_out_l = wet_sig_l * wet1 + wet_sig_r * wet2;
        let wet_out_r = wet_sig_r * wet1 + wet_sig_l * wet2;
        let mixed_l = in_l * dry_gain + wet_out_l;
        let mixed_r = in_r * dry_gain + wet_out_r;

        // 砖墙限制器（瞬时峰值跟随，attack ~0.02ms / release ~40ms，避免 pumping）
        let peak = mixed_l.abs().max(mixed_r.abs()).max(1e-9);
        let target_gain = if peak > LIMITER_CEILING {
            LIMITER_CEILING / peak
        } else {
            1.0
        };
        let coeff = if target_gain < self.limiter_gain {
            0.5 // attack：快，1 样本内跟随峰值
        } else {
            0.0005 // release：慢，~40ms 平滑恢复
        };
        self.limiter_gain += (target_gain - self.limiter_gain) * coeff;
        // 限制器增益随 w 调制：w=0 不限制（bypass），w=1 全限制
        let comp = 1.0 + (self.limiter_gain - 1.0) * w;
        // soft_clip 提供最终保护（对限制后仍偶发的 >1.0 做柔和饱和，无硬削波失真）
        frame[0] = soft_clip(mixed_l * comp);
        frame[1] = soft_clip(mixed_r * comp);
    }
}

// =========================================================================
// room_size → 反馈增益（支持 >1.0 扩展，长尾音）
// =========================================================================

/// room_size → 反馈增益。
/// room ≤ 1.0：标准 Freeverb 公式 feedback = room * SCALE_ROOM + OFFSET_ROOM（0.70-0.98）
/// room > 1.0：线性扩展 feedback = 0.98 + (room-1.0) * ROOM_EXTEND_SLOPE（0.98-0.995+）
/// 上限 FEEDBACK_MAX=0.995（接近 1 会自激，0.995 尾音 ~3s）。
#[inline]
fn feedback_from_room(room: f32) -> f32 {
    if room <= 1.0 {
        (room * SCALE_ROOM + OFFSET_ROOM).min(FEEDBACK_MAX)
    } else {
        (OFFSET_ROOM + SCALE_ROOM + (room - 1.0) * ROOM_EXTEND_SLOPE).min(FEEDBACK_MAX)
    }
}

// =========================================================================
// 预设 → Freeverb 参数映射
// =========================================================================

/// 22 个预设映射到 (room_size, damping, width, input_gain)。
/// room_size 0-2+（尾音长度，>1.0 为长尾音扩展），damping 0-1（高频衰减），
/// width 0-1（立体声宽度），input_gain 倍率。
/// preset 名在卷积/算法两类间唯一，故仅按 preset 名匹配。
/// 参数调校参照 YinDongMusic IR 特性：卷积 IR 时长 1-4s，算法 IR 时长 0.8-6s。
fn preset_params(preset: &str) -> (f32, f32, f32, f32) {
    match preset {
        // 13 个卷积混响预设（参照 YinDongMusic IR 文件特性）
        "phone" => (0.15, 0.85, 0.0, 1.0), // 小+暗(电话)
        "church" => (1.3, 0.20, 1.0, 1.0), // 大+亮(教堂)，room>1 延长尾音
        "hall" => (1.2, 0.30, 1.0, 1.0),   // 大厅，长尾音
        "cinema" => (0.90, 0.40, 0.8, 1.0), // 影院
        "restaurant" => (0.45, 0.60, 0.6, 1.0), // 中+暗
        "bathroom" => (0.30, 0.50, 0.5, 1.0), // 小浴室
        "room" => (0.40, 0.50, 0.7, 1.0),   // 房间
        "stereo" => (0.60, 0.30, 1.0, 1.0), // 立体声
        "matrixReverb1" => (0.90, 0.25, 0.9, 1.0),
        "matrixReverb2" => (1.0, 0.35, 0.9, 1.0),
        "cardioidSpread" => (0.70, 0.35, 0.85, 1.0),
        "magneticStereo" => (0.80, 0.40, 0.95, 1.0),
        "feedbackSuppressor" => (0.50, 0.70, 0.6, 1.0), // 高阻尼抑反馈
        // 9 个算法混响预设（参照 YinDongMusic generateReverbIR 时长/衰减）
        // algoHall: duration=4.5s → room=1.6 (feedback≈0.99, tail≈3s)
        // algoTunnel: duration=5.5s → room=2.0 (feedback≈0.995, tail≈3s+)
        // algoValley: duration=6.0s → room=2.0 (feedback≈0.995)
        "algoStudio" => (0.40, 0.30, 0.8, 1.0),
        "algoHall" => (1.6, 0.25, 1.0, 1.0),
        "algoBathroom" => (0.25, 0.55, 0.5, 1.0),
        "algoTunnel" => (2.0, 0.10, 1.0, 1.0), // 长+亮(隧道)
        "algoValley" => (2.0, 0.05, 1.0, 1.0), // 极大(山谷)
        "algoMetal" => (0.60, 0.05, 0.4, 1.2),  // 亮(金属)
        "algoPlate" => (0.55, 0.15, 0.7, 1.1),  // 板式
        "algoSpring" => (0.50, 0.20, 0.5, 1.1), // 弹簧
        "algoPreDelay" => (1.2, 0.30, 0.9, 1.0),
        _ => (0.5, 0.5, 1.0, 1.0),
    }
}

// =========================================================================
// 单元测试
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_for(preset: &str) -> SoundEffectSettings {
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = if preset.starts_with("algo") {
            ReverbKind::Algorithmic
        } else {
            ReverbKind::Convolution
        };
        s.reverb_preset = preset.to_string();
        s.reverb_dry = 0.8;
        s.reverb_wet = 0.5;
        s
    }

    #[test]
    fn test_freeverb_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("church");
        rack.update_params(&s);
        // 灌 44100 个 0.5 样本（1 秒），断言无 NaN/Inf 且非全零
        let mut nonzero = false;
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "L NaN/Inf");
            assert!(frame[1].is_finite(), "R NaN/Inf");
            if frame[0].abs() > 1e-6 || frame[1].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "输出全零，混响未生效");
    }

    #[test]
    fn test_preset_mapping_all_22() {
        let presets = [
            "phone", "church", "hall", "cinema", "restaurant", "bathroom", "room", "stereo",
            "matrixReverb1", "matrixReverb2", "cardioidSpread", "magneticStereo",
            "feedbackSuppressor", "algoStudio", "algoHall", "algoBathroom", "algoTunnel",
            "algoValley", "algoMetal", "algoPlate", "algoSpring", "algoPreDelay",
        ];
        for p in &presets {
            let (room, damp, width, gain) = preset_params(p);
            assert!(room >= 0.0, "preset {} room {} 为负", p, room);
            assert!(damp >= 0.0 && damp <= 1.0, "preset {} damp {} 越界", p, damp);
            assert!(width >= 0.0 && width <= 1.0, "preset {} width {} 越界", p, width);
            assert!(gain > 0.0, "preset {} gain {} 非正", p, gain);
        }
    }

    #[test]
    fn test_preset_switch_no_rebuild() {
        // 切换预设仅改 comb 系数，不重建 Vec（缓冲长度不变）
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let len_after_prepare = rack.combs_l[0].buffer.len();
        for p in ["church", "phone", "hall", "algoTunnel", "room"] {
            let s = settings_for(p);
            rack.update_params(&s);
            assert_eq!(
                rack.combs_l[0].buffer.len(),
                len_after_prepare,
                "切换到 {} 后缓冲被重建",
                p
            );
        }
        // 但系数确实变化了（church vs phone 的 room 不同 → feedback 不同）
        let s_church = settings_for("church");
        rack.update_params(&s_church);
        let fb_church = rack.combs_l[0].feedback;
        let s_phone = settings_for("phone");
        rack.update_params(&s_phone);
        let fb_phone = rack.combs_l[0].feedback;
        assert_ne!(fb_church, fb_phone, "切换预设后 feedback 未变");
    }

    #[test]
    fn test_sample_rate_scaling() {
        let mut rack44 = ReverbRack::new();
        rack44.prepare(44100.0, 2);
        let len44 = rack44.combs_l[0].buffer.len();

        let mut rack48 = ReverbRack::new();
        rack48.prepare(48000.0, 2);
        let len48 = rack48.combs_l[0].buffer.len();

        assert!(len48 > len44, "48000Hz 梳状长度({})应 > 44100Hz({})", len48, len44);
        // COMB_L[0]=1116 @ 44100 → 1116；@ 48000 → round(1116*48000/44100)=round(1214.74)=1215
        assert_eq!(len44, 1116);
        assert_eq!(len48, 1215);
    }

    #[test]
    fn test_bypass_passthrough() {
        // reverb_kind=None → enabled 平滑到 0 → 最终输出 ≈ 原始输入（dry 直通）
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = ReverbKind::None;
        s.reverb_preset = String::new();
        s.reverb_dry = 0.8;
        s.reverb_wet = 0.5;
        rack.update_params(&s);
        // enabled.target=0，灌足够样本让 enabled 平滑到 ~0
        for _ in 0..20000 {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
        }
        // 此时 w 应已 < 0.001，process 直通（frame 不变）
        let mut frame = [0.42_f32, -0.17];
        rack.process(&mut frame, 2, &s);
        assert!((frame[0] - 0.42).abs() < 1e-6, "bypass 后 L 不等于输入: {}", frame[0]);
        assert!((frame[1] + 0.17).abs() < 1e-6, "bypass 后 R 不等于输入: {}", frame[1]);
    }

    #[test]
    fn test_feedback_extension_long_tail() {
        // room_size > 1.0 应产生更长的尾音（feedback 更高）
        let fb_normal = feedback_from_room(0.5);
        let fb_long = feedback_from_room(1.5);
        let fb_extreme = feedback_from_room(2.0);
        assert!(fb_long > fb_normal, "room=1.5 feedback({})应 > room=0.5({})", fb_long, fb_normal);
        assert!(fb_extreme > fb_long, "room=2.0 feedback({})应 > room=1.5({})", fb_extreme, fb_long);
        assert!(fb_extreme <= FEEDBACK_MAX, "feedback 超过上限 {}", fb_extreme);
    }

    #[test]
    fn test_early_reflections_nonzero() {
        // 早期反射在延迟填满后应产生非零输出
        let mut er = EarlyReflections::new(44100.0);
        // 灌 5000 个样本（> 61ms = 2691 样本），所有抽头应已填满
        for _ in 0..5000 {
            er.process(0.5);
        }
        let out = er.process(0.0);
        assert!(out.abs() > 1e-6, "早期反射输出为零，未生效");
    }

    #[test]
    fn test_wet_boost_louder_than_before() {
        // 验证 wet 提升后输出比旧版（FIXED_GAIN=0.015, 无 WET_BOOST）更响。
        // 用 hall 预设（width=1.0 避免单声道输入时 width=0 导致湿信号互相抵消），
        // mainGain=0.8, sendGain=2.4（与 YinDongMusic 对齐），立体声输入。
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = ReverbKind::Convolution;
        s.reverb_preset = "hall".to_string();
        s.reverb_dry = 0.8; // mainGain
        s.reverb_wet = 2.4; // sendGain
        rack.update_params(&s);
        // 灌 1 秒立体声样本，测量 RMS
        let mut sum_sq = 0.0_f32;
        let n = 44100_usize;
        for _ in 0..n {
            let mut frame = [0.5_f32, 0.4]; // 立体声（L≠R，避免宽度抵消）
            rack.process(&mut frame, 2, &s);
            sum_sq += frame[0] * frame[0] + frame[1] * frame[1];
        }
        let rms = (sum_sq / (2.0 * n as f32)).sqrt();
        // 输入 RMS ≈ 0.453。wet 提升后，混响稳态应使输出 RMS > 0.2（旧版 ≈ 0.1）
        assert!(rms > 0.2, "hall 预设 RMS={} 过低（wet 提升未生效）", rms);
    }
}
