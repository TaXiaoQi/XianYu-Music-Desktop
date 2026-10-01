use super::remote_reader::RemoteRangeReader;
fn feed_decoder_chain<R>(
    reader: R,
    backend: &Option<SharedOutputBackend>,
    sink_slot: &mut Option<Sink>,
    live_progress: &Arc<SharedProgress>,
    resume_from: Option<Duration>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    origin_note: Option<String>,
) where
    R: Read + Seek + Send + Sync + 'static,
{
    let Some(backend) = backend else {
        return;
    };
    *sink_slot = backend.create_sink().ok();

    let buffered_reader = BufReader::with_capacity(512 * 1024, reader);
    let decoded = Decoder::new(buffered_reader);
    if let Err(e) = &decoded {
        if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
            *reason = Some(match origin_note {
                Some(ctx) => format!("解码器初始化失败: {e}（{ctx}）"),
                None => format!("解码器初始化失败: {e}"),
            });
        }
        live_progress.start_failed.store(true, Ordering::Relaxed);
    }
    if let Ok(source) = decoded {
        let rate = source.sample_rate();
        let channels = source.channels();
        // 超过双声道的流（伪 6ch 全景声之类）rodio 不会自动下混，直接播会炸音，这里在样本层折成立体声
        let downmixed_lanes: u32 = if channels > 2 { 2 } else { channels as u32 };
        live_progress.sample_rate.store(rate, Ordering::Relaxed);
        live_progress
            .channels
            .store(downmixed_lanes, Ordering::Relaxed);

        // rodio 对某些容器会给出 u32::MAX 纳秒哨兵当作"未知时长"，这里识别为 0
        let duration_secs = source
            .total_duration()
            .map(|d| {
                if d.as_nanos() == u32::MAX as u128 {
                    0.0
                } else {
                    d.as_secs_f64()
                }
            })
            .unwrap_or(0.0);
        live_progress
            .total_duration_secs
            .store(duration_secs.to_bits(), Ordering::Relaxed);

        let offset = resume_from.unwrap_or(Duration::ZERO);
        let pre_skip = (offset.as_secs_f64() * rate as f64 * downmixed_lanes as f64).round() as u64;
        live_progress
            .samples_played
            .store(pre_skip, Ordering::Relaxed);
        if resume_from.is_none() {
            live_progress.visualizer.reset();
        }

        let f32_source = source.convert_samples::<f32>();
        let unified: Box<dyn Source<Item = f32> + Send> = if channels > 2 {
            crate::player::dolby_bridge::log_bridge(&format!(
                "多声道流下混: {channels}ch → 2ch @ {rate}Hz"
            ));
            Box::new(crate::player::channel_downmix::DownmixSource::new(
                f32_source, channels,
            ))
        } else {
            Box::new(f32_source)
        };

        let offset_applied = unified.skip_duration(offset);

        let watched = crate::player::buffered_source::BufferedSource::new_tracked(
            offset_applied,
            Some(live_progress.buffered.clone()),
        );

        let (leveled, handle) = VolumeNormalizer::new(watched, balance_gain, 100);
        *loudness_slot = Some(handle);

        let shaped = crate::player::equalizer::Equalizer::new(leveled, equalizer_rig);

        let flavored = crate::player::sound_effect::SoundEffectSource::new(shaped, effect_rig);

        let extended = crate::player::plugin_host::wrap(flavored);

        let gain_gated = crate::player::equalizer::UserVolumeSource::new(extended, master_volume);

        let safeguarded = crate::player::equalizer::ClipGuardSource::new(gain_gated);

        let metered = TimedSource::new(
            safeguarded,
            live_progress.samples_played.clone(),
            live_progress.visualizer.clone(),
        );

        if let Some(sink) = sink_slot {
            sink.append(metered);
            sink.set_volume(1.0);
            sink.play();
        }
    }
}

// 本地轨道的两种打开形态：普通明文 / QMC 加密需边读边解
enum DiskTrackHandle {
    Raw(File),
    Scrambled(crate::player::qmc2::QmcDecryptReader<File>),
}

