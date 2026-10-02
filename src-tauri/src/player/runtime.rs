use super::output_runtime::{
    boot_media_key_hub, broadcast_output_state, drain_finished_exclusive, launch_exclusive_session,
    rebuild_output_stack, reopen_shared_pipeline, should_restore_for_default_device_change,
    teardown_exclusive_session,
};
#[cfg(test)]
use super::remote_reader::RemoteRangeReader;
use super::source_pipeline::{handle_play, reposition_playhead};
use crate::player::device::default_output_device_name;
use crate::player::loudness::VolumeNormalizerHandle;
use crate::player::output::shared::{
    progress_seconds_from_samples, restore_current_playback, SharedOutputBackend,
};
#[cfg(target_os = "windows")]
use crate::player::output::wasapi_exclusive::WasapiExclusivePlayback;
use crate::player::output::OutputBackend;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioOutputStatus, AudioSource, BufferedMonitor,
    PlaybackBufferPayload, PlaybackProgressPayload, PlayerState, SeekCompletedPayload,
    SharedProgress, SharedVisualizer,
};
use crate::remote::cache::RemoteStreamSource;
use rodio::Sink;
use souvlaki::{MediaPlayback, MediaPosition};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(test)]
use rodio::{Decoder, Source};
#[cfg(test)]
use std::io::{BufReader, Read, Seek, SeekFrom};

// 播放线程空转时等待命令的节拍
const COMMAND_WAIT_TICK: Duration = Duration::from_millis(150);
// 进度事件两次广播之间的最小间隔
const PROGRESS_BROADCAST_SPACING: Duration = Duration::from_millis(500);
// 网络断流持续多久后把 sink 压停
const STARVE_PAUSE_THRESHOLD: Duration = Duration::from_millis(300);
// 重新来数后观察多久才放行 sink
const RESUME_GRACE_WINDOW: Duration = Duration::from_millis(250);
// 输出后端丢失后，多久再尝试一次自救
const OUTPUT_RECOVERY_SPACING: Duration = Duration::from_millis(1000);
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
fn confine_device_fault<F>(device_job: F) -> bool
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

// 由共享进度原子量折算当前播放到的时间点
pub(super) fn elapsed_playback_time(progress: &Arc<SharedProgress>) -> Duration {
    let played = progress.samples_played.load(Ordering::Relaxed);
    let hz = progress.sample_rate.load(Ordering::Relaxed);
    let lanes = progress.channels.load(Ordering::Relaxed);
    Duration::from_secs_f64(progress_seconds_from_samples(played, hz, lanes))
}

// 把指定秒数换算成声道交织后的采样序号
pub(super) fn samples_for_position(at_seconds: f64, progress: &SharedProgress) -> u64 {
    let hz = progress.sample_rate.load(Ordering::Relaxed);
    let lanes = progress.channels.load(Ordering::Relaxed);
    (at_seconds * hz as f64 * lanes as f64).round() as u64
}

// 起播/换曲前清空全部进度簿记，避免上一首的残影
pub(super) fn wipe_progress_bookkeeping(progress: &Arc<SharedProgress>) {
    let loose = Ordering::Relaxed;
    progress.samples_played.store(0, loose);
    progress.sample_rate.store(0, loose);
    progress.channels.store(0, loose);
    progress.start_failed.store(false, loose);
    progress.buffered.starved.store(false, loose);
    progress.buffered.produced.store(false, loose);
    if let Ok(mut reason_slot) = progress.start_failed_reason.lock() {
        *reason_slot = None;
    }
    progress.visualizer.reset();
}

