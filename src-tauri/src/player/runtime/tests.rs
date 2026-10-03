    use std::io::Write as _;
    use std::net::TcpListener;
    use crate::player::output_runtime::should_restore_for_default_device_change;
    use crate::player::remote_reader::RemoteRangeReader;
    use crate::player::source_pipeline::handle_play;
    use crate::player::types::{AudioSource, BufferedMonitor, SharedProgress, SharedVisualizer};
    use crate::remote::cache::RemoteStreamSource;
    use core::time::Duration;
    use rodio::{Decoder, Source};
    use std::io::{BufReader, Read, Seek, SeekFrom};
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::Arc;

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

    fn test_progress_at(seconds: f64) -> Arc<SharedProgress> { // test_progress_at
        let sample_rate = 44_100_u32; // 实现
        let channels = 2_u32; // 实现
        let samples = (seconds * sample_rate as f64 * channels as f64).round() as u64; // 实现

        Arc::new(SharedProgress { // 实现
            samples_played: Arc::new(AtomicU64::new(samples)), // 实现
            sample_rate: Arc::new(AtomicU32::new(sample_rate)), // 实现
            channels: Arc::new(AtomicU32::new(channels)), // 实现
            visualizer: Arc::new(SharedVisualizer::new()), // 实现
            start_failed: Arc::new(AtomicBool::new(false)),
            start_failed_reason: Arc::new(std::sync::Mutex::new(None)),
            buffered: Arc::new(BufferedMonitor::new()),
            total_duration_secs: Arc::new(AtomicU64::new(0u64)),
            is_playing: Arc::new(AtomicBool::new(false)),
        })
    }

    #[test]
    fn handle_play_resets_progress_even_when_new_source_cannot_open() { // handle_play_resets_progress_even_when_new_source_cannot_open
        let progress = test_progress_at(206.0); // 实现
        let mut current_sink = None; // 实现
        let mut current_path = String::new(); // 实现
        let mut is_playing_flag = false; // 实现
        let mut current_normalizer_handle = None; // 实现

        let eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new( // 实现
            crate::player::equalizer::EqualizerSettings::default(), // 实现
        ));
        let se_handle = Arc::new(crate::player::sound_effect::SoundEffectHandle::new( // 默认音效句柄
            crate::player::sound_effect::SoundEffectSettings::default(), // 默认参数
        )); // 构造完成
        let user_volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0_f32.to_bits())); // 实现

        handle_play( // 实现
            AudioSource::LocalFile("Z:\\missing\\song.flac".to_string()), // 实现
            &None,
            &mut current_sink, // 实现
            &mut current_path, // 实现
            &mut is_playing_flag, // 实现
            &progress,
            None,
            1.0,
            &mut current_normalizer_handle, // 实现
            eq_handle,
            se_handle, // 挂载音效句柄
            user_volume, // 实现
        );

        assert_eq!(progress.samples_played.load(Ordering::Relaxed), 0); // 实现
    }

    #[test]
    fn default_device_monitor_ignores_active_output_display_name() { // default_device_monitor_ignores_active_output_display_name
        let selected_device_name = None; // 实现
        let last_default_device_name = Some("CPAL default device".to_string()); // 实现
        let next_default_device_name = Some("CPAL default device".to_string()); // 实现
        let active_device_name = Some("WASAPI friendly device".to_string()); // 实现

        assert!(!should_restore_for_default_device_change( // 实现
            &selected_device_name, // 实现
            &last_default_device_name, // 实现
            &next_default_device_name, // 实现
            &active_device_name, // 实现
        ));
    }

    #[test]
    fn default_device_monitor_ignores_transient_enumeration_failure() {
        let selected_device_name = None; // 实现
        let last_default_device_name = Some("扬声器".to_string());
        let next_default_device_name: Option<String> = None;
        let active_device_name = Some("扬声器".to_string());

        assert!(!should_restore_for_default_device_change( // 实现
            &selected_device_name, // 实现
            &last_default_device_name, // 实现
            &next_default_device_name, // 实现
            &active_device_name, // 实现
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