impl Read for DiskTrackHandle {
    fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
        match self {
            DiskTrackHandle::Raw(file) => file.read(target),
            DiskTrackHandle::Scrambled(reader) => reader.read(target),
        }
    }
}

impl Seek for DiskTrackHandle {
    fn seek(&mut self, anchor: SeekFrom) -> std::io::Result<u64> {
        match self {
            DiskTrackHandle::Raw(file) => file.seek(anchor),
            DiskTrackHandle::Scrambled(reader) => reader.seek(anchor),
        }
    }
}

fn open_disk_track(track_path: &Path) -> Option<DiskTrackHandle> {
    let opened = File::open(track_path).ok()?;
    match crate::player::qmc2::detect_qmc_crypto(track_path) {
        Some(crypto) => Some(DiskTrackHandle::Scrambled(
            crate::player::qmc2::QmcDecryptReader::new(opened, crypto),
        )),
        None => Some(DiskTrackHandle::Raw(opened)),
    }
}

/// 本地文件的杜比透传桥：QMC 加密轨道先落成明文再送探，普通明文直接送探。
/// 探测命中 AC-4/EC-3 时交 ffmpeg 转 WAV；未命中返回 None 走常规解码路径。
pub(crate) fn bridge_local_file(
    path: &Path,
) -> Option<(
    Box<dyn crate::player::stream_cache::ReadSeek + Send + Sync + 'static>,
    crate::player::dolby_bridge::DolbyCodec,
)> {
    use crate::player::dolby_bridge::{bridge_if_dolby, materialize_plain_file, PlainTransform};
    let track_label = path.to_str()?;
    match crate::player::qmc2::detect_qmc_crypto(path) {
        Some(crypto) => {
            let plain_copy =
                materialize_plain_file(track_label, &PlainTransform::QmcCrypto(&crypto)).ok()?;
            let mut probe_handle = std::fs::File::open(&plain_copy).ok()?;
            bridge_if_dolby(
                &mut probe_handle,
                Some(plain_copy.to_str()?),
                track_label,
                &PlainTransform::None,
            )
        }
        None => {
            let mut probe_handle = std::fs::File::open(path).ok()?;
            bridge_if_dolby(
                &mut probe_handle,
                Some(track_label),
                track_label,
                &PlainTransform::None,
            )
        }
    }
}

/// 流式临时文件的杜比透传桥：reader 已携带解密后的明文流，直接送探；
/// 命中后按 state 的加密上下文转成明文交给 ffmpeg。
pub(crate) fn bridge_streaming_state(
    state: &crate::player::stream_cache::StreamingTempFileState,
    reader: &mut dyn crate::player::stream_cache::ReadSeek,
) -> Option<(
    Box<dyn crate::player::stream_cache::ReadSeek + Send + Sync + 'static>,
    crate::player::dolby_bridge::DolbyCodec,
)> {
    use crate::player::dolby_bridge::{bridge_if_dolby, PlainTransform};
    let decryption_key = state.ekey();
    let cenc_gate: Option<(String, crate::player::cenc::CencMetadata)> = if state
        .cenc_streaming
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        let metadata = state
            .cenc_metadata
            .lock()
            .ok()
            .and_then(|meta| meta.clone());
        match (state.cek(), metadata) {
            (Some(key), Some(meta)) => Some((key, meta)),
            _ => None,
        }
    } else {
        None
    };
    // transform 的生命周期覆盖 bridge 调用；metadata 仅作门控（元数据解析完成前不进桥）
    if let Some((key, _)) = &cenc_gate {
        return bridge_if_dolby(reader, None, &state.path, &PlainTransform::Cenc(key));
    }
    if let Some(key) = &decryption_key {
        return bridge_if_dolby(reader, None, &state.path, &PlainTransform::QmcEkey(key));
    }
    bridge_if_dolby(
        reader,
        Some(&state.path),
        &state.path,
        &PlainTransform::None,
    )
}

