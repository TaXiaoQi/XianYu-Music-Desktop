use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use crate::source::SeekError;
use crate::Source;

/// Taps per polyphase branch. Total FIR length = TAPS_PER_PHASE * decimation_ratio.
/// 16 taps/phase gives ~74 dB Blackman stopband attenuation with a transition band
/// narrow enough to avoid aliasing when decimating DSD64 (2.8224 MHz) to 88.2 kHz.
const TAPS_PER_PHASE: usize = 16;

/// Cap on total FIR length to bound memory/CPU for very high DSD rates.
const MAX_FILTER_LEN: usize = 1024;

#[derive(Clone, Copy, PartialEq)]
enum DsdFormat {
    Dsf,
    Dff,
}

struct DsdMetadata {
    format: DsdFormat,
    channels: u16,
    pcm_rate: u32,
    ratio: u32,
    block_size: u32,
    data_offset: u64,
    data_size: u64,
    total_pcm_samples: u64,
}

pub(crate) struct DsdDecoder<R: Read + Seek> {
    reader: R,
    format: DsdFormat,
    channels: u16,
    pcm_rate: u32,
    ratio: u32,
    block_size: u32,
    data_offset: u64,
    data_size: u64,
    data_remaining: u64,
    /// Byte-aligned FIR lookup table: `lut[j * 256 + byte_value]` for j in 0..filter_bytes.
    /// Each entry is the partial sum of filter coefficients `h[j*8 + i]` for the set bits i
    /// (MSB-first) within the byte, letting us evaluate one FIR window in M additions.
    fir_lut: Vec<f32>,
    filter_bytes: usize,
    /// Per-channel byte buffer (history + newly read DSD bytes), MSB-first.
    ch_buf: Vec<Vec<u8>>,
    /// Per-channel byte index in `ch_buf` where the next output window starts.
    ch_window_start: Vec<usize>,
    /// Output PCM buffer (interleaved).
    pcm_buffer: Vec<f32>,
    pcm_pos: usize,
    total_pcm_samples: u64,
    /// Scratch buffer for raw chunk reads.
    raw_in: Vec<u8>,
    /// DFF: leftover bytes that didn't form a complete interleave frame.
    dff_leftover: Vec<u8>,
}

impl<R: Read + Seek> DsdDecoder<R> {
    pub(crate) fn new(mut reader: R) -> Result<Self, R> {
        let mut magic = [0u8; 4];
        if reader.read_exact(&mut magic).is_err() {
            let _ = reader.seek(SeekFrom::Start(0));
            return Err(reader);
        }

        let format = if &magic == b"DSD " {
            DsdFormat::Dsf
        } else if &magic == b"FRM8" {
            DsdFormat::Dff
        } else {
            let _ = reader.seek(SeekFrom::Start(0));
            return Err(reader);
        };

        match Self::parse_header(&mut reader, format) {
            Ok(meta) => {
                let ratio = meta.ratio as usize;
                let filter_len = std::cmp::min(TAPS_PER_PHASE * ratio, MAX_FILTER_LEN);
                // Ensure the filter length is a multiple of 8 so windows stay byte-aligned.
                let filter_len = std::cmp::max((filter_len / 8) * 8, 8);
                let filter_bytes = filter_len / 8;
                let fir_lut = Self::build_fir_lut(ratio, filter_len);
                let ch_count = meta.channels as usize;

                Ok(Self {
                    reader,
                    format: meta.format,
                    channels: meta.channels,
                    pcm_rate: meta.pcm_rate,
                    ratio: meta.ratio,
                    block_size: meta.block_size,
                    data_offset: meta.data_offset,
                    data_size: meta.data_size,
                    data_remaining: meta.data_size,
                    fir_lut,
                    filter_bytes,
                    ch_buf: vec![Vec::new(); ch_count],
                    ch_window_start: vec![0; ch_count],
                    pcm_buffer: Vec::new(),
                    pcm_pos: 0,
                    total_pcm_samples: meta.total_pcm_samples,
                    raw_in: Vec::new(),
                    dff_leftover: Vec::new(),
                })
            }
            Err(_) => {
                let _ = reader.seek(SeekFrom::Start(0));
                Err(reader)
            }
        }
    }

    pub(crate) fn into_inner(self) -> R {
        self.reader
    }

    fn parse_header(reader: &mut R, format: DsdFormat) -> Result<DsdMetadata, ()> {
        match format {
            DsdFormat::Dsf => Self::parse_dsf_header(reader),
            DsdFormat::Dff => Self::parse_dff_header(reader),
        }
    }

