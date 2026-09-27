// 控制通道帧协议：与移动端腕表链路（XianYu-Music-Mobile lib/src/watch_link/protocol.dart）
// 逐字节同构的 Rust 复刻，仅实现本通道实际用到的能力：
// - 编码：单帧（本通道各帧均 <4KB，无 chunk 分片需求）
// - 解码：magic 重同步 + CRC 校验 + chunk 跳过 + 未知类型跳过
// 帧布局：magic[0..4] + ver@4 + type@5 + seq:u16BE@6 + len:u32BE@8 + crc16:u16BE@12 + payload。
// CRC16-CCITT-FALSE（初值 0xFFFF、多项式 0x1021、MSB-first），
// 计算范围为 frame[4..末尾] 且 crc 字段自身两字节置零（与 Dart 编/解码两侧一致）。

pub const FRAME_MAGIC: [u8; 4] = [0x58, 0x59, 0x57, 0x31]; // "XYW1"
pub const PROTOCOL_VERSION: u8 = 1;
pub const HEADER_BYTES: usize = 14;
pub const MAX_PAYLOAD_BYTES: usize = 4 * 1024;

pub const MSG_HELLO: u8 = 0x01;
pub const MSG_BYE: u8 = 0x02;
pub const MSG_PING: u8 = 0x03;
pub const MSG_PONG: u8 = 0x04;
pub const MSG_STATE: u8 = 0x10;
pub const MSG_NOW_PLAYING: u8 = 0x11;
pub const MSG_POSITION: u8 = 0x12;
pub const MSG_CMD: u8 = 0x20;
pub const MSG_CHUNK: u8 = 0x30;

/// 与 Dart LinkMsgType.known() 对齐的已知类型全集；未知类型解码时丢弃。
pub fn is_known_type(t: u8) -> bool {
    matches!(
        t,
        MSG_HELLO
            | MSG_BYE
            | MSG_PING
            | MSG_PONG
            | MSG_STATE
            | MSG_NOW_PLAYING
            | MSG_POSITION
            | 0x13 // lyric
            | 0x14 // precache
            | MSG_CMD
            | 0x21 // backupFile
            | 0x22 // backupAck
            | 0x23 // watchLogFile
            | 0x24 // effects
            | MSG_CHUNK
            | 0x41 // cloudBind
    )
}

pub fn crc16_ccitt_false(bytes: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in bytes {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub msg_type: u8,
    pub seq: u16,
    /// JSON 文本载荷
    pub payload: String,
}

pub fn encode_frame(msg_type: u8, seq: u16, payload: &str) -> Vec<u8> {
    let json = payload.as_bytes();
    assert!(
        json.len() <= MAX_PAYLOAD_BYTES,
        "payload too large: {}",
        json.len()
    );
    let mut frame = vec![0u8; HEADER_BYTES + json.len()];
    frame[0..4].copy_from_slice(&FRAME_MAGIC);
    frame[4] = PROTOCOL_VERSION;
    frame[5] = msg_type;
    frame[6..8].copy_from_slice(&seq.to_be_bytes());
    frame[8..12].copy_from_slice(&(json.len() as u32).to_be_bytes());
    frame[HEADER_BYTES..].copy_from_slice(json);
    let crc = crc16_ccitt_false(&frame[4..]);
    frame[12..14].copy_from_slice(&crc.to_be_bytes());
    frame
}

/// 流式帧解码器：feed 任意切片，输出完整合法帧。
/// chunk 帧仅消费不重组（本通道无 >4KB 帧）；CRC 不合法或类型未知的帧被静默丢弃。
pub struct FrameDecoder {
    buf: Vec<u8>,
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Frame> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let magic_idx = find_magic(&self.buf);
            let Some(idx) = magic_idx else {
                // 无 magic：仅保留末尾 3 字节（可能是不完整 magic 前缀）
                let keep = self.buf.len().min(3);
                let start = self.buf.len() - keep;
                self.buf.drain(..start);
                break;
            };
            if idx > 0 {
                self.buf.drain(..idx);
                continue;
            }
            if self.buf.len() < HEADER_BYTES {
                break;
            }
            let len = u32::from_be_bytes([
                self.buf[8],
                self.buf[9],
                self.buf[10],
                self.buf[11],
            ]) as usize;
            if len > MAX_PAYLOAD_BYTES {
                // 非法长度：丢弃当前 magic，按后续字节重新同步
                self.buf.drain(..4);
                continue;
            }
            let frame_len = HEADER_BYTES + len;
            if self.buf.len() < frame_len {
                break;
            }
            let frame: Vec<u8> = self.buf.drain(..frame_len).collect();
            if let Some(f) = decode_one(&frame) {
                // chunk 帧本通道不支持重组，直接跳过
                if f.msg_type != MSG_CHUNK {
                    out.push(f);
                }
            }
        }
        out
    }
}

