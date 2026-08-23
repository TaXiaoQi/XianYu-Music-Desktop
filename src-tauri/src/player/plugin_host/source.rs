//! `PluginHostSource` —— 共享插件机架的 rodio Source 适配器（报告 §6.2/§6.4）。
//!
//! rodio 的 Source 是逐样本拉取模型，VST3/CLAP 插件按块处理。适配器在两者
//! 之间做 512 帧块缓冲：`next()` 先消费上一块结果，耗尽后从 `inner` 拉取
//! 整块交织样本，解交织为平面（planar）缓冲，委托共享机架
//! （`rack::SharedRack::process_block`）处理后交织回 `out_block` 逐样本供给。
//!
//! 实例的加载/激活/复用全部在共享机架完成（命令线程），本适配器只负责：
//! - **起播同步**：构造时（命令线程）`ensure_ready` 让机架按当前音轨的
//!   采样率/声道同步实例链（激活参数一致且槽位未变时零重建复用）；
//! - **空机架快速路径**：机架链为空（原子读，无锁）时逐样本直通 inner；
//! - **锁忙/激活失配旁路**：音频线程 try_lock 拿不到机架锁（编辑器等持锁
//!   操作进行中）或 inner 元数据中途变化时，本块直通不阻塞等待；
//! - **流末尾短块**：不足 512 帧按实际帧数处理。

use std::sync::Arc;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

use truce_rack::core::events::EventList;

use super::rack::{BLOCK_SIZE, SharedRack};

pub struct PluginHostSource<I> {
    inner: I,
    rack: Arc<SharedRack>,
    channels: u16,
    sample_rate: u32,
    /// inner 采样率/声道中途变化后的永久旁路（正常换轨由 runtime 重建整条
    /// 管线；本实例生命周期内不再尝试处理，机架保持原激活参数供下次起播）。
    stale: bool,
    /// 每个实例只上报一次元数据变化（避免每块刷屏）。
    error_reported: bool,
    /// 交织输入块（BLOCK_SIZE 帧 × 声道）。
    in_block: Vec<f32>,
    /// 交织输出块。
    out_block: Vec<f32>,
    /// out_block 中下一个待消费样本下标与有效长度。
    out_pos: usize,
    out_len: usize,
    /// 平面缓冲 A（当前输入）/ B（当前输出），插件间由机架交换。
    planar_a: Vec<Vec<f32>>,
    planar_b: Vec<Vec<f32>>,
    /// 输入事件列表（播放器无 MIDI/自动化，恒空）。
    events_in: EventList,
    /// 输出事件回收（每块由机架清空）。
    events_out: EventList,
}

impl<I> PluginHostSource<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, rack: Arc<SharedRack>) -> Self {
        // 构造发生在起播线程（非音频线程），机架内 dlopen/activate 安全
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate();
        rack.ensure_ready(channels, sample_rate);
        let mut src = Self {
            inner,
            rack,
            channels,
            sample_rate,
            stale: false,
            error_reported: false,
            in_block: Vec::new(),
            out_block: Vec::new(),
            out_pos: 0,
            out_len: 0,
            planar_a: Vec::new(),
            planar_b: Vec::new(),
            events_in: EventList::new(),
            events_out: EventList::new(),
        };
        src.allocate_buffers();
        src
    }

    fn allocate_buffers(&mut self) {
        let ch = self.channels as usize;
        self.in_block.resize(BLOCK_SIZE * ch, 0.0);
        self.out_block.resize(BLOCK_SIZE * ch, 0.0);
        self.planar_a = vec![vec![0.0; BLOCK_SIZE]; ch];
        self.planar_b = vec![vec![0.0; BLOCK_SIZE]; ch];
        self.in_block.fill(0.0);
        self.out_block.fill(0.0);
        self.out_pos = 0;
        self.out_len = 0;
    }
}

