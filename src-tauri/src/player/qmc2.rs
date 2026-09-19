use base64::Engine;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

// ============================================================
// ============================================================

const TEA_DELTA: u32 = 0x9E3779B9;
const TEA_ROUNDS: u32 = 16;
const SALT_LEN: usize = 2;
const ZERO_LEN: usize = 7;

fn tea_decrypt_ecb(input: &[u8], key: &[u8; 16]) -> [u8; 8] {
    let mut y = u32::from_be_bytes([input[0], input[1], input[2], input[3]]);
    let mut z = u32::from_be_bytes([input[4], input[5], input[6], input[7]]);
    let k0 = u32::from_be_bytes([key[0], key[1], key[2], key[3]]);
    let k1 = u32::from_be_bytes([key[4], key[5], key[6], key[7]]);
    let k2 = u32::from_be_bytes([key[8], key[9], key[10], key[11]]);
    let k3 = u32::from_be_bytes([key[12], key[13], key[14], key[15]]);

    let mut sum = TEA_DELTA.wrapping_mul(TEA_ROUNDS);
    for _ in 0..TEA_ROUNDS {
        z = z.wrapping_sub(
            ((y << 4).wrapping_add(k2)) ^ y.wrapping_add(sum) ^ ((y >> 5).wrapping_add(k3)),
        );
        y = y.wrapping_sub(
            ((z << 4).wrapping_add(k0)) ^ z.wrapping_add(sum) ^ ((z >> 5).wrapping_add(k1)),
        );
        sum = sum.wrapping_sub(TEA_DELTA);
    }

    let mut out = [0u8; 8];
    out[..4].copy_from_slice(&y.to_be_bytes());
    out[4..].copy_from_slice(&z.to_be_bytes());
    out
}

fn tc_tea_decrypt(ciphertext: &[u8], key: &[u8; 16]) -> Option<Vec<u8>> {
    if ciphertext.len() % 8 != 0 || ciphertext.len() < 16 {
        return None;
    }

    let mut dest = tea_decrypt_ecb(&ciphertext[..8], key);
    let pad_len = (dest[0] & 0x07) as usize;

    let body_len = ciphertext.len() - 1 - pad_len - SALT_LEN - ZERO_LEN;
    if body_len <= 0 || body_len > ciphertext.len() {
        return None;
    }

    let mut result = Vec::with_capacity(body_len);
    let mut iv_prev = [0u8; 8];
    let mut iv_cur = [0u8; 8];
    iv_cur.copy_from_slice(&ciphertext[..8]);

    let mut dest_i = 1 + pad_len;
    let mut buf_pos = 8usize;

    let mut salt_remaining = SALT_LEN;
    while salt_remaining > 0 {
        if dest_i < 8 {
            dest_i += 1;
            salt_remaining -= 1;
        } else {
            iv_prev = iv_cur;
            if buf_pos + 8 > ciphertext.len() {
                return None;
            }
            iv_cur.copy_from_slice(&ciphertext[buf_pos..buf_pos + 8]);
            for j in 0..8 {
                dest[j] ^= ciphertext[buf_pos + j];
            }
            dest = tea_decrypt_ecb(&dest, key);
            buf_pos += 8;
            dest_i = 0;
        }
    }

    let mut body_remaining = body_len;
    while body_remaining > 0 {
        if dest_i < 8 {
            result.push(dest[dest_i] ^ iv_prev[dest_i]);
            dest_i += 1;
            body_remaining -= 1;
        } else {
            iv_prev = iv_cur;
            if buf_pos + 8 > ciphertext.len() {
                return None;
            }
            iv_cur.copy_from_slice(&ciphertext[buf_pos..buf_pos + 8]);
            for j in 0..8 {
                dest[j] ^= ciphertext[buf_pos + j];
            }
            dest = tea_decrypt_ecb(&dest, key);
            buf_pos += 8;
            dest_i = 0;
        }
    }

    let mut zero_remaining = ZERO_LEN;
    while zero_remaining > 0 {
        if dest_i < 8 {
            if dest[dest_i] ^ iv_prev[dest_i] != 0 {
                return None;
            }
            dest_i += 1;
            zero_remaining -= 1;
        } else {
            iv_prev = iv_cur;
            if buf_pos + 8 > ciphertext.len() {
                return None;
            }
            iv_cur.copy_from_slice(&ciphertext[buf_pos..buf_pos + 8]);
            for j in 0..8 {
                dest[j] ^= ciphertext[buf_pos + j];
            }
            dest = tea_decrypt_ecb(&dest, key);
            buf_pos += 8;
            dest_i = 0;
        }
    }

    Some(result)
}

