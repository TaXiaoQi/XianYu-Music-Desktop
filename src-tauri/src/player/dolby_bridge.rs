//! 杜比音轨（AC-4 / E-AC-3）播放桥。
//!
//! 背景：rodio 内置解码链（symphonia-isomp4 等）不认识 m4a 容器里的 AC-4 /
//! EC-3 音轨，嗅探失败后 mp3 兜底会把裸字节硬啃成垃圾 PCM——表现为爆音。
//! 本模块在解码前探测容器音轨编码，命中杜比系时用随包 ffmpeg CLI 解成
//! 标准 WAV（pcm_s16le）再交给原播放链，其余格式零介入。
//!
//! 探测针对「解密后的明文流」：QMC2/CENC 的密文整体变换后才有合法 box 结构，
//! 所以密文来源需先经 `materialize_plain_file` 落明文临时文件。

use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::stream_cache::ReadSeek;

/// 探测命中的杜比编码。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DolbyCodec {
    /// AC-4（QQ dolby / 网易 dolby）
    Ac4,
    /// E-AC-3（DD+，部分网易 dolby 流）
    Ec3,
}

impl DolbyCodec {
    pub fn as_str(&self) -> &'static str {
        match self {
            DolbyCodec::Ac4 => "ac-4",
            DolbyCodec::Ec3 => "ec-3",
        }
    }
}

/// 明文化方式：probe 命中后，为 ffmpeg 准备一份可读明文。
pub enum PlainTransform<'a> {
    /// 数据已是明文，`path` 可直接交给 ffmpeg
    None,
    /// QMC2（本地文件检测出的 crypto）
    QmcCrypto(&'a super::qmc2::QmcCrypto),
    /// QMC2（流式缓存的 ekey）
    QmcEkey(&'a str),
    /// CENC（cek，整文件解密无需样本级元数据）
    Cenc(&'a str),
}

// ==================== 诊断日志 ====================

/// 桥决策落盘：dev 终端看不到时也能从文件回溯每次播放的 probe 判定。
pub(crate) fn log_bridge(msg: &str) {
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{ts}] {msg}");
    eprintln!("[Audio][rust] dolby_bridge {line}");
    let dir = temp_bridge_dir();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("bridge.log"))
    {
        let _ = writeln!(f, "{line}");
    }
}

fn head_hex(r: &mut dyn ReadSeek) -> String {
    let _ = r.seek(SeekFrom::Start(0));
    let mut head = [0u8; 16];
    let n = r.read(&mut head).unwrap_or(0);
    head[..n]
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

// ==================== MP4 box 解析 ====================

fn read_exact_u32(r: &mut dyn ReadSeek, buf: &mut [u8]) -> std::io::Result<u32> {
    r.read_exact(buf)?;
    Ok(u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]))
}

/// 读一个 box 头，返回 (fourcc, 内容区起点, 内容区终点)。
/// size==1 时读 64 位 largesize；size==0 表示延伸到父级末尾。
fn read_box_head(
    r: &mut dyn ReadSeek,
    end: u64,
) -> std::io::Result<Option<([u8; 4], u64, u64)>> {
    let box_start = r.stream_position()?;
    let mut hdr = [0u8; 8];
    match r.read_exact(&mut hdr) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let size32 = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as u64;
    let (header_len, size) = if size32 == 1 {
        let mut ext = [0u8; 8];
        r.read_exact(&mut ext)?;
        (16u64, u64::from_be_bytes(ext))
    } else if size32 == 0 {
        (8u64, end.saturating_sub(box_start))
    } else {
        (8u64, size32)
    };
    if size < header_len {
        return Ok(None);
    }
    let body_start = box_start + header_len;
    let body_end = end.min(box_start.saturating_add(size));
    Ok(Some((hdr[4..8].try_into().unwrap(), body_start, body_end)))
}

/// 在 [start, end) 区间逐 box 调用 on_box，命中 Some 即停止。
fn scan_boxes<T, F>(
    r: &mut dyn ReadSeek,
    start: u64,
    end: u64,
    mut on_box: F,
) -> std::io::Result<Option<T>>
where
    F: FnMut(&mut dyn ReadSeek, [u8; 4], u64, u64) -> std::io::Result<Option<T>>,
{
    let _ = r.seek(SeekFrom::Start(start));
    let mut pos = start;
    while pos + 8 <= end {
        let _ = r.seek(SeekFrom::Start(pos));
        let (fourcc, body_start, body_end) = match read_box_head(r, end)? {
            Some(v) => v,
            None => break,
        };
        if let Some(hit) = on_box(r, fourcc, body_start, body_end)? {
            return Ok(Some(hit));
        }
        pos = body_end;
    }
    Ok(None)
}