impl<I> Iterator for PluginHostSource<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        // 1. 消费上一块的处理结果
        if self.out_pos < self.out_len {
            let s = self.out_block[self.out_pos];
            self.out_pos += 1;
            return Some(s);
        }

        // 2. 动态采样率/声道数同步：当底层解码器音频属性确定后，自动对齐缓冲区与机架
        if !self.stale {
            let cur_rate = self.inner.sample_rate();
            let cur_ch = self.inner.channels();
            if (cur_rate != self.sample_rate || cur_ch != self.channels) && cur_rate > 0 && cur_ch > 0 {
                self.sample_rate = cur_rate;
                self.channels = cur_ch;
                self.allocate_buffers();
            }
        }

        // 3. 机架链为空 / 元数据已失配：逐样本直通（无锁快速路径）
        if self.rack.is_bypassed() || self.stale {
            return self.inner.next();
        }

        static LOG_ONCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !LOG_ONCE.swap(true, std::sync::atomic::Ordering::Relaxed) {
            eprintln!("[source] PluginHostSource 正在处理音频数据流! sample_rate={}, channels={}", self.sample_rate, self.channels);
        }

        // 4. 从 inner 拉取整块（流末尾可能不足 512 帧，按完整帧截断）
        let ch = self.channels as usize;
        let mut frames = 0usize;
        'fill: while frames < BLOCK_SIZE {
            for c in 0..ch {
                match self.inner.next() {
                    Some(s) => self.in_block[frames * ch + c] = s,
                    None => break 'fill,
                }
            }
            frames += 1;
        }
        if frames == 0 {
            return None;
        }

        // 5. 解交织：in_block（交织）→ planar_a
        for (c, channel) in self.planar_a.iter_mut().enumerate() {
            for (dest, s) in channel
                .iter_mut()
                .zip(self.in_block[c..].iter().step_by(ch))
                .take(frames)
            {
                *dest = *s;
            }
        }

        // 6. 机架处理（try_lock；锁忙/激活失配/熔断返回 false → planar_a
        //    保持输入未动，直接透传本块）
        let processed = self.rack.process_block(
            self.channels,
            self.sample_rate,
            frames,
            &mut self.planar_a,
            &mut self.planar_b,
            &self.events_in,
            &mut self.events_out,
        );
        if !processed && !self.error_reported {
            // 熔断错误已由机架上报；此处只兜底非熔断型旁路（理论上无声，
            // 不打扰用户）。
            self.error_reported = true;
        }

        // 7. 交织：planar_a（最终结果或旁路输入）→ out_block
        for (c, channel) in self.planar_a.iter().enumerate() {
            for (dest, s) in self.out_block[c..]
                .iter_mut()
                .step_by(ch)
                .zip(channel.iter())
                .take(frames)
            {
                *dest = *s;
            }
        }
        self.out_len = frames * ch;
        self.out_pos = 0;

        if self.out_pos < self.out_len {
            let s = self.out_block[self.out_pos];
            self.out_pos += 1;
            Some(s)
        } else {
            None
        }
    }
}

impl<I> Source for PluginHostSource<I>
where
    I: Source<Item = f32>,
{
    #[inline]
    fn channels(&self) -> u16 {
        self.channels
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        // 丢弃已缓冲块；插件内部状态（残响尾音等）保留属正常听感
        self.out_pos = 0;
        self.out_len = 0;
        Ok(())
    }
}

