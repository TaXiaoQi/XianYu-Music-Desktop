//! 多声道 → 立体声下混。
//!
//! rodio 不做声道下混，>2 声道流（如伪 6ch「全景声」FLAC）硬灌立体声
//! 输出设备会直接爆音。此处在样本层按帧混成立体声后放行，混音系数
//! 参考 ITU-R BS.775。

use std::time::Duration;

use rodio::Source;

/// 单帧下混：交错样本帧 → (左, 右)。输入不足 2 声道时原样返回。
pub fn downmix_frame(frame: &[f32]) -> (f32, f32) {
    let l = frame.first().copied().unwrap_or(0.0);
    let r = frame.get(1).copied().unwrap_or(l);
    match frame.len() {
        0 | 1 | 2 => (l, r),
        3 => {
            // L R C
            let c = frame[2] * std::f32::consts::FRAC_1_SQRT_2;
            (l + c, r + c)
        }
        4 => {
            // FL FR BL BR
            let bl = frame[2] * std::f32::consts::FRAC_1_SQRT_2;
            let br = frame[3] * std::f32::consts::FRAC_1_SQRT_2;
            (l + bl, r + br)
        }
        6 => {
            // 5.1（symphonia 布局：FL FR FC LFE SL SR）
            let c = frame[2] * std::f32::consts::FRAC_1_SQRT_2;
            let lfe = frame[3] * 0.5;
            let sl = frame[4] * std::f32::consts::FRAC_1_SQRT_2;
            let sr = frame[5] * std::f32::consts::FRAC_1_SQRT_2;
            (l + c + sl + lfe, r + c + sr + lfe)
        }
        _ => {
            // 未知布局兜底：前两声道为基，其余按奇偶对称混入
            let mut lm = l;
            let mut rm = r;
            for (i, s) in frame.iter().enumerate().skip(2) {
                if i % 2 == 0 {
                    lm += s * 0.5;
                } else {
                    rm += s * 0.5;
                }
            }
            (lm, rm)
        }
    }
}

/// 把 >2 声道的 f32 交错流逐帧下混为立体声。
pub struct DownmixSource<S> {
    inner: S,
    input_channels: u16,
    frame: Vec<f32>,
    pending: [Option<f32>; 2],
}

impl<S> DownmixSource<S> {
    pub fn new(inner: S, input_channels: u16) -> Self {
        let input_channels = input_channels.max(2);
        Self {
            inner,
            input_channels,
            frame: Vec::with_capacity(input_channels as usize),
            pending: [None, None],
        }
    }
}

impl<S> Iterator for DownmixSource<S>
where
    S: Iterator<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        loop {
            if let Some(v) = self.pending[0].take() {
                return Some(v);
            }
            if let Some(v) = self.pending[1].take() {
                return Some(v);
            }
            while self.frame.len() < self.input_channels as usize {
                match self.inner.next() {
                    Some(s) => self.frame.push(s),
                    // 末尾残帧不完整，丢弃
                    None => return None,
                }
            }
            let (l, r) = downmix_frame(&self.frame);
            self.frame.clear();
            self.pending = [Some(l), Some(r)];
        }
    }
}

impl<S> Source for DownmixSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        let pending = self.pending.iter().filter(|p| p.is_some()).count();
        Some(if pending > 0 { pending } else { 2 })
    }

    fn channels(&self) -> u16 {
        2
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_5_1_side_layout() {
        // FL=1.0 FR=0.0 FC=0.5 LFE=0.4 SL=0.6 SR=0.8
        let frame = [1.0, 0.0, 0.5, 0.4, 0.6, 0.8];
        let (l, r) = downmix_frame(&frame);
        let s = std::f32::consts::FRAC_1_SQRT_2;
        assert!((l - (1.0 + 0.5 * s + 0.6 * s + 0.2)).abs() < 1e-6);
        assert!((r - (0.0 + 0.5 * s + 0.8 * s + 0.2)).abs() < 1e-6);
    }

    #[test]
    fn downmix_stereo_passthrough() {
        assert_eq!(downmix_frame(&[0.25, -0.5]), (0.25, -0.5));
    }

    #[test]
    fn source_interleaves_frames_in_order() {
        struct SixCh(Vec<f32>);
        impl Iterator for SixCh {
            type Item = f32;
            fn next(&mut self) -> Option<f32> {
                if self.0.is_empty() {
                    None
                } else {
                    Some(self.0.remove(0))
                }
            }
        }
        impl Source for SixCh {
            fn current_frame_len(&self) -> Option<usize> {
                Some(self.0.len())
            }
            fn channels(&self) -> u16 {
                6
            }
            fn sample_rate(&self) -> u32 {
                44100
            }
            fn total_duration(&self) -> Option<std::time::Duration> {
                None
            }
        }

        // 两个 6ch 帧：帧1 = 1..6，帧2 = 0.1..0.6
        let mut samples = Vec::new();
        for base in [0.0f32, 0.1] {
            for i in 0..6u32 {
                samples.push(base + i as f32 * 0.1);
            }
        }
        let mut dm = DownmixSource::new(SixCh(samples), 6);
        let mut out = Vec::new();
        while let Some(v) = dm.next() {
            out.push(v);
        }
        // 12 输入样本 = 2 个 6ch 帧 → 输出 2 个立体声帧 = 4 样本
        assert_eq!(out.len(), 4);
        // 顺序应为 [L1, R1, L2, R2]
        assert!(out[0] < out[1]); // L < R
        assert_eq!(dm.channels(), 2);
        assert_eq!(dm.sample_rate(), 44100);
    }
}
