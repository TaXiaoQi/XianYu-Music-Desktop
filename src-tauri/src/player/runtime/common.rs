use core::time::Duration;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use crate::player::output::shared::progress_seconds_from_samples;
use crate::player::types::SharedProgress;

// 把 panic 携带的负载转成可读文本
fn panic_reason_text(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(borrowed) = payload.downcast_ref::<&str>() {
        return (*borrowed).to_string();
    }
    if let Some(owned) = payload.downcast_ref::<String>() {
        return owned.clone();
    }
    "未知 panic".to_string()
}

// 设备层操作包一层 panic 隔离：炸了只记日志，播放线程不许陪葬
#[allow(clippy::type_complexity)]
pub(super) fn confine_device_fault<F>(device_job: F) -> bool
where
    F: FnOnce(),
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(device_job)) {
        Ok(()) => true,
        Err(payload) => {
            let reason = panic_reason_text(payload.as_ref());
            eprintln!("[Audio][rust] 音频设备相关操作 panic，已隔离（不终止播放线程）: {reason}");
            false
        }
    }
}

// 同上，但保留闭包返回值（panic 时返回 None）
pub(super) fn confine_device_fault_with<F, R>(device_job: F) -> Option<R>
where
    F: FnOnce() -> R,
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(device_job)) {
        Ok(value) => Some(value),
        Err(payload) => {
            let reason = panic_reason_text(payload.as_ref());
            eprintln!("[Audio][rust] 音频设备相关操作 panic，已隔离（不终止播放线程）: {reason}");
            None
        }
    }
}

// 由共享进度原子量折算当前播放到的时间点。
// 跳过静音压缩过样本流：实播数 + 丢弃数 = 原曲时间轴位置，UI 刻度不受影响。
pub(in crate::player) fn elapsed_playback_time(progress: &Arc<SharedProgress>) -> Duration {
    let played = progress.samples_played.load(Ordering::Relaxed);
    let skipped = progress.skipped_samples.load(Ordering::Relaxed);
    let hz = progress.sample_rate.load(Ordering::Relaxed);
    let lanes = progress.channels.load(Ordering::Relaxed);
    Duration::from_secs_f64(progress_seconds_from_samples(
        played + skipped,
        hz,
        lanes,
    ))
}

// 把指定秒数换算成声道交织后的采样序号
pub(in crate::player) fn samples_for_position(at_seconds: f64, progress: &SharedProgress) -> u64 {
    let hz = progress.sample_rate.load(Ordering::Relaxed);
    let lanes = progress.channels.load(Ordering::Relaxed);
    (at_seconds * hz as f64 * lanes as f64).round() as u64
}

// 起播/换曲前清空全部进度簿记，避免上一首的残影
pub(in crate::player) fn wipe_progress_bookkeeping(progress: &Arc<SharedProgress>) {
    let loose = Ordering::Relaxed;
    progress.samples_played.store(0, loose);
    progress.skipped_samples.store(0, loose);
    progress.sample_rate.store(0, loose);
    progress.channels.store(0, loose);
    progress.start_failed.store(false, loose);
    progress.buffered.starved.store(false, loose);
    progress.buffered.produced.store(false, loose);
    if let Ok(mut reason_slot) = progress.start_failed_reason.lock() {
        *reason_slot = None;
    }
    progress.visualizer.reset(); // 实现
}
