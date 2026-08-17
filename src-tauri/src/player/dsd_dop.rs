//! DSD 原生 DoP（DSD over PCM）直出。
//!
//! 读未压缩 DSF 的 1-bit DSD 原生流，按 DoP 1.0 打包成 24-bit PCM 帧输出到
//! 支持 DoP 的 DSD-DAC。DoP 是位真输出：走 WASAPI 独占、绕过 f32/音量/EQ 链路。
//!
//! DoP 1.0 约定：每个通道每帧承载 8 个 DSD bit（1 字节）。
//! - DSD64(2.8224M)   → 352.8 kHz
//! - DSD128(5.6448M)  → 705.6 kHz
//! - DSD256(11.2896M) → 1.4112 MHz
//! 24-bit 容器中：低字节 = DSD 数据字节，中字节 = 0，高字节 = 标记 0x05/0xFA 交替。

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};

pub const DOP_MARKER_LOW: u8 = 0x05;
pub const DOP_MARKER_HIGH: u8 = 0xFA;

#[derive(Debug, Clone, Copy)]
pub struct DsdInfo {
    pub channels: u16,
    /// DSD 原生采样率，如 DSD64 = 2_822_400 Hz。
    pub dsd_rate: u32,
    pub block_size: u32,
    pub data_offset: u64,
    pub data_size: u64,
    pub is_dst: bool,
}

/// DSD 率 → DoP PCM 采样率（每个通道每帧 8 个 DSD bit）。
pub fn dop_pcm_rate(dsd_rate: u32) -> Option<u32> {
    if dsd_rate == 0 || dsd_rate % 8 != 0 {
        return None;
    }
    Some(dsd_rate / 8)
}

fn read_u32_le(buf: &[u8]) -> u32 {
    u32::from_le_bytes(buf[..4].try_into().unwrap())
}

fn read_u64_le(buf: &[u8]) -> u64 {
    u64::from_le_bytes(buf[..8].try_into().unwrap())
}

/// 解析 DSF 头：返回声道数、DSD 率、block 大小与 data 区偏移/大小。
/// 仅支持未压缩（format_id=0）DSD raw；DST 压缩的 DSF 返回 is_dst=true。
pub fn parse_dsf_info(path: &str) -> Result<DsdInfo, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(|_| "not a DSD file".to_string())?;
    if &magic != b"DSD " {
        // DFF（FRM8）暂不支持原生 DoP(DST 无法携带)；
        return Err("not DSF (DSD over PCM only supports uncompressed DSF)".to_string());
    }

    // 跳过 DSD chunk size
    let mut size_buf = [0u8; 8];
    file.read_exact(&mut size_buf).map_err(|_| "bad dsd chunk".to_string())?;
    let _dsd_chunk_size = read_u64_le(&size_buf);

    // fmt 子块
    let mut chunk = [0u8; 12];
    file.read_exact(&mut chunk).map_err(|_| "bad fmt".to_string())?;
    if &chunk[0..4] != b"fmt " {
        return Err("missing fmt chunk".to_string());
    }
    let fmt_size = read_u64_le(&chunk[4..12]);

    let mut fmt = [0u8; 44];
    file.read_exact(&mut fmt).map_err(|_| "bad fmt payload".to_string())?;

    let format_id = read_u32_le(&fmt[4..8]);
    let channels = read_u32_le(&fmt[12..16]) as u16;
    let dsd_rate = read_u32_le(&fmt[16..20]);
    let bits_per_sample = read_u32_le(&fmt[20..24]);
    let block_size = read_u32_le(&fmt[24..28]);

    if channels == 0 || dsd_rate == 0 || block_size == 0 {
        return Err("invalid DSF fmt".to_string());
    }

    // 消费整个 fmt 负载（此处已直读 44 字节，需跳过剩余部分）
    let skip_fmt = fmt_size.saturating_sub(44);
    if skip_fmt > 0 {
        file.seek(SeekFrom::Current(skip_fmt as i64)).map_err(|e| e.to_string())?;
    }

    // 定位 data 子块
    let (data_offset, data_size) = loop {
        let mut hdr = [0u8; 12];
        if file.read_exact(&mut hdr).is_err() {
            return Err("missing data chunk".to_string());
        }
        let chunk_id = &hdr[0..4];
        let chunk_size = read_u64_le(&hdr[4..12]);

        if chunk_id == b"data" {
            let mut inner = [0u8; 8];
            file.read_exact(&mut inner).map_err(|_| "bad data size".to_string())?;
            let data_size = read_u64_le(&inner);
            let data_offset = file.stream_position().map_err(|e| e.to_string())?;
            break (data_offset, data_size);
        } else if chunk_size > 12 {
            file.seek(SeekFrom::Current((chunk_size - 12) as i64)).map_err(|e| e.to_string())?;
        } else {
            return Err("unknown chunk".to_string());
        }
    };

    Ok(DsdInfo {
        channels,
        dsd_rate,
        block_size,
        data_offset,
        data_size,
        is_dst: bits_per_sample != 1 || format_id != 0,
    })
}