// 起播：记录路径、清簿记，再按来源（本地/WebDAV/流式缓存）接上解码链
#[allow(clippy::too_many_arguments)]
pub(super) fn handle_play(
    music_source: AudioSource,
    backend: &Option<SharedOutputBackend>,
    sink_slot: &mut Option<Sink>,
    active_file_path: &mut String,
    audible: &mut bool,
    live_progress: &Arc<SharedProgress>,
    begin_at_ms: Option<u64>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
) {
    *active_file_path = music_source.display_path();
    *audible = true;
    wipe_progress_bookkeeping(live_progress);

    if backend.is_none() {
        if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
            *reason = Some("未检测到可用的音频输出设备，请检查扬声器/耳机是否已连接".to_string());
        }
        live_progress.start_failed.store(true, Ordering::Relaxed);
        return;
    }

    if let Some(sink) = sink_slot {
        sink.stop();
    }

    let resume_from = begin_at_ms.map(Duration::from_millis);

    crate::player::dolby_bridge::log_bridge(&format!(
        "handle_play: source={} path={}",
        match &music_source {
            AudioSource::LocalFile(_) => "LocalFile",
            AudioSource::RemoteWebDav(_) => "RemoteWebDav",
            AudioSource::StreamingTempFile(_) => "StreamingTempFile",
        },
        music_source.display_path()
    ));

    match music_source {
        AudioSource::LocalFile(track) => {
            if let Some((wav_reader, codec)) = bridge_local_file(Path::new(&track)) {
                feed_decoder_chain(
                    wav_reader,
                    backend,
                    sink_slot,
                    live_progress,
                    resume_from,
                    balance_gain,
                    loudness_slot,
                    equalizer_rig,
                    effect_rig,
                    master_volume,
                    Some(format!("dolby {} → wav", codec.as_str())),
                );
            } else if let Some(track_handle) = open_disk_track(Path::new(&track)) {
                feed_decoder_chain(
                    track_handle,
                    backend,
                    sink_slot,
                    live_progress,
                    resume_from,
                    balance_gain,
                    loudness_slot,
                    equalizer_rig,
                    effect_rig,
                    master_volume,
                    None,
                );
            } else if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                *reason = Some("本地音频文件打开失败".to_string());
                live_progress.start_failed.store(true, Ordering::Relaxed);
            }
        }
        AudioSource::RemoteWebDav(web_stream) => match RemoteRangeReader::new(web_stream) {
            Ok(track_handle) => feed_decoder_chain(
                track_handle,
                backend,
                sink_slot,
                live_progress,
                resume_from,
                balance_gain,
                loudness_slot,
                equalizer_rig,
                effect_rig,
                master_volume,
                None,
            ),
            Err(err) => {
                if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                    *reason = Some(format!("远程流读取器构建失败: {err}"));
                }
                live_progress.start_failed.store(true, Ordering::Relaxed);
            }
        },
        AudioSource::StreamingTempFile(cache_state) => {
            match cache_state.new_reader_with_decryption() {
                Ok(mut track_handle) => {
                    let size = cache_state.downloaded_bytes();
                    let status = if cache_state.is_download_finished() {
                        if cache_state.download_complete.load(Ordering::Relaxed) {
                            "下载完成".to_string()
                        } else {
                            format!(
                                "下载失败: {}",
                                cache_state
                                    .download_error()
                                    .unwrap_or_else(|| "未知原因".to_string())
                            )
                        }
                    } else {
                        "下载中".to_string()
                    };
                    if let Some((wav_reader, codec)) =
                        bridge_streaming_state(&cache_state, &mut *track_handle)
                    {
                        feed_decoder_chain(
                            wav_reader,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            Some(format!(
                                "dolby {} → wav，已下载 {size} bytes",
                                codec.as_str()
                            )),
                        );
                    } else {
                        feed_decoder_chain(
                            track_handle,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            Some(format!("已下载 {size} bytes，{status}")),
                        );
                    }
                }
                Err(err) => {
                    if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                        *reason = Some(format!("流式临时文件读取器构建失败: {err}"));
                    }
                    live_progress.start_failed.store(true, Ordering::Relaxed);
                }
            }
        }
    }
}