// ============================================================
// ============================================================

const QMC2_ENCV2_PREFIX: &[u8] = b"QQMusic EncV2,Key:";
const QMC2_ENCV2_STAGE1_KEY: &[u8] = b"386ZJY!@#*$%^&)(";
const QMC2_ENCV2_STAGE2_KEY: &[u8] = b"**#!(#$%&^a1cZ,T";

fn simple_make_key(seed: u8, size: usize) -> Vec<u8> {
    let mut result = vec![0u8; size];
    for (i, byte) in result.iter_mut().enumerate() {
        let value = (seed as f32) + (i as f32) * 0.1;
        *byte = (100.0 * value.tan().abs()) as u8;
    }
    result
}

fn derive_tea_key(ekey_header: &[u8]) -> [u8; 16] {
    let simple_key_buf = simple_make_key(106, 8);
    let mut tea_key = [0u8; 16];
    for i in (0..16).step_by(2) {
        tea_key[i] = simple_key_buf[i / 2];
        tea_key[i + 1] = ekey_header[i / 2];
    }
    tea_key
}

fn parse_ekey(ekey: &str) -> Result<Vec<u8>, String> {
    let ekey_trimmed = ekey.trim_matches(char::from(0));
    let ekey_decoded = base64::engine::general_purpose::STANDARD
        .decode(ekey_trimmed)
        .map_err(|e| format!("ekey base64 decode error: {}", e))?;

    if ekey_decoded.is_empty() {
        return Err("ekey is empty".to_string());
    }

    let ekey_decoded = if ekey_decoded.starts_with(QMC2_ENCV2_PREFIX) {
        let encv2_blob = &ekey_decoded[QMC2_ENCV2_PREFIX.len()..];
        let stage1_key: &[u8; 16] = QMC2_ENCV2_STAGE1_KEY
            .try_into()
            .map_err(|_| "stage1 key length mismatch")?;
        let encv2_stage1 =
            tc_tea_decrypt(encv2_blob, stage1_key).ok_or("EncV2 stage1 TC-TEA decrypt failed")?;
        let stage2_key: &[u8; 16] = QMC2_ENCV2_STAGE2_KEY
            .try_into()
            .map_err(|_| "stage2 key length mismatch")?;
        let encv2_stage2 = tc_tea_decrypt(&encv2_stage1, stage2_key)
            .ok_or("EncV2 stage2 TC-TEA decrypt failed")?;
        base64::engine::general_purpose::STANDARD
            .decode(&encv2_stage2)
            .map_err(|e| format!("EncV2 inner base64 decode error: {}", e))?
    } else {
        ekey_decoded
    };

    if ekey_decoded.len() < 8 {
        return Err("ekey too short (< 8 bytes)".to_string());
    }

    let (header, body) = ekey_decoded.split_at(8);
    if body.is_empty() {
        return Ok(header.to_vec());
    }

    let tea_key = derive_tea_key(header);
    if let Some(decrypted_body) = tc_tea_decrypt(body, &tea_key) {
        let mut result = Vec::with_capacity(8 + decrypted_body.len());
        result.extend_from_slice(header);
        result.extend_from_slice(&decrypted_body);
        Ok(result)
    } else {
        Ok(ekey_decoded)
    }
}

// ============================================================
// ============================================================

struct Qmc2MapCrypto {
    key: Vec<u8>,
}

impl Qmc2MapCrypto {
    fn new(key: &[u8]) -> Self {
        Self { key: key.to_vec() }
    }

    #[inline]
    fn scramble_by_index(value: u8, index: usize) -> u8 {
        let rotation = ((index as u32).wrapping_add(4)) & 0b111;
        let left = value.wrapping_shl(rotation);
        let right = value.wrapping_shr(rotation);
        left | right
    }

    #[inline]
    fn map_l(&self, offset: usize) -> u8 {
        let mut offset_local = offset;
        if offset_local > 0x7FFF {
            offset_local %= 0x7FFF;
        }
        let index = (offset_local * offset_local + 71214) % self.key.len();
        Self::scramble_by_index(self.key[index], index)
    }

    fn decrypt(&self, offset: usize, buf: &mut [u8]) {
        for (i, byte) in buf.iter_mut().enumerate() {
            *byte ^= self.map_l(offset + i);
        }
    }
}

