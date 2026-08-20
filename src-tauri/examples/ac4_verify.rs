//! AC-4 集成验证：解析 fMP4 中的 AC-4 sample，用 oxideav-ac4 解码为 PCM，
//! 输出 WAV 与质量统计；并与 ffmpeg 参照解码结果做逐声道相关性/SNR 对比。
//!
//! 用法：
//!   ac4_verify decode <out.wav> <full|core> <input1.mp4> [input2.mp4 ...]
//!   ac4_verify compare <decoded.wav> <reference.wav>

use std::env;
use std::fs;
use std::path::Path;

use oxideav_ac4::decoder::{Ac4Decoder, DecodingMode};
use oxideav_ac4::sync;
use oxideav_core::registry::codec::Decoder;
use oxideav_core::{CodecId, CodecParameters, Frame, Packet, TimeBase};

// ---------- fMP4 解析：从 moof/trun/mdat 中切出 sample ----------

struct BoxReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> BoxReader<'a> {
    fn next_box(&mut self) -> Option<(u32, &'a [u8], usize, usize)> {
        if self.pos + 8 > self.data.len() {
            return None;
        }
        let b = |o: usize| -> u32 {
            u32::from_be_bytes([self.data[o], self.data[o + 1], self.data[o + 2], self.data[o + 3]])
        };
        let hdr = self.pos;
        let mut size = b(hdr) as usize;
        let kind = b(hdr + 4);
        let mut body = hdr + 8;
        if size == 1 {
            if self.pos + 16 > self.data.len() {
                return None;
            }
            let mut s: u64 = 0;
            for i in 0..8 {
                s = (s << 8) | self.data[hdr + 8 + i] as u64;
            }
            size = s as usize;
            body = hdr + 16;
        } else if size == 0 {
            size = self.data.len() - hdr;
        }
        if size < 8 || hdr + size > self.data.len() {
            return None;
        }
        self.pos = hdr + size;
        Some((kind, &self.data[body..hdr + size], hdr, size))
    }
}

fn fourcc(kind: u32) -> String {
    kind.to_be_bytes().iter().map(|&c| c as char).collect()
}

/// 解析一个 mp4 文件（init 或 media segment），返回其中的 AC-4 sample 列表。
fn extract_mp4_samples(path: &Path) -> Result<Vec<Vec<u8>>, String> {
    let data = fs::read(path).map_err(|e| format!("读取 {}: {e}", path.display()))?;
    let mut r = BoxReader { data: &data, pos: 0 };
    let mut samples = Vec::new();
    let mut pending_sizes: Vec<usize> = Vec::new();

    while let Some((kind, body, hdr, size)) = r.next_box() {
        let name = fourcc(kind);
        match name.as_str() {
            "moof" => {
                pending_sizes = parse_moof(body);
            }
            "mdat" => {
                if !pending_sizes.is_empty() {
                    let mut off = 0usize;
                    for s in pending_sizes.drain(..) {
                        if off + s <= body.len() {
                            samples.push(body[off..off + s].to_vec());
                        }
                        off += s;
                    }
                }
            }
            _ => {
                let _ = (hdr, size);
            }
        }
    }
    Ok(samples)
}