// =========================================================================
// 测试
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::plugin_host::{RackConfig, RackSlotConfig, SharedRack};

    /// 确定性测试源：输出 sample = 剩余计数 * 0.01，按声道交织。
    struct TestSource {
        rate: u32,
        channels: u16,
        remaining: usize,
    }

    impl TestSource {
        fn stereo(rate: u32, frames: usize) -> Self {
            Self { rate, channels: 2, remaining: frames * 2 }
        }
    }

    impl Iterator for TestSource {
        type Item = f32;

        fn next(&mut self) -> Option<f32> {
            if self.remaining == 0 {
                return None;
            }
            self.remaining -= 1;
            Some(self.remaining as f32 * 0.01)
        }
    }

    impl Source for TestSource {
        fn channels(&self) -> u16 {
            self.channels
        }
        fn sample_rate(&self) -> u32 {
            self.rate
        }
        fn current_frame_len(&self) -> Option<usize> {
            None
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
        fn try_seek(&mut self, _: Duration) -> Result<(), SeekError> {
            Ok(())
        }
    }

    fn source_samples(src: &mut PluginHostSource<TestSource>) -> Vec<f32> {
        src.by_ref().collect()
    }

    fn expected_stereo(frames: usize) -> Vec<f32> {
        TestSource::stereo(44_100, frames).collect()
    }

    #[test]
    fn empty_rack_hard_bypass_passthrough_exact() {
        let rack = Arc::new(SharedRack::new(RackConfig::default()));
        let mut src = PluginHostSource::new(TestSource::stereo(44_100, 1200), rack);
        assert!(src.rack.is_bypassed());
        assert_eq!(source_samples(&mut src), expected_stereo(1200));
    }

    #[test]
    fn master_disabled_bypasses_even_with_enabled_slot() {
        let mut config = RackConfig::default();
        config.slots.push(RackSlotConfig {
            format: "vst3".into(),
            unique_id: "X".into(),
            path: "C:/none.vst3".into(),
            name: "X".into(),
            vendor: String::new(),
            enabled: true,
            ..Default::default()
        });
        let rack = Arc::new(SharedRack::new(config));
        let mut src = PluginHostSource::new(TestSource::stereo(48_000, 600), rack);
        assert!(src.rack.is_bypassed());
        assert_eq!(source_samples(&mut src), expected_stereo(600));
    }

    #[test]
    fn load_failure_degrades_to_bypass_and_reports() {
        let mut config = RackConfig::default();
        config.master_enabled = true;
        config.slots.push(RackSlotConfig {
            format: "vst3".into(),
            unique_id: "nonexistent".into(),
            path: "C:/does/not/exist.vst3".into(),
            name: "Ghost".into(),
            vendor: String::new(),
            enabled: true,
            ..Default::default()
        });
        let rack = Arc::new(SharedRack::new(config));
        let mut src = PluginHostSource::new(TestSource::stereo(44_100, 1300), rack.clone());
        assert!(rack.is_bypassed(), "加载全败应整链旁路");
        assert_eq!(source_samples(&mut src), expected_stereo(1300));
        let err = rack.take_process_error().expect("应上报加载失败");
        assert!(err.contains("Ghost"), "unexpected: {err}");
    }

    #[test]
    fn block_stream_integrity_across_partial_tail() {
        // 1300 帧 = 2×512 + 276 尾块：旁路模式下样本流完整无丢失
        let rack = Arc::new(SharedRack::new(RackConfig::default()));
        let mut src = PluginHostSource::new(TestSource::stereo(44_100, 1300), rack);
        let got = source_samples(&mut src);
        assert_eq!(got.len(), 2600);
        assert_eq!(got, expected_stereo(1300));
    }

    #[test]
    fn metadata_reported_from_inner() {
        let rack = Arc::new(SharedRack::new(RackConfig::default()));
        let mut src = PluginHostSource::new(TestSource::stereo(96_000, 10), rack);
        assert_eq!(src.channels(), 2);
        assert_eq!(src.sample_rate(), 96_000);
        let _ = source_samples(&mut src);
    }

    #[test]
    fn seek_clears_buffered_block() {
        let rack = Arc::new(SharedRack::new(RackConfig::default()));
        let mut src = PluginHostSource::new(TestSource::stereo(44_100, 2000), rack);
        let _ = src.next();
        assert!(src.out_len == 0 || src.out_pos <= src.out_len);
        src.try_seek(Duration::from_secs(1)).expect("seek");
        assert_eq!(src.out_len, 0);
        assert_eq!(src.out_pos, 0);
    }

    #[test]
    fn global_wrap_returns_bypass_source_for_empty_rack() {
        // wrap() 用全局机架；空机架或加载失败必然收敛到旁路，不 panic。
        // 不断言全局机架状态——与其他测试（manager 的 rack_roundtrip）并行共享。
        let src = super::super::wrap(TestSource::stereo(44_100, 8));
        drop(src);
    }

    // -----------------------------------------------------------------
    // 真实插件冒烟测试（报告 §6.5 验收路径的持续化版本）
    //
    // 依赖本机用户级目录下的 nih-plug gain 测试插件（可行性研究安装）：
    //   %LOCALAPPDATA%\Programs\Common\VST3\gain.vst3
    //   %LOCALAPPDATA%\Programs\Common\CLAP\gain.clap
    // 手动触发：cargo test --lib smoke_real_gain -- --ignored --nocapture
    // -----------------------------------------------------------------

    /// 恒定 0.5 幅度的立体声源。
    struct ConstantSource {
        rate: u32,
        remaining: usize,
    }

    impl Iterator for ConstantSource {
        type Item = f32;

        fn next(&mut self) -> Option<f32> {
            if self.remaining == 0 {
                return None;
            }
            self.remaining -= 1;
            Some(0.5)
        }
    }

    impl Source for ConstantSource {
        fn channels(&self) -> u16 {
            2
        }
        fn sample_rate(&self) -> u32 {
            self.rate
        }
        fn current_frame_len(&self) -> Option<usize> {
            None
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
        fn try_seek(&mut self, _: Duration) -> Result<(), SeekError> {
            Ok(())
        }
    }

    #[test]
    #[ignore = "探测用（gain 插件参数映射表），手动触发"]
    fn probe_real_gain_param_mapping() {
        let entries = crate::player::plugin_host::scanner::scan_all_directories();
        for entry in &entries {
            let Ok(mut instance) =
                crate::player::plugin_host::scanner::load_instance(&entry.format, &entry.unique_id, &entry.path)
            else {
                continue;
            };
            let layout = crate::player::plugin_host::rack::layout_for_channels(2);
            let _ = instance.activate(layout, 44_100.0, BLOCK_SIZE);
            let count = instance.parameter_count();
            println!("[{}] {} params={count}", entry.format, entry.name);
            for index in 0..count {
                let Ok(info) = instance.parameter_info(index) else { continue };
                println!(
                    "  param[{index}] id={} name={} min={:.4} max={:.4} default={:.4} step={}",
                    info.id, info.name, info.min, info.max, info.default, info.step_count
                );
            }
            for index in 0..count.min(1) {
                for n in [0.0f64, 0.1, 0.2, 0.3, 0.4, 0.4328, 0.5, 0.5295, 0.6, 0.6813, 0.7, 0.8, 0.9, 1.0] {
                    let text = instance
                        .parameter_value_string(index, n)
                        .unwrap_or_else(|e| format!("<err {e}>"));
                    println!("  param[{index}] n={n:.4} -> \"{text}\"");
                }
            }
            instance.deactivate();
        }
    }

    #[test]
    #[ignore = "依赖本机 gain.vst3/gain.clap 测试插件（可行性研究安装）"]
    fn smoke_real_gain_plugins_end_to_end() {
        use std::collections::HashMap;

        let entries = crate::player::plugin_host::scanner::scan_all_directories();
        assert!(
            !entries.is_empty(),
            "本机标准目录未发现任何插件（应至少有 gain.vst3/gain.clap）"
        );

        let mut verified_formats: Vec<String> = Vec::new();
        for entry in &entries {
            let mut config = RackConfig::default();
            config.master_enabled = true;
            config.slots.push(RackSlotConfig {
                format: entry.format.clone(),
                unique_id: entry.unique_id.clone(),
                path: entry.path.clone(),
                name: entry.name.clone(),
                vendor: entry.vendor.clone(),
                enabled: true,
                // 线性增益 0.5 的归一化值（nih-plug 幂律 skew，报告 §3：0.4328）
                params: HashMap::from([(0usize, 0.4328)]),
            });
            let rack = Arc::new(SharedRack::new(config));
            let input = ConstantSource { rate: 44_100, remaining: 2048 };
            let mut src = PluginHostSource::new(input, rack.clone());
            if rack.is_bypassed() {
                let err = rack.take_process_error().unwrap_or_default();
                panic!("[{}] 插件加载/激活失败: {err}", entry.format);
            }

            let samples: Vec<f32> = src.by_ref().collect();
            assert_eq!(samples.len(), 2048, "[{}] 样本数应守恒", entry.format);

            // 跳过前 64 帧预热，稳态输出应为 0.5 × 0.5 = 0.25（±5%）
            let steady = &samples[128.min(samples.len())..];
            let observed = steady.iter().cloned().fold(0.0f32, f32::max).abs();
            let expected = 0.25;
            assert!(
                (observed - expected).abs() / expected < 0.05,
                "[{}] 增益 0.5 稳态输出应为 ~{expected}，实测 {observed:.4}",
                entry.format
            );

            // 实时调参验证：播放中途把增益改为 1.0。nih-plug 幂律映射下
            // 归一化 0.5 恰对应 0 dB（线性增益 1.0）——实测映射表见
            // probe_real_gain_param_mapping（0.4328→-6.02dB、0.5→0dB、
            // 0.6813→+13.29dB，线性增益 = 0.0316+31.59·n^5.03）。插件内部
            // 有 ~100ms 对数平滑，第二段送 8192 帧（~186ms）等过渡结束后
            // 取尾部 1024 帧测稳态，稳态输出应为 0.5 × 1.0 = 0.5。
            rack.update_slot_param(&entry.format, &entry.unique_id, 0, 0.5);
            let input2 = ConstantSource { rate: 44_100, remaining: 8192 };
            let mut src2 = PluginHostSource::new(input2, rack.clone());
            let samples2: Vec<f32> = src2.by_ref().collect();
            let tail = &samples2[samples2.len().saturating_sub(1024)..];
            let observed2 = tail.iter().cloned().fold(0.0f32, f32::max).abs();
            assert!(
                (observed2 - 0.5).abs() / 0.5 < 0.08,
                "[{}] 实时改参后稳态输出应为 ~0.5，实测 {observed2:.4}",
                entry.format
            );

            // 参数字符串显示（P2）
            let text = rack
                .with_slot(&entry.format, &entry.unique_id, |slot| {
                    slot.instance.parameter_value_string(0, 0.5)
                })
                .and_then(|r| r.ok());
            if let Some(text) = text {
                println!("[{}] 参数显示（0.5 → 「{text}」）", entry.format);
            }

            verified_formats.push(entry.format.clone());
            println!(
                "[{}] {} v{} 通过：稳态输出 {observed:.4}，实时改参 {observed2:.4}",
                entry.format, entry.name, entry.version
            );
            // 清理：退役实例供下一个格式测试干净重建
            rack.set_config(RackConfig::default());
        }

        assert_eq!(
            verified_formats.len(),
            2,
            "应验证 VST3 与 CLAP 两个格式，实际: {verified_formats:?}"
        );
    }
}
