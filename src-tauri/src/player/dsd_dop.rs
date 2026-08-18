//! DSD 原生 DoP（DSD over PCM）直出。
//!
//! 读未压缩 DSD 的 1-bit DSD 原生流，按 DoP 1.0 打包成 24-bit PCM 帧输出到
//! 支持 DoP 的 DSD-DAC。DoP 是位真输出：走 WASAPI 独占、绕过 f32/音量/EQ 链路。
//!
//! 支持两种 DSD 容器格式：
//! - DSF（DSD Stream File）：小端、block 布局（ch0[0..bs], ch1[0..bs], ...）
//! - DFF（DSDIFF）：大端 IFF、字节交错布局（ch0_byte0, ch1_byte0, ch0_byte1, ...）
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

/// DFF 内部缓冲帧数（DFF 无 block 概念，按固定帧数分批读取）
const DFF_BUFFER_FRAMES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DsdFormat {
    Dsf,
    Dff,
}

#[derive(Debug, Clone, Copy)]
pub struct DsdInfo {
    pub channels: u16,
    /// DSD 原生采样率，如 DSD64 = 2_822_400 Hz。
    pub dsd_rate: u32,
    /// DSF block 大小；DFF 无 block 概念，此字段为 0。
    pub block_size: u32,
    pub data_offset: u64,
    pub data_size: u64,
    pub is_dst: bool,
    pub format: DsdFormat,
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

fn read_u32_be(buf: &[u8]) -> u32 {
    u32::from_be_bytes(buf[..4].try_into().unwrap())
}

fn read_u64_be(buf: &[u8]) -> u64 {
    u64::from_be_bytes(buf[..8].try_into().unwrap())
}

/// 解析 DSF 头：返回声道数、DSD 率、block 大小与 data 区偏移/大小。
/// 仅支持未压缩（format_id=0）DSD raw；DST 压缩的 DSF 返回 is_dst=true。
pub fn parse_dsf_info(path: &str) -> Result<DsdInfo, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(|_| "not a DSD file".to_string())?;
    if &magic != b"DSD " {
        return Err("not DSF".to_string());
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
        format: DsdFormat::Dsf,
    })
}