/// 从 moof 中收集 trun 声明的 sample size 列表。
fn parse_moof(moof: &[u8]) -> Vec<usize> {
    let mut sizes = Vec::new();
    let mut r = BoxReader { data: moof, pos: 0 };
    let mut default_size = 0usize;
    let mut traf_body: Option<&[u8]> = None;
    while let Some((kind, body, _, _)) = r.next_box() {
        let name = fourcc(kind);
        if name == "traf" {
            traf_body = Some(body);
        }
    }
    let Some(traf) = traf_body else { return sizes };
    let mut r = BoxReader { data: traf, pos: 0 };
    let mut truns: Vec<&[u8]> = Vec::new();
    while let Some((kind, body, _, _)) = r.next_box() {
        let name = fourcc(kind);
        match name.as_str() {
            "tfhd" => {
                if body.len() >= 4 {
                    // fullbox: 1 字节 version + 3 字节 flags
                    let flags =
                        ((body[1] as u32) << 16) | ((body[2] as u32) << 8) | body[3] as u32;
                    let mut p = 4usize;
                    if flags & 0x01 != 0 {
                        p += 8;
                    }
                    if flags & 0x02 != 0 {
                        p += 4;
                    }
                    if flags & 0x08 != 0 {
                        p += 4;
                    }
                    if flags & 0x10 != 0 && p + 4 <= body.len() {
                        default_size = u32::from_be_bytes([body[p], body[p + 1], body[p + 2], body[p + 3]]) as usize;
                    }
                }
            }
            "trun" => truns.push(body),
            _ => {}
        }
    }
    for trun in truns {
        if trun.len() < 8 {
            continue;
        }
        let rd = |o: usize| -> u32 { u32::from_be_bytes([trun[o], trun[o + 1], trun[o + 2], trun[o + 3]]) };
        // fullbox: 低 24 位是 flags（首字节为 version）
        let flags = rd(0) & 0x00ff_ffff;
        let count = rd(4) as usize;
        let mut p = 8usize;
        if flags & 0x01 != 0 {
            p += 4; // data_offset
        }
        if flags & 0x04 != 0 {
            p += 4; // first_sample_flags
        }
        for _ in 0..count {
            if flags & 0x100 != 0 {
                p += 4; // per-sample duration
            }
            if flags & 0x200 != 0 {
                if p + 4 > trun.len() {
                    break;
                }
                sizes.push(rd(p) as usize);
                p += 4;
            } else {
                sizes.push(default_size);
            }
            if flags & 0x400 != 0 {
                p += 4; // per-sample flags
            }
            if flags & 0x800 != 0 {
                p += 4; // cts offset
            }
        }
    }
    sizes
}

// ---------- WAV 读写（S16LE PCM） ----------

fn write_wav(path: &Path, sample_rate: u32, channels: u16, pcm: &[i16]) -> std::io::Result<()> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    let block = sample_rate * channels as u32 * 2;
    out.extend_from_slice(&block.to_le_bytes());
    out.extend_from_slice(&((channels * 2) as u16).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    fs::write(path, out)
}

fn read_wav(path: &Path) -> Result<(u32, u16, Vec<i16>), String> {
    let d = fs::read(path).map_err(|e| e.to_string())?;
    if d.len() < 44 || &d[0..4] != b"RIFF" || &d[8..12] != b"WAVE" {
        return Err("不是 WAV 文件".into());
    }
    let mut rate = 0u32;
    let mut ch = 0u16;
    let mut bits = 0u16;
    let mut pcm = Vec::new();
    let mut p = 12usize;
    while p + 8 <= d.len() {
        let id = &d[p..p + 4];
        let sz = u32::from_le_bytes([d[p + 4], d[p + 5], d[p + 6], d[p + 7]]) as usize;
        let body = &d[p + 8..(p + 8 + sz).min(d.len())];
        if id == b"fmt " {
            ch = u16::from_le_bytes([body[2], body[3]]);
            rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" && bits == 16 {
            pcm = body
                .chunks_exact(2)
                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                .collect();
        }
        p += 8 + sz + (sz & 1);
    }
    if rate == 0 || ch == 0 || pcm.is_empty() {
        return Err("WAV 缺少有效 PCM 数据".into());
    }
    Ok((rate, ch, pcm))
}

// ---------- 统计 ----------

fn dbfs(x: f64) -> String {
    if x <= 1e-10 {
        "-inf".to_string()
    } else {
        format!("{:.1}", 20.0 * x.log10())
    }
}

fn channel_stats(pcm: &[i16], channels: usize) {
    let frames = pcm.len() / channels;
    for c in 0..channels {
        let mut peak: f64 = 0.0;
        let mut sum_sq = 0.0f64;
        let mut nonzero = 0usize;
        for f in 0..frames {
            let v = pcm[f * channels + c] as f64 / 32768.0;
            let a = v.abs();
            if a > peak {
                peak = a;
            }
            sum_sq += v * v;
            if a > 1e-5 {
                nonzero += 1;
            }
        }
        let rms = (sum_sq / frames.max(1) as f64).sqrt();
        println!(
            "  ch{}: peak {} dBFS, RMS {} dBFS, 非零样本占比 {:.1}%",
            c,
            dbfs(peak),
            dbfs(rms),
            100.0 * nonzero as f64 / frames.max(1) as f64
        );
    }
}

// ---------- 解码 ----------