/// 沿容器链（moov→trak→mdia→minf→stbl→stsd）递归下钻。
fn scan_chain(
    r: &mut dyn ReadSeek,
    start: u64,
    end: u64,
    chain: &[&[u8; 4]],
) -> std::io::Result<Option<DolbyCodec>> {
    let name = chain[0];
    scan_boxes(r, start, end, |r, fourcc, body_start, body_end| {
        if &fourcc != name {
            return Ok(None);
        }
        if chain.len() == 1 {
            parse_stsd(r, body_start, body_end)
        } else {
            scan_chain(r, body_start, body_end, &chain[1..])
        }
    })
}

/// 解析 stsd：fullbox(4B) + entry_count(4B) + 逐条目探测编码。
fn parse_stsd(
    r: &mut dyn ReadSeek,
    body_start: u64,
    body_end: u64,
) -> std::io::Result<Option<DolbyCodec>> {
    if body_start + 8 > body_end {
        return Ok(None);
    }
    let _ = r.seek(SeekFrom::Start(body_start + 4));
    let count = read_exact_u32(r, &mut [0u8; 4])?;
    let mut entry_off = body_start + 8;
    for _ in 0..count.min(16) {
        if entry_off + 8 > body_end {
            break;
        }
        let _ = r.seek(SeekFrom::Start(entry_off));
        let entry_size = read_exact_u32(r, &mut [0u8; 4])? as u64;
        let entry_end = body_end.min(entry_off + entry_size.max(8));
        if let Some(c) = probe_stsd_entry(r, entry_off, entry_end)? {
            return Ok(Some(c));
        }
        entry_off = entry_end;
    }
    Ok(None)
}

/// stsd 条目里找真实编码四码；encv/enca（CENC 加密条目）读 frma 兜底。
fn probe_stsd_entry(
    r: &mut dyn ReadSeek,
    entry_start: u64,
    entry_end: u64,
) -> std::io::Result<Option<DolbyCodec>> {
    let mut four = [0u8; 4];
    r.read_exact(&mut four)?;
    if let Some(c) = classify_fourcc(&four) {
        return Ok(Some(c));
    }
    if &four == b"encv" || &four == b"enca" {
        // 加密条目：跳过 6B reserved + 2B data_ref_index 进入子 box 区
        let sub_start = entry_start + 16;
        return scan_boxes(r, sub_start, entry_end, |r, fourcc, body_start, _body_end| {
            if &fourcc != b"frma" {
                return Ok(None);
            }
            let _ = r.seek(SeekFrom::Start(body_start));
            let mut inner = [0u8; 4];
            r.read_exact(&mut inner)?;
            Ok(classify_fourcc(&inner))
        });
    }
    Ok(None)
}

fn classify_fourcc(f: &[u8; 4]) -> Option<DolbyCodec> {
    match f {
        b"ac-4" => Some(DolbyCodec::Ac4),
        b"ec-3" => Some(DolbyCodec::Ec3),
        _ => None,
    }
}

/// 对明文 MP4 流探测音轨编码：非 mp4 容器立即短路。
/// 读完恢复流位置，不影响后续解码。
pub fn probe_mp4_dolby_codec(r: &mut dyn ReadSeek) -> Option<DolbyCodec> {
    // 立即调用的借用闭包：借用随调用结束释放，之后仍可恢复流位置
    let head = head_hex(r);
    let result: std::io::Result<Option<DolbyCodec>> = (|| {
        let _ = r.seek(SeekFrom::Start(0));
        let mut head = [0u8; 12];
        match r.read_exact(&mut head) {
            Ok(()) => {}
            Err(_) => return Ok(None),
        }
        // ftyp box：size(4) + 'ftyp'
        if &head[4..8] != b"ftyp" {
            return Ok(None);
        }
        let _ = r.seek(SeekFrom::Start(0));
        let file_len = match r.seek(SeekFrom::End(0)) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let _ = r.seek(SeekFrom::Start(0));
        scan_chain(
            r,
            0,
            file_len,
            &[b"moov", b"trak", b"mdia", b"minf", b"stbl", b"stsd"],
        )
    })();
    let _ = r.seek(SeekFrom::Start(0));
    let codec = result.unwrap_or(None);
    log_bridge(
        &format!(
            "probe: head=[{head}] → {}",
            codec.map(|c| c.as_str().to_string()).unwrap_or_else(|| "未命中".into())
        )
    );
    codec
}

// ==================== 明文化 + ffmpeg 解码 ====================

fn temp_bridge_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("xy_dolby_bridge");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn unique_temp(ext: &str) -> PathBuf {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    temp_bridge_dir().join(format!("xy_dolby_{ts}.{ext}"))
}