    fn parse_dsf_header(reader: &mut R) -> Result<DsdMetadata, ()> {
        let mut buf8 = [0u8; 8];
        // "DSD " already consumed: read chunk size (little-endian).
        reader.read_exact(&mut buf8).map_err(|_| ())?;
        let dsd_chunk_size = u64::from_le_bytes(buf8);
        let skip = dsd_chunk_size.saturating_sub(12);
        if skip > 0 {
            reader.seek(SeekFrom::Current(skip as i64)).map_err(|_| ())?;
        }

        // fmt chunk
        let mut header = [0u8; 12];
        reader.read_exact(&mut header).map_err(|_| ())?;
        if &header[0..4] != b"fmt " {
            return Err(());
        }
        let fmt_chunk_size = u64::from_le_bytes(header[4..12].try_into().unwrap());

        let mut fmt = [0u8; 40];
        reader.read_exact(&mut fmt).map_err(|_| ())?;

        let _format_version = u32::from_le_bytes(fmt[0..4].try_into().unwrap());
        let format_id = u32::from_le_bytes(fmt[4..8].try_into().unwrap());
        let _channel_type = u32::from_le_bytes(fmt[8..12].try_into().unwrap());
        let channel_num = u32::from_le_bytes(fmt[12..16].try_into().unwrap());
        let sampling_freq = u32::from_le_bytes(fmt[16..20].try_into().unwrap());
        let bits_per_sample = u32::from_le_bytes(fmt[20..24].try_into().unwrap());
        let block_size = u32::from_le_bytes(fmt[24..28].try_into().unwrap());

        if format_id != 0 || bits_per_sample != 1 || channel_num == 0 || block_size == 0 {
            return Err(());
        }

        let skip = fmt_chunk_size.saturating_sub(52);
        if skip > 0 {
            reader.seek(SeekFrom::Current(skip as i64)).map_err(|_| ())?;
        }

        // Find the data chunk, skipping any unknown chunks in between.
        let data_size = loop {
            if reader.read_exact(&mut header).is_err() {
                return Err(());
            }
            let chunk_id = &header[0..4];
            let chunk_size = u64::from_le_bytes(header[4..12].try_into().unwrap());

            if chunk_id == b"data" {
                let mut data_size_buf = [0u8; 8];
                reader.read_exact(&mut data_size_buf).map_err(|_| ())?;
                break u64::from_le_bytes(data_size_buf);
            } else if chunk_size > 12 {
                reader
                    .seek(SeekFrom::Current((chunk_size - 12) as i64))
                    .map_err(|_| ())?;
            }
        };

        let data_offset = reader.stream_position().map_err(|_| ())?;
        Self::finalize_metadata(
            DsdFormat::Dsf,
            channel_num,
            sampling_freq,
            block_size,
            data_offset,
            data_size,
        )
    }