// ============================================================
// ============================================================

const FIRST_SEGMENT_SIZE: usize = 0x80;
const OTHER_SEGMENT_SIZE: usize = 0x1400;

struct Qmc2Rc4Crypto {
    s: Vec<u8>,
    hash: u32,
    rc4_key: Vec<u8>,
}

impl Qmc2Rc4Crypto {
    fn new(rc4_key: &[u8]) -> Self {
        let n = rc4_key.len();
        let mut s: Vec<u8> = if n <= 256 {
            (0..n as u8).collect()
        } else {
            let mut v: Vec<u8> = (0..=255u8).collect();
            v.extend((0..=255u8).cycle().take(n - 256));
            v
        };

        let mut j = 0usize;
        for i in 0..n {
            j = (j + s[i] as usize + rc4_key[i] as usize) % n;
            s.swap(i, j);
        }

        Self {
            s,
            hash: Self::calc_hash_base(rc4_key),
            rc4_key: rc4_key.to_vec(),
        }
    }

    fn calc_hash_base(data: &[u8]) -> u32 {
        let mut hash: u32 = 1;
        for &value in data.iter() {
            let value = u32::from(value);
            if value == 0 {
                continue;
            }
            let next_hash = hash.wrapping_mul(value);
            if next_hash == 0 || next_hash <= hash {
                break;
            }
            hash = next_hash;
        }
        hash
    }

    #[inline]
    fn calc_segment_key(&self, id: usize, seed: u8) -> usize {
        let dividend = f64::from(self.hash);
        let divisor = ((id + 1) * usize::from(seed)) as f64;
        let key = dividend / divisor * 100.0;
        key as u64 as usize
    }

    #[inline]
    fn rc4_derive(n: usize, s: &mut Vec<u8>, j: &mut usize, k: &mut usize) -> u8 {
        *j = (*j + 1) % n;
        *k = (usize::from(s[*j]) + *k) % n;
        s.swap(*j, *k);
        let index = usize::from(s[*j]) + usize::from(s[*k]);
        s[index % n]
    }

    fn encode_first_segment(&self, offset: usize, buf: &mut [u8]) {
        let n = self.rc4_key.len();
        let mut offset = offset;
        for byte in buf.iter_mut() {
            let key1 = self.rc4_key[offset % n];
            let key2 = self.calc_segment_key(offset, key1);
            *byte ^= self.rc4_key[key2 % n];
            offset += 1;
        }
    }

    fn encode_other_segment(&self, offset: usize, buf: &mut [u8]) {
        let seg_id = offset / OTHER_SEGMENT_SIZE;
        let seg_id_small = seg_id & 0x1FF;
        let mut discard_count = self.calc_segment_key(seg_id, self.rc4_key[seg_id_small]) & 0x1FF;
        discard_count += offset % OTHER_SEGMENT_SIZE;
        let n = self.rc4_key.len();
        let mut s = self.s.clone();
        let mut j = 0usize;
        let mut k = 0usize;
        for _ in 0..discard_count {
            Self::rc4_derive(n, &mut s, &mut j, &mut k);
        }
        for byte in buf.iter_mut() {
            *byte ^= Self::rc4_derive(n, &mut s, &mut j, &mut k);
        }
    }

    fn decrypt(&self, offset: usize, buf: &mut [u8]) {
        let mut offset = offset;
        let mut len = buf.len();
        let mut i = 0usize;

        if offset < FIRST_SEGMENT_SIZE {
            let len_processed = std::cmp::min(len, FIRST_SEGMENT_SIZE - offset);
            self.encode_first_segment(offset, &mut buf[i..i + len_processed]);
            i += len_processed;
            len -= len_processed;
            offset += len_processed;
        }

        let to_align = offset % OTHER_SEGMENT_SIZE;
        if to_align != 0 {
            let len_processed = std::cmp::min(len, OTHER_SEGMENT_SIZE - to_align);
            self.encode_other_segment(offset, &mut buf[i..i + len_processed]);
            i += len_processed;
            len -= len_processed;
            offset += len_processed;
        }

        while len > OTHER_SEGMENT_SIZE {
            self.encode_other_segment(offset, &mut buf[i..i + OTHER_SEGMENT_SIZE]);
            i += OTHER_SEGMENT_SIZE;
            len -= OTHER_SEGMENT_SIZE;
            offset += OTHER_SEGMENT_SIZE;
        }

        if len > 0 {
            self.encode_other_segment(offset, &mut buf[i..i + len]);
        }
    }
}