/// 固定名临时文件：上一份不再被持有则复用同名（seek 重建可覆盖），
/// 仍被播放句柄占用时退回唯一名。
fn preferred_temp(ext: &str, name: &str) -> PathBuf {
    let p = temp_bridge_dir().join(name);
    if p.exists() {
        let _ = std::fs::remove_file(&p);
    }
    if p.exists() {
        unique_temp(ext)
    } else {
        p
    }
}

/// 按加密方式产出一份明文 m4a（无加密时返回原路径）。
pub fn materialize_plain_file(
    path: &str,
    transform: &PlainTransform,
) -> Result<PathBuf, String> {
    match transform {
        PlainTransform::None => Ok(PathBuf::from(path)),
        PlainTransform::QmcCrypto(crypto) => {
            let mut data = std::fs::read(path).map_err(|e| format!("读取密文失败: {e}"))?;
            crypto.decrypt(0, &mut data);
            let out = preferred_temp("m4a", "xy_dolby_plain.m4a");
            std::fs::write(&out, &data).map_err(|e| format!("写明文临时文件失败: {e}"))?;
            Ok(out)
        }
        PlainTransform::QmcEkey(ekey) => {
            let crypto = super::qmc2::QmcCrypto::from_ekey(ekey)?;
            let mut data = std::fs::read(path).map_err(|e| format!("读取密文失败: {e}"))?;
            crypto.decrypt(0, &mut data);
            let out = preferred_temp("m4a", "xy_dolby_plain.m4a");
            std::fs::write(&out, &data).map_err(|e| format!("写明文临时文件失败: {e}"))?;
            Ok(out)
        }
        PlainTransform::Cenc(cek) => {
            let key = super::cenc::cek_to_key(cek)?;
            let mut data = std::fs::read(path).map_err(|e| format!("读取密文失败: {e}"))?;
            super::cenc::decrypt_cenc_in_place(&mut data, &key)
                .map_err(|e| format!("CENC 解密失败: {e}"))?;
            let out = preferred_temp("m4a", "xy_dolby_plain.m4a");
            std::fs::write(&out, &data).map_err(|e| format!("写明文临时文件失败: {e}"))?;
            Ok(out)
        }
    }
}

/// ffmpeg CLI 把杜比音轨解成标准 WAV（pcm_s16le），限时 90s。
fn decode_dolby_to_wav(input: &Path, codec: DolbyCodec) -> Result<PathBuf, String> {
    let program = crate::ffmpeg_bin::resolve_ffmpeg(None);
    let out = preferred_temp("wav", "xy_dolby_bridge.wav");
    let mut child = std::process::Command::new(&program)
        .args(["-y", "-i"])
        .arg(input)
        .args(["-vn", "-map", "0:a:0", "-f", "wav", "-c:a", "pcm_s16le"])
        .arg(&out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() && out.exists() {
                    eprintln!(
                        "[Audio][rust] dolby bridge: {} 解码完成 → {}",
                        codec.as_str(),
                        out.display()
                    );
                    return Ok(out);
                }
                return Err(format!(
                    "ffmpeg 解码 {} 退出异常: {status}",
                    codec.as_str()
                ));
            }
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    return Err("ffmpeg 杜比解码超时(90s)".to_string());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("等待 ffmpeg 失败: {e}")),
        }
    }
}

/// 顶层桥：probe 命中杜比编码时产出可播放的 WAV reader。
///
/// - `probe_reader`：明文流（各调用方已解密包装），probe 过程会恢复其位置
/// - `plain_path`：若调用方手上已握有明文文件路径（无需再明文化）则传入
/// - `path` / `transform`：probe 命中但无现成明文时，按此明文化
///
/// 返回 None 表示非杜比流，调用方按原链继续。
pub fn bridge_if_dolby(
    probe_reader: &mut dyn ReadSeek,
    plain_path: Option<&str>,
    path: &str,
    transform: &PlainTransform,
) -> Option<(Box<dyn ReadSeek + Send + Sync + 'static>, DolbyCodec)> {
    let transform_name = match transform {
        PlainTransform::None => "none",
        PlainTransform::QmcCrypto(_) => "qmc-crypto",
        PlainTransform::QmcEkey(_) => "qmc-ekey",
        PlainTransform::Cenc(_) => "cenc",
    };
    log_bridge(&format!(
        "bridge_if_dolby 入口: path={path} plain_path={plain_path:?} transform={transform_name}"
    ));
    let codec = probe_mp4_dolby_codec(probe_reader)?;
    let plain: PathBuf = match plain_path {
        Some(p) => PathBuf::from(p),
        None => materialize_plain_file(path, transform).ok()?,
    };
    match decode_dolby_to_wav(&plain, codec) {
        Ok(wav) => match std::fs::File::open(&wav) {
            Ok(file) => {
                // 明文化产物用完即弃（保护用户原文件：与 path 相同则不删）；
                // wav 保留到下次解码前覆盖，供 seek 重建复用
                if plain_path.is_none() && plain != PathBuf::from(path) {
                    let _ = std::fs::remove_file(&plain);
                }
                Some((Box::new(std::io::BufReader::with_capacity(
                    512 * 1024,
                    file,
                )), codec))
            }
            Err(e) => {
                eprintln!("[Audio][rust] dolby bridge: WAV 打开失败: {e}");
                None
            }
        },
        Err(e) => {
            eprintln!("[Audio][rust] dolby bridge: {e}");
            None
        }
    }
}