    fn parse_dff_header(reader: &mut R) -> Result<DsdMetadata, ()> {
        let mut buf8 = [0u8; 8];
        // "FRM8" already consumed: read chunk size (big-endian).
        reader.read_exact(&mut buf8).map_err(|_| ())?;
        let frm8_size = u64::from_be_bytes(buf8);
        let pos_after_size = reader.stream_position().map_err(|_| ())?;
        let frm8_end = pos_after_size.checked_add(frm8_size).ok_or(())?;

        // Form type must be "DSD " for uncompressed DSDIFF.
        let mut form = [0u8; 4];
        reader.read_exact(&mut form).map_err(|_| ())?;
        if &form != b"DSD " {
            return Err(());
        }

        let mut channels = 0u32;
        let mut sampling_freq = 0u32;
        let mut data_offset = 0u64;
        let mut data_size = 0u64;

        while reader.stream_position().map_err(|_| ())? < frm8_end {
            let mut chunk_id = [0u8; 4];
            if reader.read_exact(&mut chunk_id).is_err() {
                break;
            }
            if reader.read_exact(&mut buf8).is_err() {
                return Err(());
            }
            let chunk_size = u64::from_be_bytes(buf8);
            let chunk_data_start = reader.stream_position().map_err(|_| ())?;
            let chunk_data_end = chunk_data_start.checked_add(chunk_size).ok_or(())?;

            match &chunk_id {
                b"FVER" => {}
                b"PROP" => {
                    // PROP is a nested form: 4-byte form type ("SND ") then sub-chunks.
                    let mut prop_form = [0u8; 4];
                    reader.read_exact(&mut prop_form).map_err(|_| ())?;
                    while reader.stream_position().map_err(|_| ())? < chunk_data_end {
                        let mut sub_id = [0u8; 4];
                        if reader.read_exact(&mut sub_id).is_err() {
                            break;
                        }
                        if reader.read_exact(&mut buf8).is_err() {
                            return Err(());
                        }
                        let sub_size = u64::from_be_bytes(buf8);
                        let sub_data_start = reader.stream_position().map_err(|_| ())?;

                        if &sub_id[0..2] == b"FS" && sub_size >= 4 {
                            let mut s = [0u8; 4];
                            reader.read_exact(&mut s).map_err(|_| ())?;
                            sampling_freq = u32::from_be_bytes(s);
                        } else if &sub_id == b"CHNL" && sub_size >= 2 {
                            let mut nc = [0u8; 2];
                            reader.read_exact(&mut nc).map_err(|_| ())?;
                            channels = u16::from_be_bytes(nc) as u32;
                        }

                        let sub_seek = sub_data_start.checked_add(sub_size).ok_or(())?;
                        reader.seek(SeekFrom::Start(sub_seek)).map_err(|_| ())?;
                        if sub_size & 1 != 0 && sub_seek < chunk_data_end {
                            reader.seek(SeekFrom::Current(1)).map_err(|_| ())?;
                        }
                    }
                }
                b"DSD " => {
                    data_offset = chunk_data_start;
                    data_size = chunk_size;
                }
                _ => {}
            }

            // Seek to the end of the chunk data, honoring IFF even-byte padding.
            let mut seek_to = chunk_data_end;
            if chunk_size & 1 != 0 {
                seek_to = seek_to.checked_add(1).ok_or(())?;
            }
            reader.seek(SeekFrom::Start(seek_to)).map_err(|_| ())?;

            if data_offset != 0 && data_size != 0 && channels != 0 && sampling_freq != 0 {
                break;
            }
        }

        if data_offset == 0 || data_size == 0 || channels == 0 || sampling_freq == 0 {
            return Err(());
        }

        reader.seek(SeekFrom::Start(data_offset)).map_err(|_| ())?;
        Self::finalize_metadata(DsdFormat::Dff, channels, sampling_freq, 1, data_offset, data_size)
    }

    fn finalize_metadata(
        format: DsdFormat,
        channel_num: u32,
        sampling_freq: u32,
        block_size: u32,
        data_offset: u64,
        data_size: u64,
    ) -> Result<DsdMetadata, ()> {
        // Pick the target PCM rate (88200 or 176400) that keeps the decimation ratio in
        // [8, 64] and byte-aligned (multiple of 8), preferring a ratio near 32.
        let candidates: [u32; 2] = [176400, 88200];
        let mut best: Option<(u32, u32, i32)> = None;
        for &target in candidates.iter() {
            if sampling_freq % target == 0 {
                let r = sampling_freq / target;
                if r >= 8 && r <= 64 && r % 8 == 0 {
                    let score = (r as i32 - 32).abs();
                    match best {
                        None => best = Some((target, r, score)),
                        Some((_, _, s)) if score < s => best = Some((target, r, score)),
                        _ => {}
                    }
                }
            }
        }
        let (pcm_rate, ratio, _) = best.ok_or(())?;

        let channels = channel_num as u16;
        let filter_len = std::cmp::min(TAPS_PER_PHASE * ratio as usize, MAX_FILTER_LEN);
        let filter_len = std::cmp::max((filter_len / 8) * 8, 8) as u64;

        let bits_per_channel = data_size * 8 / channel_num as u64;
        let pcm_per_channel = bits_per_channel
            .saturating_sub(filter_len - 1)
            / ratio as u64;
        let total_pcm_samples = pcm_per_channel * channel_num as u64;

        Ok(DsdMetadata {
            format,
            channels,
            pcm_rate,
            ratio,
            block_size,
            data_offset,
            data_size,
            total_pcm_samples,
        })
    }