/// 解析 DFF（DSDIFF）头：大端 IFF 结构，字节交错 DSD 数据。
///
/// FRM8 → FVER / PROP(SND: FS + CHNL + CMPR) / DSD
/// DFF 数据按 Clustered Frame 逐字节交错：CH0 CH1 CH0 CH1 ...
pub fn parse_dff_info(path: &str) -> Result<DsdInfo, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(|_| "not a DSD file".to_string())?;
    if &magic != b"FRM8" {
        return Err("not DFF (expected FRM8 magic)".to_string());
    }

    let mut frm8_size_buf = [0u8; 8];
    file.read_exact(&mut frm8_size_buf).map_err(|_| "bad FRM8 size".to_string())?;
    let frm8_size = read_u64_be(&frm8_size_buf);

    let mut form_type = [0u8; 4];
    file.read_exact(&mut form_type).map_err(|_| "bad form type".to_string())?;
    if &form_type != b"DSD " {
        return Err("not DSDIFF (form type is not DSD)".to_string());
    }

    let frm8_data_end = 12 + frm8_size;

    let mut channels = 0u16;
    let mut dsd_rate = 0u32;
    let mut is_dst = false;
    let mut data_offset = 0u64;
    let mut data_size = 0u64;

    loop {
        let pos = file.stream_position().map_err(|e| e.to_string())?;
        if pos >= frm8_data_end {
            break;
        }

        let mut chunk_hdr = [0u8; 12];
        if file.read_exact(&mut chunk_hdr).is_err() {
            break;
        }

        let chunk_id = &chunk_hdr[0..4];
        let chunk_size = read_u64_be(&chunk_hdr[4..12]);
        let chunk_data_start = file.stream_position().map_err(|e| e.to_string())?;
        let pad = if chunk_size & 1 != 0 { 1 } else { 0 };

        match chunk_id {
            b"FVER" => {
                file.seek(SeekFrom::Current((chunk_size + pad) as i64))
                    .map_err(|e| e.to_string())?;
            }
            b"PROP" => {
                let mut prop_type = [0u8; 4];
                file.read_exact(&mut prop_type)
                    .map_err(|_| "bad PROP type".to_string())?;

                let prop_data_end = chunk_data_start + chunk_size;
                while file.stream_position().map_err(|e| e.to_string())? < prop_data_end {
                    let mut sub_hdr = [0u8; 12];
                    if file.read_exact(&mut sub_hdr).is_err() {
                        break;
                    }
                    let sub_id = &sub_hdr[0..4];
                    let sub_size = read_u64_be(&sub_hdr[4..12]);
                    let sub_data_start = file.stream_position().map_err(|e| e.to_string())?;
                    let sub_pad = if sub_size & 1 != 0 { 1 } else { 0 };

                    match sub_id {
                        b"FS  " => {
                            let mut rate_buf = [0u8; 4];
                            file.read_exact(&mut rate_buf)
                                .map_err(|_| "bad FS data".to_string())?;
                            dsd_rate = read_u32_be(&rate_buf);
                        }
                        b"CHNL" => {
                            let mut ch_buf = [0u8; 2];
                            file.read_exact(&mut ch_buf)
                                .map_err(|_| "bad CHNL data".to_string())?;
                            channels = u16::from_be_bytes(ch_buf);
                        }
                        b"CMPR" => {
                            let mut comp_type = [0u8; 4];
                            file.read_exact(&mut comp_type)
                                .map_err(|_| "bad CMPR data".to_string())?;
                            is_dst = &comp_type == b"DST ";
                        }
                        _ => {}
                    }

                    file.seek(SeekFrom::Start(sub_data_start + sub_size + sub_pad))
                        .map_err(|e| e.to_string())?;
                }
                // 跳到下一个顶层 chunk（含 PROP 自身的填充字节）
                file.seek(SeekFrom::Start(chunk_data_start + chunk_size + pad))
                    .map_err(|e| e.to_string())?;
            }
            b"DSD " => {
                data_offset = chunk_data_start;
                data_size = chunk_size;
                break;
            }
            b"DST " => {
                data_offset = chunk_data_start;
                data_size = chunk_size;
                is_dst = true;
                break;
            }
            _ => {
                file.seek(SeekFrom::Current((chunk_size + pad) as i64))
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    if channels == 0 || dsd_rate == 0 || data_size == 0 {
        return Err("invalid DFF: missing required PROP or DSD chunks".to_string());
    }

    Ok(DsdInfo {
        channels,
        dsd_rate,
        block_size: 0,
        data_offset,
        data_size,
        is_dst,
        format: DsdFormat::Dff,
    })
}

/// 统一 DSD 文件解析入口：根据 magic 自动分派 DSF 或 DFF。
pub fn parse_dsd_info(path: &str) -> Result<DsdInfo, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(|_| "not a DSD file".to_string())?;
    drop(file);

    match &magic {
        b"DSD " => parse_dsf_info(path),
        b"FRM8" => parse_dff_info(path),
        _ => Err("not a DSD file (expected DSD or FRM8 magic)".to_string()),
    }
}

/// 按 block / 交错流式读取 DSD 原生字节，并打包为 DoP 24-bit 帧。
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
    /// 当前缓冲区中加载的帧数。
    frames_in_buf: usize,
    frames_left: usize,
    /// 已产出的总 DoP 帧数，用于跨块持续的 marker 交替。
    frame_index: u64,
    format: DsdFormat,
}

