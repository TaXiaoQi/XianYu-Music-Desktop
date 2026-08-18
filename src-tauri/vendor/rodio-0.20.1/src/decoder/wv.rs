//! WavPack (.wv) decoder backed by the pure-Rust `wavicle` crate.
//!
//! `wavicle` decodes a whole stream into memory, so the file bytes are read up
//! front and metadata is scanned eagerly (cheap header pass) while the actual
//! sample decode is deferred to the first pull. That pull happens on the
//! buffered-source producer thread, keeping file open fast.
//!
//! Scope of the backend: lossless mono/stereo WavPack v5, 16/24/32-bit integer
//! and 32-bit float. Hybrid/lossy, DSD and >2-channel files are rejected.

use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use crate::source::SeekError;
use crate::Source;

pub(crate) struct WavpackDecoder<R> {
    reader: Option<R>,
    /// Compressed stream bytes, kept until the deferred decode replaces them
    /// with decoded samples.
    pending: Option<Vec<u8>>,
    samples: Vec<f32>,
    pos: usize,
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u32,
    is_float: bool,
    total_frames: u64,
    failed: bool,
}

impl<R: Read + Seek> WavpackDecoder<R> {
    pub(crate) fn new(mut data: R) -> Result<Self, R> {
        let start = data.stream_position().unwrap_or(0);
        let mut magic = [0u8; 4];
        let is_wv = data.read_exact(&mut magic).is_ok() && &magic == b"wvpk";
        let _ = data.seek(SeekFrom::Start(start));
        if !is_wv {
            return Err(data);
        }

        let mut bytes = Vec::new();
        if data.read_to_end(&mut bytes).is_err() {
            return Err(data);
        }
        let reader = Some(data);

        match ::wavicle::StreamInfo::scan(&bytes) {
            Ok(info) => Ok(Self {
                reader,
                pending: Some(bytes),
                samples: Vec::new(),
                pos: 0,
                channels: info.channels as u16,
                sample_rate: info.sample_rate,
                bits_per_sample: info.bits_per_sample,
                is_float: info.is_float,
                total_frames: info.total_samples.unwrap_or(0),
                failed: false,
            }),
            Err(e) => {
                eprintln!("[rodio-wv] stream scan failed: {}", e);
                Ok(Self {
                    reader,
                    pending: None,
                    samples: Vec::new(),
                    pos: 0,
                    channels: 0,
                    sample_rate: 0,
                    bits_per_sample: 0,
                    is_float: false,
                    total_frames: 0,
                    failed: true,
                })
            }
        }
    }

    /// Decode the whole stream on first use. Runs on the producer thread.
    fn ensure_decoded(&mut self) {
        if self.samples.is_empty() && !self.failed {
            if let Some(bytes) = self.pending.take() {
                match ::wavicle::decode_stream(&bytes) {
                    Ok(decoded) => {
                        let scale = if decoded.is_float {
                            None
                        } else {
                            Some((1u64 << (decoded.bits_per_sample - 1).min(31)) as f32)
                        };
                        self.samples = decoded
                            .samples
                            .iter()
                            .map(|&v| match scale {
                                Some(s) => v as f32 / s,
                                None => f32::from_bits(v as u32),
                            })
                            .collect();
                        self.channels = decoded.channels as u16;
                        self.sample_rate = decoded.sample_rate;
                        self.bits_per_sample = decoded.bits_per_sample;
                        self.is_float = decoded.is_float;
                        self.total_frames = (self.samples.len() as u64)
                            / (self.channels.max(1) as u64);
                    }
                    Err(e) => {
                        eprintln!("[rodio-wv] decode failed: {}", e);
                        self.failed = true;
                    }
                }
            } else if self.total_frames == 0 {
                self.failed = true;
            }
        }
    }

    pub(crate) fn into_inner(self) -> Option<R> {
        self.reader
    }
}

impl<R: Read + Seek> Iterator for WavpackDecoder<R> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.failed {
            return None;
        }
        self.ensure_decoded();
        let s = self.samples.get(self.pos).copied();
        if s.is_some() {
            self.pos += 1;
        }
        s
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self.samples.len().saturating_sub(self.pos);
        (remaining, Some(remaining))
    }
}

impl<R: Read + Seek> Source for WavpackDecoder<R> {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        if self.sample_rate == 0 || self.total_frames == 0 {
            return None;
        }
        Some(Duration::from_secs_f64(
            self.total_frames as f64 / self.sample_rate as f64,
        ))
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        if self.failed || self.sample_rate == 0 {
            return Err(SeekError::NotSupported {
                underlying_source: "WavpackDecoder",
            });
        }
        self.ensure_decoded();
        let target = (pos.as_secs_f64() * self.sample_rate as f64) as u64;
        let idx = (target.saturating_mul(self.channels as u64) as usize).min(self.samples.len());
        self.pos = idx;
        Ok(())
    }
}