    /// Design a Blackman-windowed sinc low-pass FIR and precompute a byte-aligned LUT.
    ///
    /// The filter is normalized to unit DC gain so that `y = 2 * sum(h * bit) - 1` maps
    /// the 1-bit DSD stream to a bipolar PCM sample in [-1, 1].
    fn build_fir_lut(ratio: usize, filter_len: usize) -> Vec<f32> {
        let mut h = vec![0.0f64; filter_len];
        let cutoff = 0.5 / ratio as f64;
        let denom = (filter_len - 1) as f64;
        for k in 0..filter_len {
            let n = k as f64 - denom / 2.0;
            let x = 2.0 * cutoff * n;
            let sinc = if x.abs() < 1e-9 {
                1.0
            } else {
                (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
            };
            let w = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * k as f64 / denom).cos()
                + 0.08 * (4.0 * std::f64::consts::PI * k as f64 / denom).cos();
            h[k] = 2.0 * cutoff * sinc * w;
        }
        let sum: f64 = h.iter().sum();
        if sum.abs() > 1e-12 {
            for v in h.iter_mut() {
                *v /= sum;
            }
        }

        let m = filter_len / 8;
        let mut lut = vec![0.0f32; m * 256];
        for j in 0..m {
            for byte in 0u16..256 {
                let mut s = 0.0f64;
                for i in 0..8 {
                    // MSB-first: bit (7 - i) of the byte is the earliest sample in time.
                    if (byte >> (7 - i)) & 1 == 1 {
                        s += h[j * 8 + i];
                    }
                }
                lut[j * 256 + byte as usize] = s as f32;
            }
        }
        lut
    }

    fn bytes_per_output(&self) -> usize {
        (self.ratio as usize) / 8
    }

    fn read_raw_chunk(&mut self) -> Option<usize> {
        if self.data_remaining == 0 {
            return None;
        }
        let chs = self.channels as usize;
        let want = match self.format {
            DsdFormat::Dsf => (self.block_size as usize) * chs,
            DsdFormat::Dff => self.bytes_per_output().max(1) * chs * 1024,
        };
        let to_read = std::cmp::min(want as u64, self.data_remaining) as usize;
        if to_read == 0 {
            return None;
        }
        self.raw_in.resize(to_read, 0);
        if self.reader.read_exact(&mut self.raw_in[..to_read]).is_err() {
            self.data_remaining = 0;
            return None;
        }
        self.data_remaining -= to_read as u64;
        Some(to_read)
    }

    fn deinterleave_into_buffers(&mut self, bytes_read: usize) {
        let chs = self.channels as usize;
        match self.format {
            DsdFormat::Dsf => {
                // DSF blocks store each channel contiguously: [ch0: block_size][ch1: block_size]...
                let block_size = self.block_size as usize;
                let block_total = block_size * chs;
                if block_total == 0 {
                    return;
                }
                let full_blocks = bytes_read / block_total;
                for b in 0..full_blocks {
                    let base = b * block_total;
                    for ch in 0..chs {
                        let s = base + ch * block_size;
                        self.ch_buf[ch].extend_from_slice(&self.raw_in[s..s + block_size]);
                    }
                }
                // Handle a possible truncated trailing block.
                let remainder = bytes_read % block_total;
                if remainder > 0 {
                    let base = full_blocks * block_total;
                    let full_ch = remainder / block_size;
                    for ch in 0..full_ch {
                        let s = base + ch * block_size;
                        if s + block_size <= bytes_read {
                            self.ch_buf[ch].extend_from_slice(&self.raw_in[s..s + block_size]);
                        }
                    }
                    let extra = remainder % block_size;
                    if extra > 0 && full_ch < chs {
                        let s = base + full_ch * block_size;
                        if s + extra <= bytes_read {
                            self.ch_buf[full_ch].extend_from_slice(&self.raw_in[s..s + extra]);
                        }
                    }
                }
            }
            DsdFormat::Dff => {
                // DFF stores bytes interleaved: byte0_ch0, byte0_ch1, ..., byte0_chN, byte1_ch0, ...
                let mut combined = std::mem::take(&mut self.dff_leftover);
                combined.extend_from_slice(&self.raw_in[..bytes_read]);
                let frame_size = chs;
                if frame_size == 0 {
                    return;
                }
                let full_frames = combined.len() / frame_size;
                for f in 0..full_frames {
                    for ch in 0..chs {
                        self.ch_buf[ch].push(combined[f * frame_size + ch]);
                    }
                }
                let leftover_start = full_frames * frame_size;
                self.dff_leftover = combined[leftover_start..].to_vec();
            }
        }
    }