impl DopStreamSource {
    pub fn open(path: &str, info: &DsdInfo) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(info.data_offset)).map_err(|e| e.to_string())?;
        let (block_size, cps) = match info.format {
            DsdFormat::Dsf => {
                let bs = info.block_size as usize;
                (bs, info.channels as usize * bs)
            }
            DsdFormat::Dff => {
                let bs = DFF_BUFFER_FRAMES;
                (bs, info.channels as usize * bs)
            }
        };
        Ok(Self {
            reader: BufReader::with_capacity(1 << 16, file),
            start_offset: info.data_offset,
            data_size: info.data_size,
            data_remaining: info.data_size,
            channels: info.channels as usize,
            block_size,
            cps,
            buf: Vec::new(),
            frames_in_buf: 0,
            frames_left: 0,
            frame_index: 0,
            format: info.format,
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
        self.data_remaining = self.data_remaining.saturating_sub(filled as u64);
        if filled == 0 {
            return Ok(false);
        }
        match self.format {
            DsdFormat::Dsf => {
                self.frames_in_buf = self.block_size;
                self.frames_left = self.block_size;
            }
            DsdFormat::Dff => {
                self.frames_in_buf = filled / self.channels;
                self.frames_left = self.frames_in_buf;
            }
        }
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
            let frame_in_buf = self.frames_in_buf - self.frames_left;
            let marker = if self.frame_index & 1 == 0 { DOP_MARKER_LOW } else { DOP_MARKER_HIGH };
            for ch in 0..self.channels {
                let db = match self.format {
                    // DSF block 布局：ch0[0..bs], ch1[0..bs], ... => 帧 f 的通道 c 字节 = buf[f + c*bs]
                    DsdFormat::Dsf => self.buf[frame_in_buf + ch * self.block_size],
                    // DFF 字节交错：CH0 CH1 CH0 CH1 ... => 帧 f 的通道 c 字节 = buf[f * channels + c]
                    DsdFormat::Dff => self.buf[frame_in_buf * self.channels + ch],
                };
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
    /// DSF：数据区按 block 连续存储，只支持定位到 block 边界，返回向下取整的帧号。
    /// DFF：数据按字节交错连续存储，支持精确帧定位。
    pub fn seek_to_frame(&mut self, target_frame: u64) -> Result<u64, String> {
        match self.format {
            DsdFormat::Dsf => {
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
                self.frames_in_buf = 0;
                self.frames_left = 0;
                self.frame_index = aligned_frame;
                Ok(aligned_frame)
            }
            DsdFormat::Dff => {
                let channels = self.channels as u64;
                let byte_off = target_frame
                    .saturating_mul(channels)
                    .min(self.data_size);
                self.reader
                    .seek(SeekFrom::Start(self.start_offset + byte_off))
                    .map_err(|e| e.to_string())?;
                self.data_remaining = self.data_size - byte_off;
                self.frames_in_buf = 0;
                self.frames_left = 0;
                self.frame_index = target_frame;
                Ok(target_frame)
            }
        }
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

    // ===== DFF (DSDIFF) tests =====

    /// 构造最小 DFF 文件：FRM8 → FVER + PROP(FS + CHNL + CMPR) + DSD data
    fn build_dff(channels: u16, dsd_rate: u32, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();

        // 先构造 FRM8 内部内容（local chunks，不含 form_type）
        let mut inner = Vec::new();

        // FVER chunk (size=4, even → no pad)
        inner.extend_from_slice(b"FVER");
        inner.extend_from_slice(&4u64.to_be_bytes());
        inner.extend_from_slice(&0x01050000u32.to_be_bytes());

        // PROP chunk (nested form)
        let mut prop_inner = Vec::new();
        prop_inner.extend_from_slice(b"SND "); // property type

        // FS sub-chunk (size=4, even → no pad)
        prop_inner.extend_from_slice(b"FS  ");
        prop_inner.extend_from_slice(&4u64.to_be_bytes());
        prop_inner.extend_from_slice(&dsd_rate.to_be_bytes());

        // CHNL sub-chunk (size=2+4*ch, even → no pad)
        let chnl_size: u64 = 2 + (channels as u64 * 4);
        prop_inner.extend_from_slice(b"CHNL");
        prop_inner.extend_from_slice(&chnl_size.to_be_bytes());
        prop_inner.extend_from_slice(&channels.to_be_bytes());
        for i in 0..channels {
            let id: &[u8; 4] = if i == 0 {
                b"SLFT"
            } else if i == 1 {
                b"SRGT"
            } else {
                b"C000"
            };
            prop_inner.extend_from_slice(id);
        }

        // CMPR sub-chunk (size=4+1+14=19, odd → pad)
        let comp_str = b"not compressed";
        let cmpr_size: u64 = 4 + 1 + comp_str.len() as u64;
        prop_inner.extend_from_slice(b"CMPR");
        prop_inner.extend_from_slice(&cmpr_size.to_be_bytes());
        prop_inner.extend_from_slice(b"not ");
        prop_inner.push(comp_str.len() as u8);
        prop_inner.extend_from_slice(comp_str);
        if cmpr_size & 1 != 0 {
            prop_inner.push(0); // pad to even
        }

        // PROP header + data + pad
        inner.extend_from_slice(b"PROP");
        inner.extend_from_slice(&(prop_inner.len() as u64).to_be_bytes());
        inner.extend_from_slice(&prop_inner);
        if prop_inner.len() & 1 != 0 {
            inner.push(0); // pad to even
        }

        // DSD chunk + pad
        inner.extend_from_slice(b"DSD ");
        inner.extend_from_slice(&(data.len() as u64).to_be_bytes());
        inner.extend_from_slice(data);
        if data.len() & 1 != 0 {
            inner.push(0); // pad to even
        }

        // FRM8 header: chunk_data_size = form_type(4) + local_chunks
        let frm8_data_size = 4u64 + inner.len() as u64;
        out.extend_from_slice(b"FRM8");
        out.extend_from_slice(&frm8_data_size.to_be_bytes());
        out.extend_from_slice(b"DSD "); // form type
        out.extend_from_slice(&inner);

        out
    }

    fn write_tmp_dff(bytes: &[u8], tag: &str) -> String {
        let path = format!("{}-dff-{tag}.dff", std::process::id());
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn parses_mono_dff_header() {
        let bytes = build_dff(1, 2_822_400, &[0xAA, 0x55, 0xFF, 0x00]);
        let path = write_tmp_dff(&bytes, "mono");
        let info = parse_dff_info(&path).unwrap();
        assert_eq!(info.channels, 1);
        assert_eq!(info.dsd_rate, 2_822_400);
        assert!(!info.is_dst);
        assert_eq!(info.format, DsdFormat::Dff);
        assert_eq!(dop_pcm_rate(info.dsd_rate), Some(352_800));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dff_mono_dop_frame_layout() {
        // 单声道 4 字节 → 4 帧，每帧 [data, 0, marker]
        let bytes = build_dff(1, 2_822_400, &[0xAA, 0x55, 0xFF, 0x00]);
        let path = write_tmp_dff(&bytes, "mono-frames");
        let info = parse_dff_info(&path).unwrap();
        let mut src = DopStreamSource::open(&path, &info).unwrap();
        let mut out = Vec::new();

        for _ in 0..4 {
            assert_eq!(src.next_frames(&mut out, 1).unwrap(), 1);
        }
        assert_eq!(out.len(), 4 * 3);

        let mut i = 0;
        for frame in 0..4 {
            let marker = if frame & 1 == 0 { DOP_MARKER_LOW } else { DOP_MARKER_HIGH };
            assert_eq!(out[i], [0xAA, 0x55, 0xFF, 0x00][frame]);
            assert_eq!(out[i + 1], 0);
            assert_eq!(out[i + 2], marker);
            i += 3;
        }
        assert_eq!(src.next_frames(&mut out, 4).unwrap(), 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dff_stereo_interleaved() {
        // 立体声字节交错：CH0 CH1 CH0 CH1 → [0x11, 0x33, 0x22, 0x44]
        let dsd = [0x11, 0x33, 0x22, 0x44];
        let bytes = build_dff(2, 2_822_400, &dsd);
        let path = write_tmp_dff(&bytes, "stereo");
        let info = parse_dff_info(&path).unwrap();
        assert_eq!(info.channels, 2);
        let mut src = DopStreamSource::open(&path, &info).unwrap();
        let mut out = Vec::new();
        assert_eq!(src.next_frames(&mut out, 2).unwrap(), 2);
        assert_eq!(out.len(), 2 * 2 * 3); // 2 frames × 2 channels × 3 bytes

        // 帧0: ch0=0x11, ch1=0x33; 帧1: ch0=0x22, ch1=0x44
        let mut i = 0;
        for frame in 0..2 {
            let marker = if frame & 1 == 0 { DOP_MARKER_LOW } else { DOP_MARKER_HIGH };
            assert_eq!(out[i], [0x11, 0x22][frame]);     // ch0
            assert_eq!(out[i + 1], 0);
            assert_eq!(out[i + 2], marker);
            i += 3;
            assert_eq!(out[i], [0x33, 0x44][frame]);     // ch1
            assert_eq!(out[i + 1], 0);
            assert_eq!(out[i + 2], marker);
            i += 3;
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dff_marker_alternates_across_buffers() {
        // 8 帧单声道数据，验证 marker 跨缓冲区连续交替
        let dsd = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80];
        let bytes = build_dff(1, 2_822_400, &dsd);
        let path = write_tmp_dff(&bytes, "marker");
        let info = parse_dff_info(&path).unwrap();
        let mut src = DopStreamSource::open(&path, &info).unwrap();

        let mut markers = Vec::new();
        let mut data = Vec::new();
        let mut out = Vec::new();
        while src.next_frames(&mut out, 8).unwrap() > 0 {
            for frame in out.chunks_exact(3) {
                data.push(frame[0]);
                markers.push(frame[2]);
            }
            out.clear();
        }
        assert_eq!(data, vec![0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]);
        assert_eq!(markers, vec![0x05, 0xFA, 0x05, 0xFA, 0x05, 0xFA, 0x05, 0xFA]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dff_seek_to_exact_frame() {
        // DFF 支持精确帧定位（不向下取整到 block 边界）
        let dsd = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80];
        let bytes = build_dff(1, 2_822_400, &dsd);
        let path = write_tmp_dff(&bytes, "seek");
        let info = parse_dff_info(&path).unwrap();
        let mut src = DopStreamSource::open(&path, &info).unwrap();

        // 定位第 3 帧 → 精确到第 3 帧（不像 DSF 那样向下取整）
        assert_eq!(src.seek_to_frame(3).unwrap(), 3);
        let mut out = Vec::new();
        assert_eq!(src.next_frames(&mut out, 8).unwrap(), 5); // 剩 5 帧
        let data: Vec<u8> = out.chunks_exact(3).map(|f| f[0]).collect();
        assert_eq!(data, vec![0x40, 0x50, 0x60, 0x70, 0x80]);

        // marker 从全局帧号 3 继续：3→0xFA, 4→0x05, ...
        let markers: Vec<u8> = out.chunks_exact(3).map(|f| f[2]).collect();
        assert_eq!(markers, vec![0xFA, 0x05, 0xFA, 0x05, 0xFA]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parse_dsd_info_dispatches_by_magic() {
        let dsf_bytes = build_dsf(1, 4, 2_822_400, &[0xAA, 0x55, 0xFF, 0x00]);
        let dff_bytes = build_dff(1, 2_822_400, &[0xAA, 0x55, 0xFF, 0x00]);

        let dsf_path = write_tmp(&dsf_bytes, "dispatch-dsf");
        let dff_path = write_tmp_dff(&dff_bytes, "dispatch-dff");

        let dsf_info = parse_dsd_info(&dsf_path).unwrap();
        assert_eq!(dsf_info.format, DsdFormat::Dsf);

        let dff_info = parse_dsd_info(&dff_path).unwrap();
        assert_eq!(dff_info.format, DsdFormat::Dff);

        let _ = std::fs::remove_file(&dsf_path);
        let _ = std::fs::remove_file(&dff_path);
    }
}