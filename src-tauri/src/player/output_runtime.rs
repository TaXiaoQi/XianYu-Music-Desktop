use super::runtime::elapsed_playback_time;
pub(super) fn should_restore_for_default_device_change(
    chosen_device: &Option<String>,
    previous_default: &Option<String>,
    refreshed_default: &Option<String>,
    _active_label: &Option<String>,
) -> bool {
    match (chosen_device, refreshed_default) {
        (None, Some(pending)) => previous_default.as_deref() != Some(pending.as_str()),
        _ => false,
    }
}

#[cfg(target_os = "windows")]
pub(super) fn teardown_exclusive_session(session_slot: &mut Option<WasapiExclusivePlayback>) {
    if let Some(mut session) = session_slot.take() {
        session.stop();
    }
}

#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
pub(super) fn launch_exclusive_session(
    track_path: String,
    chosen_device: Option<String>,
    speaker_gain: f32,
    should_resume: bool,
    resume_from: Duration,
    progress: &Arc<SharedProgress>,
    balance_gain: f32,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    dsd_passthrough: bool,
    bit_perfect: bool,
) -> Result<WasapiExclusivePlayback, String> {
    WasapiExclusivePlayback::start(ExclusivePlayRequest {
        path: track_path,
        device_name: chosen_device,
        volume: speaker_gain,
        is_playing: should_resume,
        progress: progress.clone(),
        start_time: resume_from,
        volume_balance_gain: balance_gain,
        equalizer_handle: equalizer_rig,
        sound_effect_handle: effect_rig,
        user_volume: master_volume,
        dsd_native_passthrough: dsd_passthrough,
        bit_perfect,
    })
    .map_err(|error| error.to_string())
}

// 统一的输出状态广播入口：先走本地快照再交由 device 模块发事件
#[allow(clippy::too_many_arguments)]
pub(super) fn broadcast_output_state(
    app: &AppHandle,
    status_slot: &Arc<Mutex<AudioOutputStatus>>,
    chosen_device: &Option<String>,
    live_device_label: &Option<String>,
    wanted_mode: AudioOutputMode,
    live_mode: AudioOutputMode,
    downgrade_note: &Option<String>,
) {
    emit_output_status(
        app,
        status_slot,
        chosen_device.clone(),
        live_device_label.clone(),
        wanted_mode,
        live_mode,
        downgrade_note.clone(),
    );
}

// 按当前请求的输出模式重建整条输出链（独占优先，失败回落共享）
#[allow(clippy::too_many_arguments)]
pub(super) fn rebuild_output_stack(
    chosen_device: &Option<String>,
    shared_out: &mut Option<SharedOutputBackend>,
    audio_host: &cpal::Host,
    sink_slot: &mut Option<Sink>,
    #[cfg(target_os = "windows")] exclusive_session: &mut Option<WasapiExclusivePlayback>,
    live_device_label: &mut Option<String>,
    live_mode: &mut AudioOutputMode,
    downgrade_note: &mut Option<String>,
    wanted_mode: AudioOutputMode,
    active_file_path: &str,
    speaker_gain: f32,
    audible: bool,
    live_progress: &Arc<SharedProgress>,
    balance_gain: f32,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
    dsd_passthrough: bool,
    bit_perfect: bool,
) {
    // 先把旧后端放掉再开新的，避免设备句柄残留占用
    *shared_out = None;
    *shared_out = SharedOutputBackend::open(audio_host, chosen_device.as_deref()).ok();
    *live_device_label = shared_out
        .as_ref()
        .map(|backend| backend.active_device_name().to_string());

    #[cfg(target_os = "windows")]
    if wanted_mode == AudioOutputMode::WasapiExclusive && !active_file_path.is_empty() {
        match launch_exclusive_session(
            active_file_path.to_string(),
            chosen_device.clone(),
            speaker_gain,
            audible,
            elapsed_playback_time(live_progress),
            live_progress,
            balance_gain,
            equalizer_rig.clone(),
            effect_rig.clone(),
            master_volume.clone(),
            dsd_passthrough,
            bit_perfect,
        ) {
            Ok(session) => {
                *live_device_label = Some(session.active_device_name().to_string());
                *live_mode = AudioOutputMode::WasapiExclusive;
                *downgrade_note = None;
                *exclusive_session = Some(session);
                *shared_out = None;
                return;
            }
            Err(error) => {
                *live_mode = AudioOutputMode::Shared;
                *downgrade_note = Some(error);
            }
        }
    } else {
        *live_mode = AudioOutputMode::Shared;
        *downgrade_note = None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        *live_mode = AudioOutputMode::Shared;
        *downgrade_note = if wanted_mode == AudioOutputMode::WasapiExclusive {
            Some("WASAPI exclusive mode is only available on Windows".to_string())
        } else {
            None
        };
    }

    restore_current_playback(
        shared_out,
        sink_slot,
        active_file_path,
        audible,
        live_progress,
        equalizer_rig,
        effect_rig,
        master_volume,
        balance_gain,
        loudness_slot,
        remote_feed,
        temp_file_feed,
    );
}