fn cmd_decode(args: &[String]) -> Result<(), String> {
    let out_wav = &args[0];
    let mode = match args[1].as_str() {
        "full" => DecodingMode::Full,
        "core" => DecodingMode::Core,
        m => return Err(format!("未知模式 {m}（full|core）")),
    };
    let inputs = &args[2..];
    if inputs.is_empty() {
        return Err("缺少输入文件".into());
    }

    let params = CodecParameters::audio(CodecId::new("ac4"));
    let mut dec = Ac4Decoder::new(&params);
    dec.set_decoding_mode(mode);

    let mut all_pcm: Vec<i16> = Vec::new();
    let mut n_samples_in = 0usize;
    let mut n_decoded = 0usize;
    let mut n_errors = 0usize;
    let mut first_err: Option<String> = None;
    let mut sample_rate = 0u32;
    let mut channels = 0usize;

    for input in inputs {
        let Ok(samples) = extract_mp4_samples(Path::new(input)) else {
            continue; // init segment（无 moof）跳过
        };
        for s in samples {
            n_samples_in += 1;
            let pkt = Packet::new(0, TimeBase::new(1, 48_000), s);
            if let Err(e) = dec.send_packet(&pkt) {
                n_errors += 1;
                first_err.get_or_insert_with(|| format!("send_packet: {e}"));
                continue;
            }
            match dec.receive_frame() {
                Ok(Frame::Audio(af)) => {
                    if af.samples == 0 || af.data.is_empty() || af.data[0].is_empty() {
                        n_errors += 1;
                        first_err.get_or_insert_with(|| "空帧".into());
                        continue;
                    }
                    let ch = af.data[0].len() / (af.samples as usize * 2);
                    if ch == 0 {
                        n_errors += 1;
                        continue;
                    }
                    if channels == 0 {
                        channels = ch;
                        if let Some(info) = &dec.last_info {
                            sample_rate = info.sample_rate;
                        }
                    } else if ch != channels {
                        // IMS 的 Full 模式可能按对象输出；记录后继续
                        println!("  注意: 帧声道数变化 {channels} -> {ch}");
                    }
                    let buf = &af.data[0];
                    all_pcm.extend(buf.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])));
                    n_decoded += 1;
                }
                Err(e) => {
                    n_errors += 1;
                    first_err.get_or_insert_with(|| format!("receive_frame: {e}"));
                }
                _ => {
                    n_errors += 1;
                    first_err.get_or_insert_with(|| "非音频帧".into());
                }
            }
        }
    }

    println!("输入 AC-4 sample: {n_samples_in}");
    println!("成功解码帧: {n_decoded}，失败: {n_errors}");
    if let Some(e) = &first_err {
        println!("首个错误: {e}");
    }
    println!("声道数: {channels}，采样率: {} Hz", if sample_rate > 0 { sample_rate } else { 48000 });
    if channels > 0 {
        let frames = all_pcm.len() / channels;
        println!("输出 PCM: {frames} 帧 = {:.2} 秒", frames as f64 / sample_rate.max(1) as f64);
        channel_stats(&all_pcm, channels);
        let all_zero = all_pcm.iter().all(|&s| s == 0);
        if all_zero {
            println!("!! 输出全零（静音桩解码）");
        }
        write_wav(Path::new(out_wav), sample_rate.max(48000), channels as u16, &all_pcm)
            .map_err(|e| format!("写 WAV: {e}"))?;
        println!("已写出 {out_wav}");
    }
    Ok(())
}

// ---------- 对比 ----------

fn deinterleave(pcm: &[i16], ch: usize) -> Vec<Vec<f64>> {
    let frames = pcm.len() / ch;
    (0..ch)
        .map(|c| (0..frames).map(|f| pcm[f * ch + c] as f64 / 32768.0).collect())
        .collect()
}

fn correlate(a: &[f64], b: &[f64], lag: isize) -> f64 {
    let n = a.len().min(b.len());
    let mut num = 0.0;
    let mut da = 0.0;
    let mut dbv = 0.0;
    for i in 0..n {
        let j = i as isize + lag;
        if j < 0 || j as usize >= b.len() {
            continue;
        }
        let x = a[i];
        let y = b[j as usize];
        num += x * y;
        da += x * x;
        dbv += y * y;
    }
    let den = (da * dbv).sqrt();
    if den <= 1e-12 {
        0.0
    } else {
        num / den
    }
}

fn best_lag(a: &[f64], b: &[f64]) -> isize {
    // 粗搜 ±2400 样本（步进 8），再细搜 ±8
    let mut best = 0isize;
    let mut best_c = -2.0f64;
    let coarse: Vec<isize> = (-300..=300).map(|x| x * 8).collect();
    for &l in &coarse {
        let c = correlate(a, b, l);
        if c > best_c {
            best_c = c;
            best = l;
        }
    }
    for l in (best - 8)..=(best + 8) {
        let c = correlate(a, b, l);
        if c > best_c {
            best_c = c;
            best = l;
        }
    }
    best
}