// 系统默认输出设备变化时是否值得整体重建输出链
// 把 reader 走完解码链后挂上 sink：降混 → 跳过偏移 → 缓冲监视 → 响度 → EQ → 音效 → 插件 → 主音量 → 限幅 → 计量
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn survey_stream_health(
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

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (command_tx, command_rx) = channel::<AudioCommand>();
    let runtime_progress = Arc::new(SharedProgress {
        is_playing: Arc::new(AtomicBool::new(false)),
        total_duration_secs: Arc::new(AtomicU64::default()),
        buffered: Arc::new(BufferedMonitor::new()),
        start_failed_reason: Arc::new(std::sync::Mutex::new(None)),
        start_failed: Arc::new(AtomicBool::new(false)),
        visualizer: Arc::new(SharedVisualizer::new()),
        channels: Arc::new(AtomicU32::from(2)),
        sample_rate: Arc::new(AtomicU32::from(44_100)),
        samples_played: Arc::new(AtomicU64::default()),
    });
    let live_progress = runtime_progress.clone();
    let worker_app = app.clone();
    let media_hub = boot_media_key_hub(app);
    let output_status_slot = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let worker_status = output_status_slot.clone();
    let worker_controls = media_hub.clone();

    let worker_eq = Arc::new(crate::player::equalizer::EqualizerHandle::new(
        crate::player::equalizer::EqualizerSettings::default(),
    ));
    let worker_se = Arc::new(crate::player::sound_effect::SoundEffectHandle::new(
        crate::player::sound_effect::SoundEffectSettings::default(), // 默认音效参数
    )); // 构造完成
    let master_volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
    let worker_master_volume = master_volume.clone();

    std::thread::spawn(move || {
        let audio_host = cpal::default_host();
        let mut chosen_device: Option<String> = None;
        let mut shared_out = SharedOutputBackend::open(&audio_host, None).ok();
        let mut sink_slot: Option<Sink> = None;
        #[cfg(target_os = "windows")]
        let mut exclusive_session: Option<WasapiExclusivePlayback> = None;
        let mut active_file_path = String::new();
        let mut speaker_gain = 1.0_f32;
        let tempo_scale = 1.0_f32;
        let mut audible = false;
        let mut wanted_mode = AudioOutputMode::Shared;
        let mut live_mode = AudioOutputMode::Shared;
        let mut downgrade_note: Option<String> = None;
        let mut prior_system_default = default_output_device_name(&audio_host);
        let mut live_device_label = shared_out
            .as_ref()
            .map(|backend| backend.active_device_name().to_string());
        let mut loudness_slot: Option<VolumeNormalizerHandle> = None;
        let mut balance_gain_live = 1.0_f32;
        let mut dsd_passthrough_live = true;
        let mut bit_perfect_live = false;
        let mut last_progress_burst = std::time::Instant::now();
        let mut last_output_salvage = std::time::Instant::now();
        let mut remote_feed: Option<RemoteStreamSource> = None;
        let mut temp_file_feed: Option<crate::player::stream_cache::StreamingTempFileState> = None;
        let mut watchdog_held_sink = false;
        let mut watchdog_buffer_flag = false;
        let mut watchdog_starve_marker: Option<std::time::Instant> = None;
        let mut watchdog_grace_marker: Option<std::time::Instant> = None;
        let mut stream_over_network = false;

        if let Some(backend) = &shared_out {
            sink_slot = backend.create_sink().ok();
        }

        broadcast_output_state(
            &worker_app,
            &worker_status,
            &chosen_device,
            &live_device_label,
            wanted_mode,
            live_mode,
            &downgrade_note,
        );

        'command_pump: loop {
            live_progress.is_playing.store(audible, Ordering::Relaxed);
            survey_stream_health(
                &live_progress,
                &sink_slot,
                stream_over_network,
                audible,
                &worker_app,
                &mut watchdog_held_sink,
                &mut watchdog_buffer_flag,
                &mut watchdog_starve_marker,
                &mut watchdog_grace_marker,
            );

            #[cfg(target_os = "windows")]
            {
                confine_device_fault(|| {
                    drain_finished_exclusive(
                        &mut exclusive_session,
                        &chosen_device,
                        &mut shared_out,
                        &audio_host,
                        &mut sink_slot,
                        &mut live_device_label,
                        &mut wanted_mode,
                        &mut live_mode,
                        &mut downgrade_note,
                        &active_file_path,
                        audible,
                        &live_progress,
                        worker_eq.clone(),
                        worker_se.clone(),
                        worker_master_volume.clone(),
                        balance_gain_live,
                        &mut loudness_slot,
                        remote_feed.as_ref(),
                        temp_file_feed.as_ref(),
                        &worker_app,
                        &worker_status,
                        &mut prior_system_default,
                    );
                });
            }

            match command_rx.recv_timeout(COMMAND_WAIT_TICK) {
                Ok(incoming) => {
                    let outcome =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match incoming {
                            AudioCommand::Play {
                                source: music_source,
                                output_mode: requested_mode,
                                start_offset_ms: begin_at_ms,
                                volume_balance_gain: requested_balance,
                                dsd_native_passthrough,
                                bit_perfect,
                            } => {
                                wanted_mode = requested_mode;
                                balance_gain_live = requested_balance;
                                dsd_passthrough_live = dsd_native_passthrough;
                                bit_perfect_live = bit_perfect;
                                let stream_backed = music_source.is_network_backed();
                                let track_label = music_source.display_path();
                                remote_feed = match &music_source {
                                    AudioSource::RemoteWebDav(web) => Some(web.clone()),
                                    AudioSource::LocalFile(_) => None,
                                    AudioSource::StreamingTempFile(_) => None,
                                };
                                temp_file_feed = match &music_source {
                                    AudioSource::StreamingTempFile(cache) => Some(cache.clone()),
                                    _ => None,
                                };
                                stream_over_network = stream_backed;
                                watchdog_held_sink = false;
                                watchdog_buffer_flag = false;
                                watchdog_starve_marker = None;
                                watchdog_grace_marker = None;

                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);

                                #[cfg(target_os = "windows")]
                                if requested_mode == AudioOutputMode::WasapiExclusive
                                    && !stream_backed
                                {
                                    let exclusive_start = begin_at_ms
                                        .map(Duration::from_millis)
                                        .unwrap_or(Duration::ZERO);
                                    match launch_exclusive_session(
                                        track_label.clone(),
                                        chosen_device.clone(),
                                        speaker_gain,
                                        true,
                                        exclusive_start,
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    ) {
                                        Ok(session) => {
                                            if chosen_device.is_none() {
                                                prior_system_default =
                                                    default_output_device_name(&audio_host);
                                            }
                                            live_device_label =
                                                Some(session.active_device_name().to_string());
                                            live_mode = AudioOutputMode::WasapiExclusive;
                                            downgrade_note = None;
                                            active_file_path = track_label;
                                            audible = true;
                                            exclusive_session = Some(session);
                                            sink_slot = None;
                                            shared_out = None;

                                            broadcast_output_state(
                                                &worker_app,
                                                &worker_status,
                                                &chosen_device,
                                                &live_device_label,
                                                wanted_mode,
                                                live_mode,
                                                &downgrade_note,
                                            );
                                            return;
                                        }
                                        Err(error) => {
                                            live_mode = AudioOutputMode::Shared;
                                            downgrade_note = Some(error);
                                        }
                                    }
                                }
                                #[cfg(target_os = "windows")]
                                if requested_mode == AudioOutputMode::WasapiExclusive
                                    && stream_backed
                                {
                                    live_mode = AudioOutputMode::Shared;
                                    downgrade_note =
                                        Some("网络音频使用共享模式缓冲播放".to_string());
                                }

                                #[cfg(not(target_os = "windows"))]
                                if requested_mode == AudioOutputMode::WasapiExclusive {
                                    live_mode = AudioOutputMode::Shared;
                                    downgrade_note = Some(
                                        "WASAPI exclusive mode is only available on Windows"
                                            .to_string(),
                                    );
                                }

                                if live_mode == AudioOutputMode::Shared {
                                    confine_device_fault(|| {
                                        shared_out = SharedOutputBackend::open(
                                            &audio_host,
                                            chosen_device.as_deref(),
                                        )
                                        .ok();
                                    });
                                    if chosen_device.is_none() {
                                        prior_system_default =
                                            default_output_device_name(&audio_host);
                                    }
                                    live_device_label = shared_out
                                        .as_ref()
                                        .map(|backend| backend.active_device_name().to_string());
                                }

                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );

                                handle_play(
                                    music_source,
                                    &shared_out,
                                    &mut sink_slot,
                                    &mut active_file_path,
                                    &mut audible,
                                    &live_progress,
                                    begin_at_ms,
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                );
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                            }
                            AudioCommand::Pause => {
                                audible = false;
                                if watchdog_buffer_flag {
                                    watchdog_buffer_flag = false;
                                    let _ = worker_app.emit(
                                        "playback:buffer",
                                        PlaybackBufferPayload { buffering: false },
                                    );
                                }
                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                loudness_slot = None;
                                shared_out = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);
                            }
                            AudioCommand::Stop => {
                                audible = false;
                                active_file_path.clear();
                                wipe_progress_bookkeeping(&live_progress);
                                watchdog_held_sink = false;
                                watchdog_buffer_flag = false;
                                watchdog_starve_marker = None;
                                watchdog_grace_marker = None;
                                let _ = worker_app.emit(
                                    "playback:buffer",
                                    PlaybackBufferPayload { buffering: false },
                                );
                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                loudness_slot = None;
                                shared_out = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);
                            }
                            AudioCommand::Resume => {
                                audible = true;
                                if active_file_path.is_empty() {
                                    return;
                                }
                                #[cfg(target_os = "windows")]
                                let stream_backed = stream_over_network;
                                #[cfg(target_os = "windows")]
                                if wanted_mode == AudioOutputMode::WasapiExclusive && !stream_backed
                                {
                                    teardown_exclusive_session(&mut exclusive_session);
                                    match launch_exclusive_session(
                                        active_file_path.clone(),
                                        chosen_device.clone(),
                                        speaker_gain,
                                        true,
                                        elapsed_playback_time(&live_progress),
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    ) {
                                        Ok(session) => {
                                            if chosen_device.is_none() {
                                                prior_system_default =
                                                    default_output_device_name(&audio_host);
                                            }
                                            live_device_label =
                                                Some(session.active_device_name().to_string());
                                            live_mode = AudioOutputMode::WasapiExclusive;
                                            downgrade_note = None;
                                            exclusive_session = Some(session);
                                            sink_slot = None;
                                            shared_out = None;
                                            loudness_slot = None;
                                            broadcast_output_state(
                                                &worker_app,
                                                &worker_status,
                                                &chosen_device,
                                                &live_device_label,
                                                wanted_mode,
                                                live_mode,
                                                &downgrade_note,
                                            );
                                            return;
                                        }
                                        Err(error) => {
                                            downgrade_note = Some(error);
                                        }
                                    }
                                }

                                confine_device_fault(|| {
                                    shared_out = SharedOutputBackend::open(
                                        &audio_host,
                                        chosen_device.as_deref(),
                                    )
                                    .ok();
                                });
                                if chosen_device.is_none() {
                                    prior_system_default = default_output_device_name(&audio_host);
                                }
                                live_device_label = shared_out
                                    .as_ref()
                                    .map(|backend| backend.active_device_name().to_string());
                                live_mode = AudioOutputMode::Shared;
                                restore_current_playback(
                                    &shared_out,
                                    &mut sink_slot,
                                    &active_file_path,
                                    true,
                                    &live_progress,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                );
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );
                            }
                            AudioCommand::Seek {
                                time: requested_time,
                                is_playing: should_resume,
                                request_id: pending_id,
                            } => {
                                #[cfg(target_os = "windows")]
                                if let Some(session) = &exclusive_session {
                                    let landing = requested_time.max(0.0);
                                    audible = should_resume;
                                    session.seek(Duration::from_secs_f64(landing), should_resume);
                                    let _ = worker_app.emit(
                                        "seek_completed",
                                        SeekCompletedPayload {
                                            request_id: pending_id,
                                            time: landing,
                                        },
                                    );
                                    return;
                                }

                                watchdog_held_sink = false;
                                watchdog_buffer_flag = false;
                                watchdog_starve_marker = None;
                                watchdog_grace_marker = None;

                                reposition_playhead(
                                    requested_time,
                                    should_resume,
                                    pending_id,
                                    &shared_out,
                                    &mut sink_slot,
                                    &active_file_path,
                                    &mut audible,
                                    &live_progress,
                                    &worker_app,
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                )
                            }
                            AudioCommand::SetVolume(target_bits) => {
                                speaker_gain = target_bits;
                                worker_master_volume
                                    .store(target_bits.to_bits(), Ordering::Relaxed);
                            }
                            AudioCommand::SetDevice(picked_device) => {
                                chosen_device = picked_device;

                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);

                                confine_device_fault(|| {
                                    rebuild_output_stack(
                                        &chosen_device,
                                        &mut shared_out,
                                        &audio_host,
                                        &mut sink_slot,
                                        #[cfg(target_os = "windows")]
                                        &mut exclusive_session,
                                        &mut live_device_label,
                                        &mut live_mode,
                                        &mut downgrade_note,
                                        wanted_mode,
                                        &active_file_path,
                                        speaker_gain,
                                        audible,
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        &mut loudness_slot,
                                        remote_feed.as_ref(),
                                        temp_file_feed.as_ref(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    );
                                });
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                                if chosen_device.is_none() {
                                    prior_system_default = default_output_device_name(&audio_host);
                                }

                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );
                            }
                            AudioCommand::SetOutputMode(switch_to) => {
                                wanted_mode = switch_to;

                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);

                                confine_device_fault(|| {
                                    rebuild_output_stack(
                                        &chosen_device,
                                        &mut shared_out,
                                        &audio_host,
                                        &mut sink_slot,
                                        #[cfg(target_os = "windows")]
                                        &mut exclusive_session,
                                        &mut live_device_label,
                                        &mut live_mode,
                                        &mut downgrade_note,
                                        wanted_mode,
                                        &active_file_path,
                                        speaker_gain,
                                        audible,
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        &mut loudness_slot,
                                        remote_feed.as_ref(),
                                        temp_file_feed.as_ref(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    );
                                });
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                                if chosen_device.is_none() {
                                    prior_system_default = default_output_device_name(&audio_host);
                                }

                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );
                            }
                            AudioCommand::SetVolumeBalance {
                                enabled: balance_on,
                                target_gain: requested_gain,
                            } => {
                                let effective_gain = if balance_on { requested_gain } else { 1.0 };
                                balance_gain_live = effective_gain;

                                if let Some(ref leveler) = loudness_slot {
                                    leveler.set_target_gain(effective_gain);
                                }

                                #[cfg(target_os = "windows")]
                                if let Some(ref session) = exclusive_session {
                                    session.set_volume_balance(balance_on, requested_gain);
                                }
                            }
                            AudioCommand::SetEqualizerSettings { settings: curve } => {
                                worker_eq.set_settings(curve.clone());
                                #[cfg(target_os = "windows")]
                                if let Some(ref session) = exclusive_session {
                                    session.set_equalizer_settings(curve);
                                }
                            }
                            AudioCommand::SetSoundEffectSettings { settings: flavor } => {
                                worker_se.set_settings(flavor.clone());
                                #[cfg(target_os = "windows")]
                                if let Some(ref session) = exclusive_session {
                                    session.set_sound_effect_settings(flavor);
                                }
                            }
                        }));
                    if outcome.is_err() {
                        eprintln!(
                            "[Audio][rust] 播放命令处理 panic，已隔离（不终止播放线程，命令通道保持存活）"
                        );
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if chosen_device.is_none() {
                        let refreshed_default = default_output_device_name(&audio_host);

                        // 播放中却连共享后端都没有：周期性尝试自救
                        let needs_output_salvage = audible
                            && shared_out.is_none()
                            && live_mode == AudioOutputMode::Shared
                            && last_output_salvage.elapsed() >= OUTPUT_RECOVERY_SPACING;
                        if needs_output_salvage {
                            last_output_salvage = std::time::Instant::now();
                            if let Some(sink) = &sink_slot {
                                sink.stop();
                            }
                            sink_slot = None;
                            confine_device_fault(|| {
                                reopen_shared_pipeline(
                                    &chosen_device,
                                    &mut shared_out,
                                    &audio_host,
                                    &mut sink_slot,
                                    &mut live_device_label,
                                    &active_file_path,
                                    audible,
                                    &live_progress,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                );
                            });
                            if shared_out.is_some() {
                                downgrade_note = None;
                                live_progress.start_failed.store(false, Ordering::Relaxed);
                                if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                                    *reason = None;
                                }
                                prior_system_default = refreshed_default.clone();
                            } else {
                                downgrade_note = Some(
                                    "未检测到可用的音频输出设备，请检查扬声器/耳机是否已连接"
                                        .to_string(),
                                );
                            }
                            broadcast_output_state(
                                &worker_app,
                                &worker_status,
                                &chosen_device,
                                &live_device_label,
                                wanted_mode,
                                live_mode,
                                &downgrade_note,
                            );
                        }

                        // 系统默认设备换了且我们在裸奔跟随：整体重建输出链
                        if audible
                            && should_restore_for_default_device_change(
                                &chosen_device,
                                &prior_system_default,
                                &refreshed_default,
                                &live_device_label,
                            )
                        {
                            prior_system_default = refreshed_default;
                            if let Some(sink) = &sink_slot {
                                sink.stop();
                            }
                            sink_slot = None;
                            shared_out = None;
                            #[cfg(target_os = "windows")]
                            teardown_exclusive_session(&mut exclusive_session);

                            #[cfg(target_os = "windows")]
                            confine_device_fault(|| {
                                rebuild_output_stack(
                                    &chosen_device,
                                    &mut shared_out,
                                    &audio_host,
                                    &mut sink_slot,
                                    &mut exclusive_session,
                                    &mut live_device_label,
                                    &mut live_mode,
                                    &mut downgrade_note,
                                    wanted_mode,
                                    &active_file_path,
                                    speaker_gain,
                                    audible,
                                    &live_progress,
                                    balance_gain_live,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                    dsd_passthrough_live,
                                    bit_perfect_live,
                                );
                            });
                            #[cfg(not(target_os = "windows"))]
                            confine_device_fault(|| {
                                rebuild_output_stack(
                                    &chosen_device,
                                    &mut shared_out,
                                    &audio_host,
                                    &mut sink_slot,
                                    &mut live_device_label,
                                    &mut live_mode,
                                    &mut downgrade_note,
                                    wanted_mode,
                                    &active_file_path,
                                    speaker_gain,
                                    audible,
                                    &live_progress,
                                    balance_gain_live,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                    dsd_passthrough_live,
                                    bit_perfect_live,
                                );
                            });

                            broadcast_output_state(
                                &worker_app,
                                &worker_status,
                                &None,
                                &live_device_label,
                                wanted_mode,
                                live_mode,
                                &downgrade_note,
                            );
                        }
                    }

                    if audible && last_progress_burst.elapsed() >= PROGRESS_BROADCAST_SPACING {
                        last_progress_burst = std::time::Instant::now();
                        let position = elapsed_playback_time(&live_progress).as_secs_f64();
                        let duration_bits =
                            live_progress.total_duration_secs.load(Ordering::Relaxed);
                        let duration = f64::from_bits(duration_bits);
                        let _ = worker_app.emit(
                            "playback:progress",
                            PlaybackProgressPayload {
                                position,
                                duration,
                                is_playing: true,
                            },
                        );

                        if let Ok(mut hub_guard) = worker_controls.lock() {
                            if let Some(mounted) = hub_guard.as_mut() {
                                let marker =
                                    MediaPosition(Duration::from_secs_f64(position.max(0.0)));
                                let _ = mounted.set_playback(MediaPlayback::Playing {
                                    progress: Some(marker),
                                });
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break 'command_pump,
            }
        }
    });

    PlayerState {
        tx: Mutex::new(command_tx),
        progress: runtime_progress,
        playback_id: Arc::new(AtomicU64::default()),
        controls: media_hub,
        output_status: output_status_slot,
        user_volume: master_volume,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;

    fn spawn_mock_server(
        body: Vec<u8>,
        support_range: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/audio");

        let handle = std::thread::spawn(move || {
            for _ in 0..32 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    continue;
                }
                let req = String::from_utf8_lossy(&buf[..n]);
                let is_head = req.starts_with("HEAD");
                let range = req
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .map(|l| l.to_string());
                let total = body.len();

                if is_head {
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    continue;
                }

                if support_range {
                    if let Some(range) = range {
                        let spec = range.split('=').nth(1).unwrap_or("").trim().to_string();
                        let mut parts = spec.split('-');
                        let start: usize = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
                        if start >= total {
                            let resp = format!(
                                "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nConnection: close\r\n\r\n"
                            );
                            let _ = stream.write_all(resp.as_bytes());
                            continue;
                        }
                        let end: usize = parts
                            .next()
                            .and_then(|v| v.trim().parse().ok())
                            .unwrap_or(total - 1)
                            .min(total - 1);
                        let slice = &body[start..=end];
                        let header = format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                            slice.len(), start, end, total
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(slice);
                        continue;
                    }
                }

                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            }
        });

        (url, handle)
    }

    fn read_all_via_reader(url: &str) -> Vec<u8> {
        let source = RemoteStreamSource {
            remote_uri: url.to_string(),
            url: url.to_string(),
            ..Default::default()
        };
        let mut reader = RemoteRangeReader::new(source).expect("reader 创建失败");
        let mut out = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = reader.read(&mut chunk).expect("读取失败");
            if n == 0 {
                break;
            }
            out.extend_from_slice(&chunk[..n]);
        }
        out
    }

    #[test]
    fn remote_reader_reads_full_body_with_range_support() {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), true);
        let got = read_all_via_reader(&url);
        assert_eq!(got.len(), body.len(), "支持 Range 时应完整读取");
        assert_eq!(got, body, "支持 Range 时内容应一致");
        drop(handle);
    }

    #[test]
    fn remote_reader_reads_full_body_when_range_ignored() {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), false);
        let got = read_all_via_reader(&url);
        assert_eq!(got.len(), body.len(), "忽略 Range 时应通过整曲下载完整读取");
        assert_eq!(got, body, "忽略 Range 时内容应一致");
        drop(handle);
    }

    fn assert_seek_correct(support_range: bool) {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };
        let mut reader = RemoteRangeReader::new(source).expect("reader 创建失败");

        let mut head = [0u8; 16];
        reader.read_exact(&mut head).expect("读开头失败");
        assert_eq!(&head[..], &body[..16], "开头字节应正确");

        let target = 1_500_003_u64;
        reader
            .seek(SeekFrom::Start(target))
            .expect("seek 到中段失败");
        let mut mid = [0u8; 32];
        reader.read_exact(&mut mid).expect("中段读失败");
        assert_eq!(
            &mid[..],
            &body[target as usize..target as usize + 32],
            "seek 后中段字节应正确"
        );

        reader.seek(SeekFrom::Start(100)).expect("seek 回退失败");
        let mut back = [0u8; 8];
        reader.read_exact(&mut back).expect("回退读失败");
        assert_eq!(&back[..], &body[100..108], "seek 回退后字节应正确");

        drop(handle);
    }

    #[test]
    fn remote_reader_seek_correct_with_range_support() {
        assert_seek_correct(true);
    }

    #[test]
    fn remote_reader_seek_correct_when_range_ignored() {
        assert_seek_correct(false);
    }

    fn build_wav(sample_rate: u32, channels: u16, seconds: u32) -> Vec<u8> {
        let bits_per_sample: u16 = 16;
        let num_samples = sample_rate * seconds;
        let block_align = channels * bits_per_sample / 8;
        let byte_rate = sample_rate * block_align as u32;
        let data_len = num_samples * block_align as u32;

        let mut buf = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_len).to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&channels.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&bits_per_sample.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..num_samples {
            let t = i as f32 / sample_rate as f32;
            let value = (t * 440.0 * std::f32::consts::TAU).sin();
            let sample = (value * 16000.0) as i16;
            for _ in 0..channels {
                buf.extend_from_slice(&sample.to_le_bytes());
            }
        }
        buf
    }

    fn assert_decodes(support_range: bool) {
        let wav = build_wav(44_100, 2, 1);
        let (url, handle) = spawn_mock_server(wav.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };
        let reader = RemoteRangeReader::new(source).expect("reader 创建失败");
        let buffered = BufReader::with_capacity(512 * 1024, reader);
        let decoder = Decoder::new(buffered).expect("rodio 应能解码在线 WAV 流");
        assert_eq!(decoder.sample_rate(), 44_100, "解码采样率应为 44100");
        assert_eq!(decoder.channels(), 2, "解码声道数应为 2");
        let produced = decoder.take(1000).count();
        assert!(produced > 0, "解码器应产出音频样本");
        drop(handle);
    }

    fn assert_seek_rebuild_produces_audio(support_range: bool) {
        let wav = build_wav(44_100, 2, 10);
        let (url, handle) = spawn_mock_server(wav.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };

        let reader = RemoteRangeReader::new(source).expect("重建 reader 应成功");
        let buffered = BufReader::with_capacity(512 * 1024, reader);
        let decoder = Decoder::new(buffered).expect("重建后应能解码");
        assert_eq!(decoder.sample_rate(), 44_100);

        let jump_target = Duration::from_secs(8);
        let mut skipped = decoder.convert_samples::<f32>().skip_duration(jump_target);
        let produced = (0..1000).filter_map(|_| skipped.next()).count();
        assert!(
            produced > 0,
            "seek 到靠后位置重建后应仍能产出音频样本（support_range={support_range}）"
        );

        drop(handle);
    }

    #[test]
    fn seek_rebuild_produces_audio_with_range_support() {
        assert_seek_rebuild_produces_audio(true);
    }

    #[test]
    fn seek_rebuild_produces_audio_when_range_ignored() {
        assert_seek_rebuild_produces_audio(false);
    }

    #[test]
    fn rodio_decodes_online_wav_with_range_support() {
        assert_decodes(true);
    }

    #[test]
    fn rodio_decodes_online_wav_when_range_ignored() {
        assert_decodes(false);
    }

    #[test]
    fn rodio_decodes_and_seeks_wavpack() {
        let params = wavicle::EncodeParams {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
        };
        let frames: Vec<i32> = (0..4410)
            .flat_map(|i| {
                let l = (i % 1000) * 30 - 15000;
                let r = 15000 - (i % 700) * 40;
                [l, r]
            })
            .collect();
        let bytes = wavicle::encode_int(params, &frames).expect("编码 wv 流失败");

        let cursor = std::io::Cursor::new(bytes);
        let mut decoder = Decoder::new(cursor).expect("rodio 应能解码 wv 流");
        assert_eq!(decoder.sample_rate(), 44_100, "wv 采样率应为 44100");
        assert_eq!(decoder.channels(), 2, "wv 声道数应为 2");
        assert_eq!(
            decoder.total_duration().map(|d| d.as_millis()),
            Some(100),
            "wv 总时长应为 100ms"
        );

        let samples: Vec<f32> = decoder.by_ref().collect();
        assert_eq!(samples.len(), frames.len(), "wv 应解码出全部交错样本");
        for (got, want) in samples.iter().zip(frames.iter()) {
            assert!(
                (got - *want as f32 / 32768.0).abs() < 1e-6,
                "wv 样本数值不符：{got} vs {want}"
            );
        }

        decoder
            .try_seek(Duration::from_millis(50))
            .expect("wv 应支持 seek");
        let remaining = decoder.count();
        assert_eq!(remaining, 2205 * 2, "seek 到 50ms 后应剩余一半样本");
    }

    fn test_progress_at(seconds: f64) -> Arc<SharedProgress> {
        let sample_rate = 44_100_u32;
        let channels = 2_u32;
        let samples = (seconds * sample_rate as f64 * channels as f64).round() as u64;

        Arc::new(SharedProgress {
            samples_played: Arc::new(AtomicU64::new(samples)),
            sample_rate: Arc::new(AtomicU32::new(sample_rate)),
            channels: Arc::new(AtomicU32::new(channels)),
            visualizer: Arc::new(SharedVisualizer::new()),
            start_failed: Arc::new(AtomicBool::new(false)),
            start_failed_reason: Arc::new(std::sync::Mutex::new(None)),
            buffered: Arc::new(BufferedMonitor::new()),
            total_duration_secs: Arc::new(AtomicU64::new(0u64)),
            is_playing: Arc::new(AtomicBool::new(false)),
        })
    }

    #[test]
    fn handle_play_resets_progress_even_when_new_source_cannot_open() {
        let progress = test_progress_at(206.0);
        let mut current_sink = None;
        let mut current_path = String::new();
        let mut is_playing_flag = false;
        let mut current_normalizer_handle = None;

        let eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
            crate::player::equalizer::EqualizerSettings::default(),
        ));
        let se_handle = Arc::new(crate::player::sound_effect::SoundEffectHandle::new( // 默认音效句柄
            crate::player::sound_effect::SoundEffectSettings::default(), // 默认参数
        )); // 构造完成
        let user_volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0_f32.to_bits()));

        handle_play(
            AudioSource::LocalFile("Z:\\missing\\song.flac".to_string()),
            &None,
            &mut current_sink,
            &mut current_path,
            &mut is_playing_flag,
            &progress,
            None,
            1.0,
            &mut current_normalizer_handle,
            eq_handle,
            se_handle, // 挂载音效句柄
            user_volume,
        );

        assert_eq!(progress.samples_played.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn default_device_monitor_ignores_active_output_display_name() {
        let selected_device_name = None;
        let last_default_device_name = Some("CPAL default device".to_string());
        let next_default_device_name = Some("CPAL default device".to_string());
        let active_device_name = Some("WASAPI friendly device".to_string());

        assert!(!should_restore_for_default_device_change(
            &selected_device_name,
            &last_default_device_name,
            &next_default_device_name,
            &active_device_name,
        ));
    }

    #[test]
    fn default_device_monitor_ignores_transient_enumeration_failure() {
        let selected_device_name = None;
        let last_default_device_name = Some("扬声器".to_string());
        let next_default_device_name: Option<String> = None;
        let active_device_name = Some("扬声器".to_string());

        assert!(!should_restore_for_default_device_change(
            &selected_device_name,
            &last_default_device_name,
            &next_default_device_name,
            &active_device_name,
        ));
    }

    #[test]
    #[ignore = "依赖本地 m4s 临时文件（XY_M4S_PATH 可指定），手动 --ignored 运行"]
    fn debug_decode_bilibili_m4s() {
        let path = std::env::var("XY_M4S_PATH").unwrap_or_else(|_| {
            "C:\\Users\\小奇\\AppData\\Local\\Temp\\xianyu_music_1787144280366.m4s".to_string()
        });
        let file = std::fs::File::open(&path).expect("open m4s");
        let reader = std::io::BufReader::with_capacity(512 * 1024, file);
        let decoder = rodio::Decoder::new(reader).expect("rodio 应能解码 m4s");
        let rate = decoder.sample_rate();
        let channels = decoder.channels();
        let total = decoder.total_duration();
        eprintln!("[debug-m4s] rate={rate} channels={channels} total_duration={total:?}");
        if let Some(t) = total {
            eprintln!(
                "[debug-m4s] dur secs={} nanos={} as_nanos={} as_secs_f64={}",
                t.as_secs(),
                t.subsec_nanos(),
                t.as_nanos(),
                t.as_secs_f64()
            );
        }
        let mut source = decoder.convert_samples::<f32>();
        let mut count: u64 = 0;
        for _ in 0..(rate as u64 * channels as u64 * 300) {
            match source.next() {
                Some(_) => count += 1,
                None => break,
            }
        }
        let seconds = count as f64 / (rate as u64 * channels as u64) as f64;
        eprintln!("[debug-m4s] decoded_samples={count} decoded_seconds={seconds:.2}");
        assert!(seconds > 60.0, "应能解码超过 60 秒，实际 {seconds:.2} 秒");
    }

    #[test]
    fn m4s_sentinel_duration_detection() {
        let sentinel = std::time::Duration::new(0, u32::MAX);
        assert_eq!(
            sentinel.as_secs(),
            4,
            "Duration::new(0, u32::MAX) 会被规范化"
        );
        assert_eq!(sentinel.subsec_nanos(), 294967295);
        assert_eq!(
            sentinel.as_nanos(),
            u32::MAX as u128,
            "as_nanos 应精确等于 u32::MAX"
        );

        let is_sentinel = |d: std::time::Duration| d.as_nanos() == u32::MAX as u128;
        assert!(is_sentinel(sentinel), "哨兵值应被识别为误报");

        let normal = std::time::Duration::from_secs_f64(278.0);
        assert!(!is_sentinel(normal), "正常时长不应被误判为哨兵");
        let exactly = std::time::Duration::from_secs_f64(4.294967295);
        assert!(is_sentinel(exactly));
    }
}