// ============================================================
// ============================================================

const QMC1_KEY_TABLE: [u8; 64] = [
    0xc3, 0x4a, 0xd6, 0xca, 0x90, 0x67, 0xf7, 0x52, 0xd8, 0xa1, 0x66, 0x62, 0x9f, 0x5b, 0x09, 0x00,
    0xc3, 0x5e, 0x95, 0x23, 0x9f, 0x13, 0x11, 0x7e, 0xd8, 0x92, 0x3f, 0xbc, 0x90, 0xbb, 0x74, 0x0e,
    0xc3, 0x47, 0x74, 0x3d, 0x90, 0xaa, 0x3f, 0x51, 0xd8, 0xf4, 0x11, 0x84, 0x9f, 0xde, 0x95, 0x1d,
    0xc3, 0xc6, 0x09, 0xd5, 0x9f, 0xfa, 0x66, 0xf9, 0xd8, 0xf0, 0xf7, 0xa0, 0x90, 0xa1, 0xd6, 0xf3,
];

#[inline]
fn qmc1_get_mask(offset: usize) -> u8 {
    let index = (offset % 0x7fff) & 0x7f;
    let index = if index > 0x3f {
        (0x80 - index) & 0x3f
    } else {
        index
    };
    QMC1_KEY_TABLE[index]
}

pub fn qmc1_decrypt(data: &mut [u8]) {
    for (i, byte) in data.iter_mut().enumerate() {
        *byte ^= qmc1_get_mask(i);
    }
}

// ============================================================
// ============================================================

#[allow(dead_code)]
enum QmcCryptoInner {
    Map(Qmc2MapCrypto),
    Rc4(Qmc2Rc4Crypto),
    Qmc1,
}

pub struct QmcCrypto {
    inner: QmcCryptoInner,
}

impl QmcCrypto {
    pub fn from_ekey(ekey: &str) -> Result<Self, String> {
        let key = parse_ekey(ekey)?;
        if key.len() > 300 {
            Ok(Self {
                inner: QmcCryptoInner::Rc4(Qmc2Rc4Crypto::new(&key)),
            })
        } else {
            Ok(Self {
                inner: QmcCryptoInner::Map(Qmc2MapCrypto::new(&key)),
            })
        }
    }

    #[allow(dead_code)]
    pub fn qmc1() -> Self {
        Self {
            inner: QmcCryptoInner::Qmc1,
        }
    }

    pub fn decrypt(&self, offset: usize, buf: &mut [u8]) {
        match &self.inner {
            QmcCryptoInner::Map(c) => c.decrypt(offset, buf),
            QmcCryptoInner::Rc4(c) => c.decrypt(offset, buf),
            QmcCryptoInner::Qmc1 => {
                for (i, byte) in buf.iter_mut().enumerate() {
                    *byte ^= qmc1_get_mask(offset + i);
                }
            }
        }
    }
}

// ============================================================
// ============================================================

pub struct QmcDecryptReader<R> {
    inner: R,
    crypto: QmcCrypto,
    pos: u64,
}

impl<R: Read + Seek> QmcDecryptReader<R> {
    pub fn new(inner: R, crypto: QmcCrypto) -> Self {
        Self {
            inner,
            crypto,
            pos: 0,
        }
    }
}

impl<R: Read + Seek> Read for QmcDecryptReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.crypto.decrypt(self.pos as usize, &mut buf[..n]);
            self.pos += n as u64;
        }
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for QmcDecryptReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let new_pos = self.inner.seek(pos)?;
        self.pos = new_pos;
        Ok(new_pos)
    }
}

// ============================================================
// ============================================================

pub fn detect_qmc_crypto(path: &Path) -> Option<QmcCrypto> {
    let mut file = File::open(path).ok()?;

    let mut header = [0u8; 16];
    if file.read_exact(&mut header).is_err() {
        return None;
    }
    if is_valid_audio_header(&header) {
        return None;
    }

    if let Some(ekey) = extract_ekey_from_file_tail(&mut file) {
        if let Ok(crypto) = QmcCrypto::from_ekey(&ekey) {
            return Some(crypto);
        }
    }

    let mut probe = header;
    qmc1_decrypt(&mut probe);
    if is_valid_audio_header(&probe) {
        return Some(QmcCrypto::qmc1());
    }

    None
}