// ==================== 测试 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Seek};

    struct MemReader(Cursor<Vec<u8>>);
    impl Read for MemReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.0.read(buf)
        }
    }
    impl Seek for MemReader {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.0.seek(pos)
        }
    }

    fn box_bytes(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&((payload.len() + 8) as u32).to_be_bytes());
        v.extend_from_slice(fourcc);
        v.extend_from_slice(payload);
        v
    }

    fn stsd_with_format(format: &[u8; 4]) -> Vec<u8> {
        // stsd: version/flags(4) + entry_count(4) + entry(size+format+冗余)
        let mut entry = Vec::new();
        entry.extend_from_slice(&32u32.to_be_bytes()); // entry size
        entry.extend_from_slice(format);
        entry.extend_from_slice(&[0u8; 24]); // reserved
        let mut v = Vec::new();
        v.extend_from_slice(&0u32.to_be_bytes()); // version/flags
        v.extend_from_slice(&1u32.to_be_bytes()); // entry count
        v.extend_from_slice(&entry);
        box_bytes(b"stsd", &v)
    }

    fn nested(containers: &[&[u8; 4]], leaf: &[u8]) -> Vec<u8> {
        let mut v = leaf.to_vec();
        for c in containers.iter().rev() {
            v = box_bytes(c, &v);
        }
        v
    }

    fn build_mp4(stsd_format: &[u8; 4]) -> MemReader {
        let stbl = nested(
            &[b"stbl"],
            &stsd_with_format(stsd_format),
        );
        let moov = nested(&[b"moov", b"trak", b"mdia", b"minf"], &stbl);
        let ftyp = box_bytes(b"ftyp", b"isom\x00\x00\x02\x00isomiso2");
        let mut data = Vec::new();
        data.extend_from_slice(&ftyp);
        data.extend_from_slice(&moov);
        MemReader(Cursor::new(data))
    }

    #[test]
    fn probe_detects_ec3_direct_entry() {
        let mut r = build_mp4(b"ec-3");
        assert_eq!(probe_mp4_dolby_codec(&mut r), Some(DolbyCodec::Ec3));
        // probe 恢复位置
        assert_eq!(r.seek(SeekFrom::Start(0)).unwrap(), 0);
    }

    #[test]
    fn probe_detects_ac4_via_enca_frma() {
        // enca 条目：size + 'enca' + reserved(6) + data_ref(2) + 子box frma('ac-4')
        let mut entry = Vec::new();
        entry.extend_from_slice(&40u32.to_be_bytes());
        entry.extend_from_slice(b"enca");
        entry.extend_from_slice(&[0u8; 8]); // reserved + data_ref_index
        entry.extend_from_slice(&12u32.to_be_bytes());
        entry.extend_from_slice(b"frma");
        entry.extend_from_slice(b"ac-4");
        let mut stsd = Vec::new();
        stsd.extend_from_slice(&0u32.to_be_bytes());
        stsd.extend_from_slice(&1u32.to_be_bytes());
        stsd.extend_from_slice(&entry);
        let stbl = nested(&[b"stbl"], &box_bytes(b"stsd", &stsd));
        let moov = nested(&[b"moov", b"trak", b"mdia", b"minf"], &stbl);
        let mut data = box_bytes(b"ftyp", b"isom\x00\x00\x02\x00isomiso2");
        data.extend_from_slice(&moov);
        let mut r = MemReader(Cursor::new(data));
        assert_eq!(probe_mp4_dolby_codec(&mut r), Some(DolbyCodec::Ac4));
    }

    #[test]
    fn probe_rejects_non_mp4_and_plain_aac() {
        // 非 mp4 头
        let mut data = Vec::new();
        data.extend_from_slice(b"fLaC\x00\x00\x00\x22");
        data.extend_from_slice(&[0u8; 32]);
        let mut r = MemReader(Cursor::new(data));
        assert_eq!(probe_mp4_dolby_codec(&mut r), None);

        // mp4 但音轨是 aac
        let mut r = build_mp4(b"mp4a");
        assert_eq!(probe_mp4_dolby_codec(&mut r), None);
    }
}