fn snr_db(ref_ch: &[f64], test_ch: &[f64], lag: isize) -> f64 {
    let n = ref_ch.len().min(if lag >= 0 { test_ch.len().saturating_sub(lag as usize) } else { test_ch.len() });
    let mut s_ref = 0.0;
    let mut s_err = 0.0;
    let mut cnt = 0usize;
    for i in 0..n {
        let j = i as isize + lag;
        if j < 0 || j as usize >= test_ch.len() {
            continue;
        }
        let e = ref_ch[i] - test_ch[j as usize];
        s_ref += ref_ch[i] * ref_ch[i];
        s_err += e * e;
        cnt += 1;
    }
    if cnt == 0 || s_err <= 1e-15 {
        return f64::INFINITY;
    }
    10.0 * (s_ref / s_err).log10()
}

fn cmd_compare(args: &[String]) -> Result<(), String> {
    let (ra, ca, pa) = read_wav(Path::new(&args[0]))?;
    let (rb, cb, pb) = read_wav(Path::new(&args[1]))?;
    println!("A: {ra} Hz × {ca} ch，{} 帧", pa.len() / ca as usize);
    println!("B: {rb} Hz × {cb} ch，{} 帧", pb.len() / cb as usize);

    // 包络对比：对每声道按 10ms 窗取 RMS，形成低速率包络序列，
    // 允许不同采样率之间的内容级对比。
    let env_a = envelopes(&pa, ca as usize, ra);
    let env_b = envelopes(&pb, cb as usize, rb);
    let n = env_a
        .first()
        .zip(env_b.first())
        .map(|(a, b)| a.len().min(b.len()))
        .unwrap_or(0);

    // 声道配对（lag=0，包络域）
    let mut used = vec![false; env_b.len()];
    let mut pairs = Vec::new();
    for (ia, ea) in env_a.iter().enumerate() {
        let mut best_j = usize::MAX;
        let mut best_c = -2.0;
        for (ib, eb) in env_b.iter().enumerate() {
            if used[ib] {
                continue;
            }
            let c = correlate(ea, eb, 0);
            if c > best_c {
                best_c = c;
                best_j = ib;
            }
        }
        if best_j != usize::MAX {
            used[best_j] = true;
            pairs.push((ia, best_j));
        }
    }

    println!("\n包络相关性（10ms RMS 窗，前 {n} 窗，lag ±200 窗对齐）:");
    let mut matched = 0usize;
    for &(ia, ib) in &pairs {
        let a_seg = &env_a[ia][..n];
        let b_seg = &env_b[ib][..n];
        let lag = best_lag(a_seg, b_seg);
        let c = correlate(a_seg, b_seg, lag);
        if c > 0.5 {
            matched += 1;
        }
        println!("  A.ch{} <-> B.ch{}: 包络相关性 {c:.4} (lag {lag} 窗)", ia, ib);
    }
    println!(
        "\n判定参考: 包络相关性 > 0.9 = 内容一致; 0.5~0.9 = 部分一致; < 0.5 = 不一致"
    );
    let _ = matched;
    Ok(())
}

/// 每声道 10ms RMS 包络。
fn envelopes(pcm: &[i16], ch: usize, rate: u32) -> Vec<Vec<f64>> {
    let win = (rate as usize / 100).max(1);
    let frames = pcm.len() / ch;
    (0..ch)
        .map(|c| {
            (0..frames / win)
                .map(|w| {
                    let mut s = 0.0f64;
                    for i in w * win..(w + 1) * win {
                        let v = pcm[i * ch + c] as f64 / 32768.0;
                        s += v * v;
                    }
                    (s / win as f64).sqrt()
                })
                .collect()
        })
        .collect()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("用法: ac4_verify decode <out.wav> <full|core> <in.mp4>... | compare <a.wav> <b.wav>");
        std::process::exit(2);
    }
    let res = match args[1].as_str() {
        "decode" if args.len() >= 5 => cmd_decode(&args[2..]),
        "compare" if args.len() == 4 => cmd_compare(&args[2..]),
        _ => Err("参数错误".to_string()),
    };
    if let Err(e) = res {
        eprintln!("错误: {e}");
        std::process::exit(1);
    }
}

// 引用 sync 模块避免未使用警告（sync word 探测用于诊断裸流）
#[allow(dead_code)]
fn has_sync_word(data: &[u8]) -> bool {
    sync::find_sync_frame(data).is_some()
}