// seek 失败后的重建路径：按当前来源重新打开并从目标位置续播
#[allow(clippy::too_many_arguments)]
pub(super) fn reposition_playhead(
    requested_time: f64,
    should_resume: bool,
    pending_id: u64,
    backend: &Option<SharedOutputBackend>,
    sink_slot: &mut Option<Sink>,
    active_file_path: &str,
    audible: &mut bool,
    live_progress: &Arc<SharedProgress>,
    app: &AppHandle,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    let landing = requested_time.max(0.0);
    let jump_target = Duration::from_secs_f64(landing);
    *audible = should_resume;
    live_progress.visualizer.reset();

    if let Some(sink) = sink_slot {
        match sink.try_seek(jump_target) {
            Ok(()) => {
                let at_target = samples_for_position(landing, live_progress);
                live_progress
                    .samples_played
                    .store(at_target, Ordering::Relaxed);

                if should_resume {
                    sink.play();
                } else {
                    sink.pause();
                }
            }
            Err(_) => {
                // rodio 拒绝原地 seek：整条解码链推倒重建，从目标位置起播
                sink.stop();

                let resume_from = Some(jump_target);
                if let Some(cache_state) = temp_file_feed {
                    match cache_state.new_reader_with_decryption() {
                        Ok(mut track_handle) => {
                            if let Some((wav_reader, codec)) =
                                bridge_streaming_state(cache_state, &mut *track_handle)
                            {
                                feed_decoder_chain(
                                    wav_reader,
                                    backend,
                                    sink_slot,
                                    live_progress,
                                    resume_from,
                                    balance_gain,
                                    loudness_slot,
                                    equalizer_rig,
                                    effect_rig,
                                    master_volume,
                                    Some(format!("dolby {} → wav（seek 重建）", codec.as_str())),
                                );
                            } else {
                                feed_decoder_chain(
                                    track_handle,
                                    backend,
                                    sink_slot,
                                    live_progress,
                                    resume_from,
                                    balance_gain,
                                    loudness_slot,
                                    equalizer_rig,
                                    effect_rig,
                                    master_volume,
                                    None,
                                );
                            }
                        }
                        Err(_) => {}
                    }
                } else if let Some(web_stream) = remote_feed.cloned() {
                    match RemoteRangeReader::new(web_stream) {
                        Ok(track_handle) => feed_decoder_chain(
                            track_handle,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            None,
                        ),
                        Err(_) => {}
                    }
                } else if !active_file_path.is_empty() {
                    if let Some((wav_reader, codec)) =
                        bridge_local_file(Path::new(active_file_path))
                    {
                        feed_decoder_chain(
                            wav_reader,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            Some(format!("dolby {} → wav（seek 重建）", codec.as_str())),
                        );
                    } else if let Some(track_handle) = open_disk_track(Path::new(active_file_path))
                    {
                        feed_decoder_chain(
                            track_handle,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            None,
                        );
                    }
                }

                if !should_resume {
                    if let Some(fresh_sink) = sink_slot {
                        fresh_sink.pause();
                    }
                }
            }
        }
    } else {
        // 没有 sink 可 seek 时仅校准计数，保证进度条不回跳
        let at_target = samples_for_position(landing, live_progress);
        live_progress
            .samples_played
            .store(at_target, Ordering::Relaxed);
    }

    let _ = app.emit(
        "seek_completed",
        SeekCompletedPayload {
            request_id: pending_id,
            time: landing,
        },
    );
}

// 每个轮询节拍巡检一次网络缓冲健康度：断流压停、来数放行、广播缓冲状态
use super::runtime::{samples_for_position, wipe_progress_bookkeeping};
use crate::player::loudness::{VolumeNormalizer, VolumeNormalizerHandle};
use crate::player::output::shared::SharedOutputBackend;
use crate::player::output::OutputBackend;
use crate::player::types::{AudioSource, SeekCompletedPayload, SharedProgress, TimedSource};
use crate::remote::cache::RemoteStreamSource;
use rodio::{Decoder, Sink, Source};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
