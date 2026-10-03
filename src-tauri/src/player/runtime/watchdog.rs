use core::time::Duration;
use rodio::Sink;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};
use crate::player::types::{PlaybackBufferPayload, SharedProgress};

// 网络断流持续多久后把 sink 压停
const STARVE_PAUSE_THRESHOLD: Duration = Duration::from_millis(300);
// 重新来数后观察多久才放行 sink
const RESUME_GRACE_WINDOW: Duration = Duration::from_millis(250);

// 系统默认输出设备变化时是否值得整体重建输出链
// 把 reader 走完解码链后挂上 sink：降混 → 跳过偏移 → 缓冲监视 → 响度 → EQ → 音效 → 插件 → 主音量 → 限幅 → 计量
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
pub(super) fn survey_stream_health(
    live_progress: &SharedProgress,
    sink_slot: &Option<Sink>,
    stream_over_network: bool,
    audible: bool,
    app: &AppHandle,
    watchdog_held_sink: &mut bool,
    watchdog_buffer_flag: &mut bool,
    watchdog_starve_marker: &mut Option<std::time::Instant>,
    watchdog_grace_marker: &mut Option<std::time::Instant>,
) {
    if !stream_over_network {
        return;
    }

    let now = std::time::Instant::now();
    let starved = live_progress.buffered.starved.load(Ordering::Relaxed);
    let produced = live_progress
        .buffered
        .produced
        .swap(false, Ordering::Relaxed);

    // 压停期间来过数即视为已恢复，本轮不算断流
    let revived = produced && *watchdog_held_sink;
    let starved = starved && !revived;

    if starved && audible && !*watchdog_held_sink {
        let since = watchdog_starve_marker.get_or_insert(now);
        if now.saturating_duration_since(*since) >= STARVE_PAUSE_THRESHOLD {
            if let Some(sink) = sink_slot {
                sink.pause();
            }
            *watchdog_held_sink = true;
            *watchdog_starve_marker = None;
            if !*watchdog_buffer_flag {
                *watchdog_buffer_flag = true;
                let _ = app.emit("playback:buffer", PlaybackBufferPayload { buffering: true });
            }
        }
    } else if starved {
        // 断流但（未在播/已压停）：只记起点，等条件满足再压
        *watchdog_starve_marker = Some(now);
        *watchdog_grace_marker = None;
    } else {
        *watchdog_starve_marker = None;

        if *watchdog_held_sink {
            if !audible {
                if *watchdog_buffer_flag {
                    *watchdog_buffer_flag = false;
                    let _ = app.emit(
                        "playback:buffer",
                        PlaybackBufferPayload { buffering: false },
                    );
                }
                *watchdog_held_sink = false;
                return;
            }
            if watchdog_grace_marker.is_none() {
                *watchdog_grace_marker = Some(now);
            }
            let held = watchdog_grace_marker
                .and_then(|marked| now.checked_duration_since(marked))
                .unwrap_or_default();
            if held >= RESUME_GRACE_WINDOW {
                *watchdog_grace_marker = None;
                if let Some(sink) = sink_slot {
                    sink.play();
                }
                *watchdog_held_sink = false;
                if *watchdog_buffer_flag {
                    *watchdog_buffer_flag = false;
                    let _ = app.emit(
                        "playback:buffer",
                        PlaybackBufferPayload { buffering: false },
                    );
                }
            }
        } else if *watchdog_buffer_flag {
            *watchdog_buffer_flag = false;
            let _ = app.emit(
                "playback:buffer",
                PlaybackBufferPayload { buffering: false },
            );
        }
    }
}