// 只重建共享输出链（无独占分支），供超时自救等场景复用
#[allow(clippy::too_many_arguments)]
pub(super) fn reopen_shared_pipeline(
    chosen_device: &Option<String>,
    shared_out: &mut Option<SharedOutputBackend>,
    audio_host: &cpal::Host,
    sink_slot: &mut Option<Sink>,
    live_device_label: &mut Option<String>,
    active_file_path: &str,
    audible: bool,
    live_progress: &Arc<SharedProgress>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    *shared_out = SharedOutputBackend::open(audio_host, chosen_device.as_deref()).ok();
    *live_device_label = shared_out
        .as_ref()
        .map(|backend| backend.active_device_name().to_string());
    restore_current_playback(
        shared_out,
        sink_slot,
        active_file_path,
        audible,
        live_progress,
        equalizer_rig,
        effect_rig,
        master_volume,
        balance_gain,
        loudness_slot,
        remote_feed,
        temp_file_feed,
    );
}

// 独占会话结束后做收尾：正常结束直接清场，异常断开则回落共享并广播
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
pub(super) fn drain_finished_exclusive(
    exclusive_session: &mut Option<WasapiExclusivePlayback>,
    chosen_device: &Option<String>,
    shared_out: &mut Option<SharedOutputBackend>,
    audio_host: &cpal::Host,
    sink_slot: &mut Option<Sink>,
    live_device_label: &mut Option<String>,
    wanted_mode: &mut AudioOutputMode,
    live_mode: &mut AudioOutputMode,
    downgrade_note: &mut Option<String>,
    active_file_path: &str,
    audible: bool,
    live_progress: &Arc<SharedProgress>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
    app: &AppHandle,
    status_slot: &Arc<Mutex<AudioOutputStatus>>,
    prior_system_default: &mut Option<String>,
) -> bool {
    let Some(outcome) = exclusive_session
        .as_ref()
        .and_then(|session| session.try_finished())
    else {
        return false;
    };

    teardown_exclusive_session(exclusive_session);

    if let Err(error) = outcome {
        *live_mode = AudioOutputMode::Shared;
        *downgrade_note = Some(format!(
            "WASAPI 独占模式已断开，已自动切回共享模式：{error}"
        ));

        reopen_shared_pipeline(
            chosen_device,
            shared_out,
            audio_host,
            sink_slot,
            live_device_label,
            active_file_path,
            audible,
            live_progress,
            equalizer_rig,
            effect_rig,
            master_volume,
            balance_gain,
            loudness_slot,
            remote_feed,
            temp_file_feed,
        );
        if chosen_device.is_none() {
            *prior_system_default = default_output_device_name(audio_host);
        }

        broadcast_output_state(
            app,
            status_slot,
            chosen_device,
            live_device_label,
            *wanted_mode,
            *live_mode,
            downgrade_note,
        );
    }

    true
}

// 把系统媒体键（SMTC/MPRIS）接到前端约定的事件名上
fn wire_media_buttons(hub: &mut MediaControls, app: &AppHandle) {
    let event_target = app.clone();
    let _ = hub.attach(move |button| {
        let plain_action: Option<&str> = match button {
            MediaControlEvent::Play => Some("player:play"),
            MediaControlEvent::Pause => Some("player:pause"),
            MediaControlEvent::Next => Some("player:next"),
            MediaControlEvent::Previous => Some("player:prev"),
            MediaControlEvent::Stop => Some("player:stop"),
            MediaControlEvent::SetPosition(at) => {
                let _ = event_target.emit("player:seek-to", at.0.as_secs_f64());
                None
            }
            _ => None,
        };
        if let Some(event_name) = plain_action {
            let _ = event_target.emit(event_name, ());
        }
    });
}

// 把初始化好的媒体控制实例挂进全局槽位
fn install_controls(hub: &Arc<Mutex<Option<MediaControls>>>, mounted: MediaControls) {
    *hub.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(mounted);
}

pub(super) fn boot_media_key_hub(app: &AppHandle) -> Arc<Mutex<Option<MediaControls>>> {
    let hub: Arc<Mutex<Option<MediaControls>>> = Arc::new(Mutex::new(None));

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let platform = PlatformConfig {
            dbus_name: "xianyu_music",
            display_name: "XianYu Music",
            hwnd: None,
        };

        match MediaControls::new(platform) {
            Ok(mut mounted) => {
                wire_media_buttons(&mut mounted, app);
                install_controls(&hub, mounted);
            }
            Err(error) => eprintln!("Error initializing MediaControls: {:?}", error),
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(main_window) = app.get_webview_window("main") {
        if let Ok(window_ref) = main_window.window_handle() {
            if let RawWindowHandle::Win32(win32) = window_ref.as_raw() {
                let platform = PlatformConfig {
                    dbus_name: "xianyu_music",
                    display_name: "XianYu Music",
                    hwnd: Some(win32.hwnd.get() as *mut std::ffi::c_void),
                };

                match MediaControls::new(platform) {
                    Ok(mut mounted) => {
                        wire_media_buttons(&mut mounted, app);
                        install_controls(&hub, mounted);
                    }
                    Err(error) => eprintln!("Error initializing MediaControls: {:?}", error),
                }
            }
        }
    }

    hub
}

use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::loudness::VolumeNormalizerHandle;
use crate::player::output::shared::{restore_current_playback, SharedOutputBackend};
#[cfg(target_os = "windows")]
use crate::player::output::wasapi_exclusive::{ExclusivePlayRequest, WasapiExclusivePlayback};
use crate::player::output::OutputBackend;
use crate::player::types::{AudioOutputMode, AudioOutputStatus, SharedProgress};
use crate::remote::cache::RemoteStreamSource;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rodio::Sink;
use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};
use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