/// 按 block 流式读取 DSF 的 DSD 原生字节，并打包为 DoP 24-bit 帧。
///
/// 支持 `next_frames` 按帧粒度过量产出（满足 WASAPI 按 buffer/frame 填充），
/// marker 用全局帧序号交替（0x05/0xFA），跨 block 边界保持连续，DAC 无需在
/// block 边界重新同步。也支持按帧 seek（时长 → 帧位 → 文件字节偏移）。
pub struct DopStreamSource {
    reader: BufReader<File>,
    start_offset: u64,
    data_size: u64,
    data_remaining: u64,
    channels: usize,
    block_size: usize,
    cps: usize,
    buf: Vec<u8>,
    frames_left: usize,
    /// 已产出的总 DoP 帧数，用于跨块持续的 marker 交替。
    frame_index: u64,
}

impl DopStreamSource {
    pub fn open(path: &str, info: &DsdInfo) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(info.data_offset)).map_err(|e| e.to_string())?;
        Ok(Self {
            reader: BufReader::with_capacity(1 << 16, file),
            start_offset: info.data_offset,
            data_size: info.data_size,
            data_remaining: info.data_size,
            channels: info.channels as usize,
            block_size: info.block_size as usize,
            cps: info.channels as usize * info.block_size as usize,
            buf: Vec::new(),
            frames_left: 0,
            frame_index: 0,
        })
    }

    fn load_block(&mut self) -> Result<bool, String> {
        if self.data_remaining == 0 {
            return Ok(false);
        }
        self.buf.resize(self.cps, 0);
        let mut filled = 0usize;
        while filled < self.cps {
            let n = self.reader.read(&mut self.buf[filled..]).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            filled += n;
        }
        // 数据区按块声明，偏差仅出现在截断的末尾：不足按补零的最后一块处理。
        self.data_remaining = self.data_remaining.saturating_sub(filled as u64);
        if filled == 0 {
            return Ok(false);
        }
        self.frames_left = self.block_size;
        Ok(true)
    }

    /// 产出至多 `max_frames` 个 DoP 帧到 `out`（每帧 `channels × 3` 字节），
    /// 返回实际产出的帧数；流结束时返回的帧数 < `max_frames`。
    pub fn next_frames(&mut self, out: &mut Vec<u8>, max_frames: usize) -> Result<usize, String> {
        let mut produced = 0usize;
        while produced < max_frames {
            if self.frames_left == 0 && !self.load_block()? {
                break;
            }
            let frame_in_block = self.block_size - self.frames_left;
            let marker = if self.frame_index & 1 == 0 { DOP_MARKER_LOW } else { DOP_MARKER_HIGH };
            for ch in 0..self.channels {
                // block 布局：ch0[0..bs], ch1[0..bs], ... => 帧 f 的通道 c 字节 = buf[f + c*bs]
                let db = self.buf[frame_in_block + ch * self.block_size];
                out.push(db);
                out.push(0);
                out.push(marker);
            }
            self.frames_left -= 1;
            self.frame_index += 1;
            produced += 1;
        }
        Ok(produced)
    }

    /// 定位到第 `target_frame` 个 DoP 帧（从 data 区开头计数）。
    ///
    /// DSF 数据区按 block 连续存储（block i = ch0[bs]…chN[bs]），因 block 内按通道
    /// 分块、多通道帧并不连续排列，只支持定位到 block 边界。返回实际落到的帧号
    /// （target 向下取整到最近的 block 起点，偏差 < block_size 帧，DSD 下约毫秒级）。
    pub fn seek_to_frame(&mut self, target_frame: u64) -> Result<u64, String> {
        let block_size = self.block_size as u64;
        let block_index = target_frame / block_size;
        let aligned_frame = block_index * block_size;
        let byte_off = block_index
            .saturating_mul(self.channels as u64 * block_size)
            .min(self.data_size);
        self.reader
            .seek(SeekFrom::Start(self.start_offset + byte_off))
            .map_err(|e| e.to_string())?;
        self.data_remaining = self.data_size - byte_off;
        self.frames_left = 0;
        self.frame_index = aligned_frame;
        Ok(aligned_frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个最小的单声道 DSF：1 个数据块、block_size=4、DSD 率固定为便于读的倍数。
    /// 返回 (字节串, DsdInfo)。
    fn build_dsf(channels: u32, block_size: u32, dsd_rate: u32, blocks: &[u8]) -> Vec<u8> {
        let fmt: Vec<u8> = {
            let mut v = Vec::new();
            v.extend_from_slice(&0u32.to_le_bytes()); // version
            v.extend_from_slice(&0u32.to_le_bytes()); // format_id = DSD raw
            v.extend_from_slice(&0u32.to_le_bytes()); // channel_type
            v.extend_from_slice(&channels.to_le_bytes());
            v.extend_from_slice(&dsd_rate.to_le_bytes());
            v.extend_from_slice(&1u32.to_le_bytes()); // bits_per_sample
            let block_size = block_size;
            v.extend_from_slice(&block_size.to_le_bytes());
            // 剩余填充到 52 字节
            while v.len() < 52 {
                v.push(0);
            }
            v
        };

        let mut out = Vec::new();
        out.extend_from_slice(b"DSD ");
        let pre_size_pos = out.len();
        out.extend_from_slice(&0u64.to_le_bytes()); // 占位 dsd chunk size
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&(fmt.len() as u64).to_le_bytes());
        out.extend_from_slice(&fmt);
        out.extend_from_slice(b"data");
        let data_hdr = blocks.len() as u64;
        out.extend_from_slice(&(data_hdr + 8).to_le_bytes()); // data chunk size
        out.extend_from_slice(&(blocks.len() as u64).to_le_bytes()); // inner data size
        out.extend_from_slice(blocks);

        let chunk_size = (out.len() - 12) as u64;
        out[pre_size_pos..pre_size_pos + 8].copy_from_slice(&chunk_size.to_le_bytes());
        out
    }

    fn write_tmp(bytes: &[u8], tag: &str) -> String {
        let path = format!("{}-dsf-{tag}.dsf", std::process::id());
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn parses_mono_dsf_header() {
        // 单声道 4 字节一 block
        let bytes = build_dsf(1, 4, 2_822_400, &[0b1010_1010, 0b0101_0101, 0xFF, 0x00]);
        let path = write_tmp(&bytes, "mono");
        let info = parse_dsf_info(&path).unwrap();
        assert_eq!(info.channels, 1);
        assert_eq!(info.dsd_rate, 2_822_400);
        assert_eq!(info.block_size, 4);
        assert!(!info.is_dst);
        assert_eq!(dop_pcm_rate(info.dsd_rate), Some(352_800));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn mono_dop_frame_layout() {
        // 单声道 block：4 字节 -> 4 帧，每帧 [data, 0, marker]（marker 每帧交替）
        let bytes = build_dsf(1, 4, 2_822_400, &[0xAA, 0x55, 0xFF, 0x00]);
        let path = write_tmp(&bytes, "mono-frames");
        let info = parse_dsf_info(&path).unwrap();
        let mut src = DopStreamSource::open(&path, &info).unwrap();
        let mut out = Vec::new();

        // 每帧单独产出，便于逐帧校验
        for _ in 0..4 {
            assert_eq!(src.next_frames(&mut out, 1).unwrap(), 1);
        }
        assert_eq!(out.len(), 4 * 3);

        let mut i = 0;
        for frame in 0..4 {
            let marker = if frame & 1 == 0 { DOP_MARKER_LOW } else { DOP_MARKER_HIGH };
            assert_eq!(out[i], [0xAA, 0x55, 0xFF, 0x00][frame]); // data byte
            assert_eq!(out[i + 1], 0);
            assert_eq!(out[i + 2], marker);
            i += 3;
        }
        assert_eq!(src.next_frames(&mut out, 4).unwrap(), 0); // 已结束
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn stereo_deinterleave() {
        // 立体声 2 字节 block：数据 = [ch0 a, ch0 b, ch1 c, ch1 d]（block 内按通道连续）
        let bs = 2u32;
        let ch = 2u32;
        // block: ch0 = [0x11, 0x22], ch1 = [0x33, 0x44]
        let dsd = [0x11, 0x22, 0x33, 0x44];
        let bytes = build_dsf(ch, 2, 2_822_400, &dsd);
        let path = write_tmp(&bytes, "stereo");
        let info = parse_dsf_info(&path).unwrap();
        assert_eq!(info.channels, 2);
        let mut src = DopStreamSource::open(&path, &info).unwrap();
        let mut out = Vec::new();
        assert_eq!(src.next_frames(&mut out, 2).unwrap(), 2);
        assert_eq!(out.len(), (bs as usize) * (ch as usize) * 3);

        // 帧0: ch0=0x11,ch1=0x33; 帧1: ch0=0x22,ch1=0x44
        let mut i = 0;
        for frame in 0..bs as usize {
            let marker = if frame & 1 == 0 { DOP_MARKER_LOW } else { DOP_MARKER_HIGH };
            // ch0
            assert_eq!(out[i], [0x11, 0x22][frame]);
            assert_eq!(out[i + 1], 0);
            assert_eq!(out[i + 2], marker);
            i += 3;
            // ch1
            assert_eq!(out[i], [0x33, 0x44][frame]);
            assert_eq!(out[i + 1], 0);
            assert_eq!(out[i + 2], marker);
            i += 3;
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn marker_alternates_continuously_across_blocks() {
        // 两小块（每块 2 帧），验证 marker 用全局帧号交替、跨块不重复，不重置
        let bs = 2u32;
        let ch = 1u32;
        // block1: ch0=[0x10,0x20]; block2: ch0=[0x30,0x40]
        let dsd = [0x10, 0x20, 0x30, 0x40];
        let bytes = build_dsf(ch, bs, 2_822_400, &dsd);
        let path = write_tmp(&bytes, "marker-across");
        let info = parse_dsf_info(&path).unwrap();
        let mut src = DopStreamSource::open(&path, &info).unwrap();

        let mut markers = Vec::new();
        let mut data = Vec::new();
        let mut out = Vec::new();
        while src.next_frames(&mut out, 8).unwrap() > 0 {
            let mut it = out.chunks_exact(3);
            for frame in it.by_ref() {
                data.push(frame[0]);
                markers.push(frame[2]);
            }
            out.clear();
        }
        // 0,1 帧属于块1，2,3 帧属于块2；期望 0x05,0xFA,0x05,0xFA（跨块连续）
        assert_eq!(data, vec![0x10, 0x20, 0x30, 0x40]);
        assert_eq!(markers, vec![0x05, 0xFA, 0x05, 0xFA]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn seek_to_frame_skips_to_byte_offset() {
        let bs = 2u32;
        let ch = 1u32;
        let dsd = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60];
        let bytes = build_dsf(ch, bs, 2_822_400, &dsd);
        let path = write_tmp(&bytes, "seek");
        let info = parse_dsf_info(&path).unwrap();
        let mut src = DopStreamSource::open(&path, &info).unwrap();

        // 定位第 3 帧：block_size=2，向下取整落在 block 1（第 2 帧）起点 → 第 2 帧
        assert_eq!(src.seek_to_frame(3).unwrap(), 2);
        let mut out = Vec::new();
        assert_eq!(src.next_frames(&mut out, 8).unwrap(), 4); // 剩 4 帧（字节 2..6）
        let mut data = Vec::new();
        for frame in out.chunks_exact(3) {
            data.push(frame[0]);
        }
        assert_eq!(data, vec![0x30, 0x40, 0x50, 0x60]);

        // marker 应从全局帧号 2 继续：0x05,0xFA,0x05,0xFA
        let mut markers = Vec::new();
        for frame in out.chunks_exact(3) {
            markers.push(frame[2]);
        }
        assert_eq!(markers, vec![0x05, 0xFA, 0x05, 0xFA]);
        let _ = std::fs::remove_file(&path);
    }
}