    /// Run the FIR over the per-channel buffers and emit interleaved PCM samples.
    /// Returns the number of output frames produced.
    fn produce_outputs(&mut self) -> usize {
        let chs = self.channels as usize;
        let bpo = self.bytes_per_output();
        let m = self.filter_bytes;

        // We can only emit in lockstep across channels, so take the channel with the
        // fewest available outputs as the limit.
        let mut min_outputs = usize::MAX;
        for ch in 0..chs {
            let buf_len = self.ch_buf[ch].len();
            let start = self.ch_window_start[ch];
            if buf_len < start + m {
                return 0;
            }
            let avail = (buf_len - start - m) / bpo + 1;
            if avail < min_outputs {
                min_outputs = avail;
            }
        }
        if min_outputs == 0 || min_outputs == usize::MAX {
            return 0;
        }

        let start_idx = self.pcm_buffer.len();
        self.pcm_buffer.resize(start_idx + min_outputs * chs, 0.0);
        for n in 0..min_outputs {
            for ch in 0..chs {
                let ws = self.ch_window_start[ch] + n * bpo;
                let buf = &self.ch_buf[ch];
                let mut acc = 0.0f32;
                for j in 0..m {
                    acc += self.fir_lut[j * 256 + buf[ws + j] as usize];
                }
                // Map the 1-bit DSD accumulator to bipolar PCM (h is unit-DC-gain).
                self.pcm_buffer[start_idx + n * chs + ch] = acc * 2.0 - 1.0;
            }
        }

        for ch in 0..chs {
            self.ch_window_start[ch] += min_outputs * bpo;
        }

        // Compact: drop bytes before the next window start, keeping the tail as history
        // so the next chunk's first window spans the boundary correctly.
        for ch in 0..chs {
            let keep_from = self.ch_window_start[ch];
            if keep_from > 0 {
                if keep_from < self.ch_buf[ch].len() {
                    self.ch_buf[ch].drain(0..keep_from);
                } else {
                    self.ch_buf[ch].clear();
                }
                self.ch_window_start[ch] = 0;
            }
        }

        min_outputs
    }

    fn decode_next_chunk(&mut self) -> Option<()> {
        loop {
            let produced = self.produce_outputs();
            if produced > 0 {
                self.pcm_pos = 0;
                return Some(());
            }
            if self.data_remaining == 0 {
                return None;
            }
            let bytes_read = self.read_raw_chunk()?;
            self.deinterleave_into_buffers(bytes_read);
        }
    }
}

impl<R: Read + Seek> Iterator for DsdDecoder<R> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        loop {
            if self.pcm_pos < self.pcm_buffer.len() {
                let s = self.pcm_buffer[self.pcm_pos];
                self.pcm_pos += 1;
                return Some(s);
            }
            self.pcm_buffer.clear();
            self.decode_next_chunk()?;
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self
            .total_pcm_samples
            .saturating_sub(self.pcm_pos as u64);
        (remaining as usize, Some(remaining as usize))
    }
}

impl<R: Read + Seek> Source for DsdDecoder<R> {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.pcm_buffer.len().saturating_sub(self.pcm_pos))
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.pcm_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        let total_per_channel = self.total_pcm_samples / self.channels as u64;
        let secs = total_per_channel as f64 / self.pcm_rate as f64;
        Some(Duration::from_secs_f64(secs))
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let target_sample = (pos.as_secs_f64() * self.pcm_rate as f64) as u64;
        let bpo = self.bytes_per_output() as u64;
        let target_byte_per_ch = target_sample.saturating_mul(bpo);

        match self.format {
            DsdFormat::Dsf => {
                let block_size = self.block_size as u64;
                if block_size == 0 {
                    return Err(SeekError::NotSupported {
                        underlying_source: "DsdDecoder",
                    });
                }
                let target_block = target_byte_per_ch / block_size;
                let block_byte_size = block_size * self.channels as u64;
                let seek_pos = self.data_offset + target_block * block_byte_size;
                self.reader
                    .seek(SeekFrom::Start(seek_pos))
                    .map_err(|_| SeekError::NotSupported {
                        underlying_source: "DsdDecoder",
                    })?;
                self.data_remaining = self
                    .data_size
                    .saturating_sub(target_block * block_byte_size);
            }
            DsdFormat::Dff => {
                let seek_pos = self.data_offset + target_byte_per_ch * self.channels as u64;
                self.reader
                    .seek(SeekFrom::Start(seek_pos))
                    .map_err(|_| SeekError::NotSupported {
                        underlying_source: "DsdDecoder",
                    })?;
                self.data_remaining = self
                    .data_size
                    .saturating_sub(target_byte_per_ch * self.channels as u64);
            }
        }

        for ch in 0..self.channels as usize {
            self.ch_buf[ch].clear();
            self.ch_window_start[ch] = 0;
        }
        self.dff_leftover.clear();
        self.pcm_buffer.clear();
        self.pcm_pos = 0;

        Ok(())
    }
}
