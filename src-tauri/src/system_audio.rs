//! 系统音频捕获模块（WASAPI Loopback）
//!
//! 在 Windows 上使用 WASAPI 的 loopback 模式直接捕获系统音频输出，
//! 无需用户交互（不需要选择屏幕或勾选"分享音频"），实现一键无感识别。
//!
//! 捕获流程：
//! 1. 获取默认音频渲染设备（扬声器/耳机）
//! 2. 以 loopback 模式打开捕获流（设备=Render + 方向=Capture → 自动设 LOOPBACK 标志）
//! 3. 读取设备混音格式的音频数据（通常 48000Hz / 2ch / 32-bit float）
//! 4. 合并多声道为单声道
//! 5. 线性插值降采样为 8000Hz
//! 6. 转换为 16-bit PCM (s16le)，直接用于酷狗指纹识别接口

use std::sync::atomic::{AtomicBool, Ordering};

// ==================== Windows 实现（WASAPI Loopback） ====================

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use std::time::{Duration, Instant};
    use wasapi::*;

    /// 目标 PCM 格式参数（与酷狗 audio_match 接口要求一致）
    const TARGET_SAMPLE_RATE: usize = 8000;

    /// 捕获系统音频（默认 10 秒）并转换为 8000Hz / 16bit / 单声道 PCM
    ///
    /// 返回 s16le 格式的 PCM 字节流，可直接发送到酷狗指纹识别接口。
    /// `cancel_flag` 为取消标志，置为 true 时捕获循环会提前退出并返回错误。
    pub fn capture_system_audio_pcm(
        duration_secs: u64,
        cancel_flag: &AtomicBool,
    ) -> Result<Vec<u8>, String> {
        // 1. 初始化 COM（MTA 模式）
        // 忽略返回值：线程可能已初始化（S_FALSE）或已用不同模式（RPC_E_CHANGED_MODE）
        let _ = initialize_mta();

        // 2. 获取默认渲染设备（扬声器/耳机）
        let enumerator =
            DeviceEnumerator::new().map_err(|e| format!("创建设备枚举器失败: {}", e))?;
        let device = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| format!("获取默认音频输出设备失败: {}", e))?;

        // 3. 获取 AudioClient
        let mut audio_client = device
            .get_iaudioclient()
            .map_err(|e| format!("获取 AudioClient 失败: {}", e))?;

        // 4. 获取设备混音格式（系统当前正在使用的音频格式）
        let mix_format = audio_client
            .get_mixformat()
            .map_err(|e| format!("获取混音格式失败: {}", e))?;

        let source_rate = mix_format.get_samplespersec() as usize;
        let channels = mix_format.get_nchannels() as usize;
        let bits_per_sample = mix_format.get_bitspersample() as usize;
        let bytes_per_frame = mix_format.get_blockalign() as usize;
        let sample_type = mix_format
            .get_subformat()
            .map_err(|e| format!("获取采样类型失败: {}", e))?;

        if source_rate == 0 || channels == 0 || bytes_per_frame == 0 {
            return Err(format!(
                "无效的音频格式: {}Hz / {}ch / {}bits",
                source_rate, channels, bits_per_sample
            ));
        }

        // 5. 初始化 loopback 捕获
        // 关键：设备是 Direction::Render，方向传 Direction::Capture，
        // wasapi crate 会自动设置 AUDCLNT_STREAMFLAGS_LOOPBACK 标志
        audio_client
            .initialize_client(
                &mix_format,
                &Direction::Capture,
                &StreamMode::PollingShared {
                    autoconvert: false,
                    buffer_duration_hns: 0,
                },
            )
            .map_err(|e| format!("初始化 loopback 捕获失败: {}", e))?;

        // 6. 获取 CaptureClient
        let capture_client = audio_client
            .get_audiocaptureclient()
            .map_err(|e| format!("获取 CaptureClient 失败: {}", e))?;

        // 7. 启动音频流
        audio_client
            .start_stream()
            .map_err(|e| format!("启动音频流失败: {}", e))?;

        // 8. 循环读取数据，收集为 float32 单声道样本
        let mut all_samples: Vec<f32> = Vec::new();
        let start = Instant::now();
        let duration = Duration::from_secs(duration_secs);

        while start.elapsed() < duration {
            // 检查取消标志
            if cancel_flag.load(Ordering::SeqCst) {
                let _ = audio_client.stop_stream();
                return Err("识别已取消".to_string());
            }

            // 获取下一包的帧数
            let packet_frames = match capture_client.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => frames as usize,
                _ => {
                    std::thread::sleep(Duration::from_millis(1));
                    continue;
                }
            };

            // 分配缓冲区并读取
            let buffer_size = packet_frames * bytes_per_frame;
            let mut buffer = vec![0u8; buffer_size];
            match capture_client.read_from_device(&mut buffer) {
                Ok((read_frames, info)) => {
                    // 静音包跳过（系统未在播放音频）
                    if read_frames == 0 || info.flags.silent {
                        continue;
                    }
                    let data_len = read_frames as usize * bytes_per_frame;
                    let raw = &buffer[..data_len];
                    decode_samples_to_mono(
                        raw,
                        channels,
                        bits_per_sample,
                        &sample_type,
                        &mut all_samples,
                    );
                }
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        }

        // 9. 停止音频流
        let _ = audio_client.stop_stream();

        // 10. 线性插值降采样为 8000Hz / 16bit / 单声道 PCM
        let pcm = resample_to_pcm(&all_samples, source_rate, TARGET_SAMPLE_RATE);

        Ok(pcm)
    }

    /// 将原始音频字节解码为 float32 单声道样本并追加到输出
    fn decode_samples_to_mono(
        raw: &[u8],
        channels: usize,
        bits_per_sample: usize,
        sample_type: &SampleType,
        out: &mut Vec<f32>,
    ) {
        match sample_type {
            SampleType::Float => {
                // 32-bit IEEE float（Windows 混音格式最常见）
                if bits_per_sample == 32 && raw.len() >= 4 {
                    let samples = unsafe {
                        std::slice::from_raw_parts(raw.as_ptr() as *const f32, raw.len() / 4)
                    };
                    for chunk in samples.chunks(channels) {
                        if !chunk.is_empty() {
                            let mono: f32 = chunk.iter().sum::<f32>() / chunk.len() as f32;
                            out.push(mono);
                        }
                    }
                }
            }
            SampleType::Int => match bits_per_sample {
                16 => {
                    if raw.len() >= 2 {
                        let samples = unsafe {
                            std::slice::from_raw_parts(raw.as_ptr() as *const i16, raw.len() / 2)
                        };
                        for chunk in samples.chunks(channels) {
                            if !chunk.is_empty() {
                                let mono: f32 =
                                    chunk.iter().map(|&s| s as f32 / 32768.0).sum::<f32>()
                                        / chunk.len() as f32;
                                out.push(mono);
                            }
                        }
                    }
                }
                32 => {
                    if raw.len() >= 4 {
                        let samples = unsafe {
                            std::slice::from_raw_parts(raw.as_ptr() as *const i32, raw.len() / 4)
                        };
                        for chunk in samples.chunks(channels) {
                            if !chunk.is_empty() {
                                let mono: f32 =
                                    chunk.iter().map(|&s| s as f32 / 2147483648.0).sum::<f32>()
                                        / chunk.len() as f32;
                                out.push(mono);
                            }
                        }
                    }
                }
                24 => {
                    // 24-bit packed PCM（3 字节 per sample）
                    let bytes_per_sample = 3;
                    let n_samples = raw.len() / bytes_per_sample;
                    let mut mono_acc: f32 = 0.0;
                    let mut ch_count: usize = 0;
                    for i in 0..n_samples {
                        let offset = i * bytes_per_sample;
                        // 24-bit signed little-endian
                        let b0 = raw[offset] as i32;
                        let b1 = raw[offset + 1] as i32;
                        let b2 = raw[offset + 2] as i8 as i32;
                        let val = (b0 | (b1 << 8) | (b2 << 16)) as f32 / 8388608.0;
                        mono_acc += val;
                        ch_count += 1;
                        if ch_count >= channels {
                            out.push(mono_acc / ch_count as f32);
                            mono_acc = 0.0;
                            ch_count = 0;
                        }
                    }
                }
                _ => {}
            },
        }
    }

    /// 线性插值降采样 float32 单声道样本为 8000Hz / 16bit PCM (s16le)
    fn resample_to_pcm(samples: &[f32], source_rate: usize, target_rate: usize) -> Vec<u8> {
        if samples.is_empty() || source_rate == 0 || target_rate == 0 {
            return Vec::new();
        }

        let ratio = source_rate as f64 / target_rate as f64;
        let target_len = (samples.len() as f64 / ratio).floor() as usize;
        let mut pcm: Vec<u8> = Vec::with_capacity(target_len * 2);

        for i in 0..target_len {
            let src_pos = i as f64 * ratio;
            let src_idx = src_pos as usize;
            let frac = (src_pos - src_idx as f64) as f32;
            let sample = if src_idx + 1 < samples.len() {
                samples[src_idx] * (1.0 - frac) + samples[src_idx + 1] * frac
            } else if src_idx < samples.len() {
                samples[src_idx]
            } else {
                0.0
            };
            let clamped = sample.max(-1.0).min(1.0);
            let int16 = if clamped < 0.0 {
                (clamped * 32768.0) as i16
            } else {
                (clamped * 32767.0) as i16
            };
            pcm.extend_from_slice(&int16.to_le_bytes());
        }

        pcm
    }
}

// ==================== 公共 API（跨平台分发） ====================

/// 捕获系统音频并转换为 8000Hz / 16bit / 单声道 PCM
///
/// Windows 上使用 WASAPI Loopback 捕获系统音频输出；
/// 其他平台返回不支持错误（后续可扩展 macOS CoreAudio / Linux PulseAudio）。
///
/// `cancel_flag` 为取消标志，置为 true 时捕获循环会提前退出并返回错误。
pub fn capture_system_audio_pcm(
    duration_secs: u64,
    cancel_flag: &AtomicBool,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::capture_system_audio_pcm(duration_secs, cancel_flag)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = duration_secs;
        let _ = cancel_flag;
        Err("当前操作系统不支持系统音频捕获（仅支持 Windows WASAPI Loopback）".to_string())
    }
}