fn decode_one(frame: &[u8]) -> Option<Frame> {
    let msg_type = frame[5];
    let len = u32::from_be_bytes([frame[8], frame[9], frame[10], frame[11]]) as usize;
    let expect_crc = u16::from_be_bytes([frame[12], frame[13]]);
    // CRC 计算时 crc 字段自身置零（对应 Dart 解码侧 check[8]=check[9]=0）
    let mut check = Vec::with_capacity(frame.len() - 4);
    check.extend_from_slice(&frame[4..]);
    check[8] = 0;
    check[9] = 0;
    if crc16_ccitt_false(&check) != expect_crc {
        return None;
    }
    if !is_known_type(msg_type) {
        return None;
    }
    let payload = std::str::from_utf8(&frame[HEADER_BYTES..HEADER_BYTES + len]).ok()?;
    Some(Frame {
        msg_type,
        seq: u16::from_be_bytes([frame[6], frame[7]]),
        payload: payload.to_string(),
    })
}

fn find_magic(d: &[u8]) -> Option<usize> {
    if d.len() < 4 {
        return None;
    }
    (0..=d.len() - 4).find(|&i| d[i..i + 4] == FRAME_MAGIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CRC16-CCITT-FALSE 标准校验向量。
    #[test]
    fn crc_standard_vector() {
        assert_eq!(crc16_ccitt_false(b"123456789"), 0x29B1);
        assert_eq!(crc16_ccitt_false(b""), 0xFFFF); // 仅初值
    }

    /// 与移动端 Dart 实现的互操作向量：由 node 按 Dart 算法
    /// （lib/src/watch_link/protocol.dart _encodeOne）生成的 hello 帧字节。
    #[test]
    fn interop_dart_encoded_hello_frame() {
        // payload: {"ver":1,"role":"remote","name":"手机"}，seq=7
        let hex = "58595731010100070000002924247b22766572223a312c22726f6c65223a2272656d6f7465222c226e616d65223a22e6898be69cba227d";
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        let mut dec = FrameDecoder::new();
        let frames = dec.feed(&bytes);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].msg_type, MSG_HELLO);
        assert_eq!(frames[0].seq, 7);
        assert_eq!(
            frames[0].payload,
            "{\"ver\":1,\"role\":\"remote\",\"name\":\"手机\"}"
        );
    }

    #[test]
    fn encode_decode_roundtrip() {
        let payload = r#"{"action":"seek","arg":{"pos":12.5}}"#;
        let frame = encode_frame(MSG_CMD, 42, payload);
        let mut dec = FrameDecoder::new();
        // 分两次喂入验证流式拼接
        let mut out = dec.feed(&frame[..10]);
        out.extend(dec.feed(&frame[10..]));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].msg_type, MSG_CMD);
        assert_eq!(out[0].seq, 42);
        assert_eq!(out[0].payload, payload);
    }

    #[test]
    fn decoder_resyncs_on_garbage_prefix() {
        let frame = encode_frame(MSG_PING, 1, r#"{"t":1}"#);
        let mut bytes = vec![0xAA, 0xBB, 0xCC];
        bytes.extend_from_slice(&frame);
        bytes.extend_from_slice(&[0x00, 0x00]);
        let mut dec = FrameDecoder::new();
        let out = dec.feed(&bytes);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].msg_type, MSG_PING);
    }

    #[test]
    fn decoder_drops_corrupt_crc_but_continues() {
        let mut frame = encode_frame(MSG_PING, 1, r#"{"t":1}"#);
        frame[14] ^= 0xFF; // 破坏 payload → CRC 不匹配
        let good = encode_frame(MSG_PING, 2, r#"{"t":2}"#);
        let mut bytes = frame;
        bytes.extend_from_slice(&good);
        let mut dec = FrameDecoder::new();
        let out = dec.feed(&bytes);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].seq, 2);
    }

    #[test]
    fn decoder_skips_chunk_frames() {
        let chunk = encode_frame(MSG_CHUNK, 1, r#"{"cid":1,"total":2,"idx":0,"type":32,"data":"x"}"#);
        let good = encode_frame(MSG_STATE, 2, r#"{"isPlaying":true}"#);
        let mut bytes = chunk;
        bytes.extend_from_slice(&good);
        let mut dec = FrameDecoder::new();
        let out = dec.feed(&bytes);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].msg_type, MSG_STATE);
    }

    #[test]
    fn decoder_handles_fragmented_feed() {
        let frame = encode_frame(MSG_PING, 1, r#"{"t":1}"#);
        let mut dec = FrameDecoder::new();
        // 不完整 magic（2 字节）
        assert!(dec.feed(&frame[..2]).is_empty());
        // magic 齐了但头不足 14 字节
        assert!(dec.feed(&frame[2..6]).is_empty());
        // 补齐剩余字节后完整解出
        let out = dec.feed(&frame[6..]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].msg_type, MSG_PING);
        // 帧后残留不完整 magic 前缀：保留等待后续数据，不 panic 不丢帧
        assert!(dec.feed(&[0x58, 0x59]).is_empty());
    }
}
