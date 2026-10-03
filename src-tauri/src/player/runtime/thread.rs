use crate::player::output_runtime::{
    boot_media_key_hub, broadcast_output_state, drain_finished_exclusive, launch_exclusive_session,
    rebuild_output_stack, reopen_shared_pipeline, should_restore_for_default_device_change,
    teardown_exclusive_session,
};
use crate::player::source_pipeline::{handle_play, reposition_playhead};
use crate::player::device::default_output_device_name;
use crate::player::loudness::VolumeNormalizerHandle;
use crate::player::output::shared::{restore_current_playback, SharedOutputBackend};
#[cfg(windows)]
use crate::player::output::wasapi_exclusive::WasapiExclusivePlayback;
use crate::player::output::{OutputBackend};
use crate::player::types::{ // 实现
    AudioCommand, AudioOutputMode, AudioOutputStatus, AudioSource, BufferedMonitor,
    PlaybackBufferPayload, PlaybackProgressPayload, PlayerState, SeekCompletedPayload,
    SharedProgress, SharedVisualizer,
};
use crate::remote::cache::{RemoteStreamSource};
use rodio::Sink;
use souvlaki::{MediaPlayback, MediaPosition};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::sync::{Mutex, Arc};
use core::time::Duration;
use tauri::{AppHandle, Emitter};
use super::common::{confine_device_fault, elapsed_playback_time, wipe_progress_bookkeeping};
use super::watchdog::survey_stream_health;

// 播放线程空转时等待命令的节拍
const COMMAND_WAIT_TICK: Duration = Duration::from_millis(150);
// 进度事件两次广播之间的最小间隔
const PROGRESS_BROADCAST_SPACING: Duration = Duration::from_millis(500);
// 输出后端丢失后，多久再尝试一次自救
const OUTPUT_RECOVERY_SPACING: Duration = Duration::from_millis(1000);

pub fn init_player(app: &AppHandle) -> PlayerState { // init_player
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
        crate::player::equalizer::EqualizerSettings::default(), // 实现
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
        #[cfg(windows)]
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
                Err(RecvTimeoutError::Timeout) => { // 实现
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
                                sink.stop(); // 实现
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
                                sink.stop(); // 实现
                            }
                            sink_slot = None;
                            shared_out = None;
                            #[cfg(windows)]
                            teardown_exclusive_session(&mut exclusive_session);

                            #[cfg(windows)]
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

    PlayerState { // 实现
        tx: Mutex::new(command_tx),
        progress: runtime_progress,
        playback_id: Arc::new(AtomicU64::default()),
        controls: media_hub,
        output_status: output_status_slot,
        user_volume: master_volume,
    }
}
