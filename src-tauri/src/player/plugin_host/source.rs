use std::sync::Arc;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

use truce_rack::core::events::EventList;

use super::rack::{SharedRack, BLOCK_SIZE};

pub struct PluginHostSource<I> {
    inner: I,
    rack: Arc<SharedRack>,
    channels: u16,
    sample_rate: u32,
    stale: bool,
    error_reported: bool,
    in_block: Vec<f32>,
    out_block: Vec<f32>,
    out_pos: usize,
    out_len: usize,
    planar_a: Vec<Vec<f32>>,
    planar_b: Vec<Vec<f32>>,
    events_in: EventList,
    events_out: EventList,
}

impl<I> PluginHostSource<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, rack: Arc<SharedRack>) -> Self {
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
        if self.out_pos < self.out_len {
            let s = self.out_block[self.out_pos];
            self.out_pos += 1;
            return Some(s);
        }

        if !self.stale {
            let cur_rate = self.inner.sample_rate();
            let cur_ch = self.inner.channels();
            if (cur_rate != self.sample_rate || cur_ch != self.channels)
                && cur_rate > 0
                && cur_ch > 0
            {
                self.sample_rate = cur_rate;
                self.channels = cur_ch;
                self.allocate_buffers();
            }
        }

        if self.rack.is_bypassed() || self.stale {
            return self.inner.next();
        }

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

        for (c, channel) in self.planar_a.iter_mut().enumerate() {
            for (dest, s) in channel
                .iter_mut()
                .zip(self.in_block[c..].iter().step_by(ch))
                .take(frames)
            {
                *dest = *s;
            }
        }

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
            self.error_reported = true;
        }

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
        self.out_pos = 0;
        self.out_len = 0;
        Ok(())
    }
}

// =========================================================================
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::plugin_host::{RackConfig, RackSlotConfig, SharedRack};

    struct TestSource {
        rate: u32,
        channels: u16,
        remaining: usize,
    }

    impl TestSource {
        fn stereo(rate: u32, frames: usize) -> Self {
            Self {
                rate,
                channels: 2,
                remaining: frames * 2,
            }
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
        let src = super::super::wrap(TestSource::stereo(44_100, 8));
        drop(src);
    }

    // -----------------------------------------------------------------
    // -----------------------------------------------------------------

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
            let Ok(mut instance) = crate::player::plugin_host::scanner::load_instance(
                &entry.format,
                &entry.unique_id,
                &entry.path,
            ) else {
                continue;
            };
            let layout = crate::player::plugin_host::rack::layout_for_channels(2);
            let _ = instance.activate(layout, 44_100.0, BLOCK_SIZE);
            let count = instance.parameter_count();
            println!("[{}] {} params={count}", entry.format, entry.name);
            for index in 0..count {
                let Ok(info) = instance.parameter_info(index) else {
                    continue;
                };
                println!(
                    "  param[{index}] id={} name={} min={:.4} max={:.4} default={:.4} step={}",
                    info.id, info.name, info.min, info.max, info.default, info.step_count
                );
            }
            for index in 0..count.min(1) {
                for n in [
                    0.0f64, 0.1, 0.2, 0.3, 0.4, 0.4328, 0.5, 0.5295, 0.6, 0.6813, 0.7, 0.8, 0.9,
                    1.0,
                ] {
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
                params: HashMap::from([(0usize, 0.4328)]),
            });
            let rack = Arc::new(SharedRack::new(config));
            let input = ConstantSource {
                rate: 44_100,
                remaining: 2048,
            };
            let mut src = PluginHostSource::new(input, rack.clone());
            if rack.is_bypassed() {
                let err = rack.take_process_error().unwrap_or_default();
                panic!("[{}] 插件加载/激活失败: {err}", entry.format);
            }

            let samples: Vec<f32> = src.by_ref().collect();
            assert_eq!(samples.len(), 2048, "[{}] 样本数应守恒", entry.format);

            let steady = &samples[128.min(samples.len())..];
            let observed = steady.iter().cloned().fold(0.0f32, f32::max).abs();
            let expected = 0.25;
            assert!(
                (observed - expected).abs() / expected < 0.05,
                "[{}] 增益 0.5 稳态输出应为 ~{expected}，实测 {observed:.4}",
                entry.format
            );

            rack.update_slot_param(&entry.format, &entry.unique_id, 0, 0.5);
            let input2 = ConstantSource {
                rate: 44_100,
                remaining: 8192,
            };
            let mut src2 = PluginHostSource::new(input2, rack.clone());
            let samples2: Vec<f32> = src2.by_ref().collect();
            let tail = &samples2[samples2.len().saturating_sub(1024)..];
            let observed2 = tail.iter().cloned().fold(0.0f32, f32::max).abs();
            assert!(
                (observed2 - 0.5).abs() / 0.5 < 0.08,
                "[{}] 实时改参后稳态输出应为 ~0.5，实测 {observed2:.4}",
                entry.format
            );

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
            rack.set_config(RackConfig::default());
        }

        assert_eq!(
            verified_formats.len(),
            2,
            "应验证 VST3 与 CLAP 两个格式，实际: {verified_formats:?}"
        );
    }
}