fn extract_ekey_from_file_tail(file: &mut File) -> Option<String> {
    use std::io::Seek;
    let file_size = file.seek(SeekFrom::End(0)).ok()?;
    let tail_size = file_size.min(4096) as usize;
    file.seek(SeekFrom::Start(file_size - tail_size as u64))
        .ok()?;
    let mut tail = vec![0u8; tail_size];
    file.read_exact(&mut tail).ok()?;
    extract_ekey_from_footer(&tail)
}

// ============================================================
// ============================================================

#[allow(dead_code)]
pub fn extract_ekey_from_footer(data: &[u8]) -> Option<String> {
    if data.len() < 8 {
        return None;
    }

    let tail = &data[data.len().saturating_sub(1024)..];

    if let Some(pos) = find_subslice(tail, b"QTag") {
        let tag_start = data.len() - tail.len() + pos;
        if tag_start >= 4 {
            let key_size = u32::from_le_bytes([
                data[tag_start - 4],
                data[tag_start - 3],
                data[tag_start - 2],
                data[tag_start - 1],
            ]) as usize;
            let ekey_start = tag_start.saturating_sub(4 + key_size);
            if ekey_start < tag_start - 4 {
                let ekey_bytes = &data[ekey_start..tag_start - 4];
                if let Some(csv_end) = find_subslice(ekey_bytes, b",") {
                    return Some(String::from_utf8_lossy(&ekey_bytes[..csv_end]).to_string());
                }
                return Some(String::from_utf8_lossy(ekey_bytes).to_string());
            }
        }
    }

    let last_4 = &data[data.len() - 4..];
    let key_size = u32::from_le_bytes([last_4[0], last_4[1], last_4[2], last_4[3]]) as usize;
    if key_size >= 32 && key_size <= 2048 && data.len() >= 4 + key_size {
        let ekey_bytes = &data[data.len() - 4 - key_size..data.len() - 4];
        let ekey_str = String::from_utf8_lossy(ekey_bytes).to_string();
        if ekey_str
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=' || c == '\0')
        {
            return Some(ekey_str.trim_matches(char::from(0)).to_string());
        }
    }

    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn is_valid_audio_header(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    if &bytes[..3] == b"ID3" {
        return true;
    }
    if bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
        return true;
    }
    if &bytes[..4] == b"fLaC" {
        return true;
    }
    if &bytes[..4] == b"RIFF" {
        return true;
    }
    if &bytes[..4] == b"OggS" {
        return true;
    }
    if &bytes[..4] == b"FORM" {
        return true;
    }
    if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_make_key() {
        let result = simple_make_key(106, 8);
        assert_eq!(result, vec![0x69, 0x56, 0x46, 0x38, 0x2b, 0x20, 0x15, 0x0b]);
    }

    #[test]
    fn test_derive_tea_key() {
        let ekey_header = [0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8];
        let tea_key = derive_tea_key(&ekey_header);
        assert_eq!(
            tea_key,
            [
                0x69, 0xf1, 0x56, 0xf2, 0x46, 0xf3, 0x38, 0xf4, 0x2b, 0xf5, 0x20, 0xf6, 0x15, 0xf7,
                0x0b, 0xf8
            ]
        );
    }

    #[test]
    fn test_qmc1_decrypt_reversible() {
        let original = b"Hello, World! This is a test of QMC1 decryption.";
        let mut data = original.to_vec();
        qmc1_decrypt(&mut data);
        assert_ne!(&data[..], &original[..]);
        qmc1_decrypt(&mut data);
        assert_eq!(&data[..], &original[..]);
    }

    #[test]
    fn test_qmc1_first_mask() {
        assert_eq!(qmc1_get_mask(0), 0xC3);
        assert_eq!(qmc1_get_mask(1), 0x4A);
    }

    #[test]
    fn test_qmc2_map_scramble() {
        let key = [
            0x41u8, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E,
            0x4F, 0x50,
        ];
        let crypto = Qmc2MapCrypto::new(&key);
        let mut data = [0u8; 16];
        crypto.decrypt(0, &mut data);
        assert_eq!(
            data,
            [
                0x3F, 0x8A, 0xC1, 0x49, 0x3F, 0x49, 0xC1, 0x8A, 0x3F, 0x8A, 0xC1, 0x49, 0x3F, 0x49,
                0xC1, 0x8A
            ]
        );
    }

    #[test]
    fn test_rc4_hash_base() {
        let hash = Qmc2Rc4Crypto::calc_hash_base(&[1u8, 99]);
        assert_eq!(hash, 1);
    }
}
