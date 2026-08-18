//! Monkey's Audio (APE) decoder backed by the pure-Rust `ape-decoder` crate.
//!
//! Decodes frame-by-frame so playback starts without decompressing the whole
//! file. The underlying crate emits standard little-endian signed PCM
//! (8-bit output is unsigned with a +128 bias), interleaved by sample frame.

use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use crate::source::SeekError;
use crate::Source;

pub(crate) struct ApeDecoder<R: Read + Seek> {
    inner: ::ape_decoder::ApeDecoder<R>,
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
    bytes_per_sample: usize,
    block_align: usize,
    total_samples: u64,
    total_frames: u32,
    next_frame: u32,
    /// Absolute sample-frame index of the next emitted frame.
    current_pos: u64,
    /// PCM bytes of the currently decoded APE frame.
    pcm: Vec<u8>,
    pcm_pos: usize,
    ended: bool,
}

impl<R: Read + Seek> ApeDecoder<R> {
    /// Cheap magic gate so non-APE files skip the full header parse (which
    /// would otherwise scan up to 1 MB for the descriptor magic).
    fn looks_like_ape(data: &mut R) -> bool {
        let start = data.stream_position().unwrap_or(0);
        let is_mac = |m: &[u8; 4]| m == b"MAC " || m == b"MACF";

        let mut magic = [0u8; 4];
        let mut hit = false;
        if data.read_exact(&mut magic).is_ok() {
            if is_mac(&magic) {
                hit = true;
            } else if &magic[..3] == b"ID3" {
                // magic holds "ID3" + major version; the remaining header is
                // minor version, flags and the syncsafe tag size.
                let mut rest = [0u8; 6];
                if data.read_exact(&mut rest).is_ok() {
                    let size = u64::from(rest[2] & 0x7F) << 21
                        | u64::from(rest[3] & 0x7F) << 14
                        | u64::from(rest[4] & 0x7F) << 7
                        | u64::from(rest[5] & 0x7F);
                    let junk = 10 + size + if rest[1] & 0x10 != 0 { 10 } else { 0 };
                    if data.seek(SeekFrom::Start(start + junk)).is_ok() {
                        // Skip zero padding some taggers leave behind.
                        let mut pad = [0u8; 64];
                        loop {
                            match data.read(&mut pad) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    let zeros = pad[..n].iter().take_while(|&&b| b == 0).count();
                                    if zeros < n {
                                        let _ = data.seek_relative(-(n as i64 - zeros as i64));
                                        break;
                                    }
                                }
                            }
                        }
                        hit = data.read_exact(&mut magic).is_ok() && is_mac(&magic);
                    }
                }
            }
        }

        let _ = data.seek(SeekFrom::Start(start));
        hit
    }

    pub(crate) fn new(mut data: R) -> Result<Self, R> {
        if !Self::looks_like_ape(&mut data) {
            return Err(data);
        }
        let start = data.stream_position().unwrap_or(0);
        // Full header parse on a borrowed reader: validates magic, descriptor,
        // seek table, etc. before ownership is handed over.
        let parsed = match ::ape_decoder::format::parse(&mut data) {
            Ok(info) => info,
            Err(_) => {
                let _ = data.seek(SeekFrom::Start(start));
                return Err(data);
            }
        };
        let _ = data.seek(SeekFrom::Start(start));

        let bits_per_sample = parsed.header.bits_per_sample;
        let channels = parsed.header.channels;
        let sample_rate = parsed.header.sample_rate;
        let bytes_per_sample = parsed.bytes_per_sample as usize;
        let block_align = parsed.block_align as usize;
        if channels == 0
            || sample_rate == 0
            || bits_per_sample == 0
            || bytes_per_sample == 0
            || block_align == 0
        {
            return Err(data);
        }

        let inner = ::ape_decoder::ApeDecoder::new(data)
            .expect("ape header validated in probe, construction cannot fail");
        let info = inner.info();

        Ok(Self {
            total_samples: info.total_samples,
            total_frames: info.total_frames,
            inner,
            channels,
            sample_rate,
            bits_per_sample,
            bytes_per_sample,
            block_align,
            next_frame: 0,
            current_pos: 0,
            pcm: Vec::new(),
            pcm_pos: 0,
            ended: false,
        })
    }

    #[inline]
    fn read_sample_at(&self, pos: usize) -> f32 {
        let b = &self.pcm[pos..pos + self.bytes_per_sample];
        match self.bits_per_sample {
            8 => (b[0] as f32 - 128.0) / 128.0,
            16 => i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0,
            24 => {
                let v = u32::from(b[0]) | u32::from(b[1]) << 8 | u32::from(b[2]) << 16;
                let v = if v & 0x0080_0000 != 0 {
                    (v | 0xff00_0000u32) as i32
                } else {
                    v as i32
                };
                v as f32 / 8_388_608.0
            }
            _ => i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32 / 2_147_483_648.0,
        }
    }

    fn decode_next_frame(&mut self) -> bool {
        if self.ended || self.next_frame >= self.total_frames {
            self.ended = true;
            return false;
        }
        match self.inner.decode_frame(self.next_frame) {
            Ok(pcm) => {
                self.next_frame += 1;
                self.pcm = pcm;
                self.pcm_pos = 0;
                true
            }
            Err(e) => {
                eprintln!("[rodio-ape] frame {} decode failed: {}", self.next_frame, e);
                self.ended = true;
                false
            }
        }
    }
}

impl<R: Read + Seek> Iterator for ApeDecoder<R> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        loop {
            if self.pcm_pos < self.pcm.len() {
                let s = self.read_sample_at(self.pcm_pos);
                self.pcm_pos += self.bytes_per_sample;
                if self.pcm_pos % self.block_align == 0 {
                    self.current_pos += 1;
                }
                return Some(s);
            }
            if !self.decode_next_frame() {
                return None;
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self
            .total_samples
            .saturating_sub(self.current_pos)
            .saturating_mul(self.channels as u64);
        (remaining as usize, Some(remaining as usize))
    }
}

impl<R: Read + Seek> Source for ApeDecoder<R> {
    fn current_frame_len(&self) -> Option<usize> {
        Some((self.pcm.len() - self.pcm_pos) / self.bytes_per_sample)
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        if self.sample_rate == 0 {
            return None;
        }
        Some(Duration::from_secs_f64(
            self.total_samples as f64 / self.sample_rate as f64,
        ))
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let target = (pos.as_secs_f64() * self.sample_rate as f64) as u64;
        let seeked = self
            .inner
            .seek(target)
            .map_err(|e| SeekError::Other(Box::new(std::io::Error::other(e.to_string()))))?;

        match self.inner.decode_frame(seeked.frame_index) {
            Ok(pcm) => {
                self.pcm = pcm;
                self.next_frame = seeked.frame_index + 1;
                self.current_pos = seeked.actual_sample;
                self.pcm_pos = seeked.skip_samples as usize * self.block_align;
                self.pcm_pos = self.pcm_pos.min(self.pcm.len());
                self.ended = false;
                Ok(())
            }
            Err(e) => {
                self.ended = true;
                Err(SeekError::Other(Box::new(std::io::Error::other(format!(
                    "ape seek decode failed: {}",
                    e
                )))))
            }
        }
    }
}
