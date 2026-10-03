use base64::Engine;
use regex::Regex;
use std::sync::OnceLock;

use super::common::{
    decompress_deflate_to_bytes, decompress_gzip_to_bytes, decompress_zlib_sync_flush,
    decompress_zlib_to_bytes, decompress_zlib_to_bytes_skip_header, hex_to_bytes, http_fetch_text,
    ms_format, pad_base64, LyricResult, LyricSongInfo,
};

// ==================== Regex caches (module-level, compiled once) ====================
static TX_LYRIC_CONTENT_OPEN_RE: OnceLock<Regex> = OnceLock::new();
static TX_LYRIC_CONTENT_CLOSE_RE: OnceLock<Regex> = OnceLock::new();
static TX_LINE_TIME_RE: OnceLock<Regex> = OnceLock::new();
static TX_LINE_TIME2_RE: OnceLock<Regex> = OnceLock::new();
static TX_WORD_TIME_GROUP_RE: OnceLock<Regex> = OnceLock::new();
static TX_WORD_TIME_RE: OnceLock<Regex> = OnceLock::new();
static TX_WORD_EXTRACT_RE: OnceLock<Regex> = OnceLock::new();

// ==================== QRC 解密（腾讯非标准 3DES + zlib inflate）====================

const QRC_SBOX: [[u8; 64]; 8] = [
    [
        14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12,
        11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9,
        1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
    ],
    [
        15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1,
        10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15,
        4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
    ],
    [
        10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5,
        14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6,
        9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
    ],
    [
        7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2,
        12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10,
        10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
    ],
    [
        2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15,
        10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14,
        2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
    ],
    [
        12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13,
        14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5,
        15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
    ],
    [
        4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5,
        12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4,
        10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
    ],
    [
        13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6,
        11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10,
        8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
    ],
];

const QRC_KEY_RND_SHIFT: [u32; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const QRC_KEY_PERM_C: [u32; 28] = [
    56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59,
    51, 43, 35,
];
const QRC_KEY_PERM_D: [u32; 28] = [
    62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4,
    27, 19, 11, 3,
];
const QRC_KEY_COMPRESSION: [u32; 48] = [
    13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51,
    30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];
// QQ 客户端三把自定义 DES 密钥（移植自 BakaMusic lyric-decrypt.ts，同源于
// MusicFree 移动端 customDES.ts；16 字节写法中仅前 8 字节参与 DES 位寻址）
const QRC_KEY1: &[u8; 8] = b"!@#)(NHL";
const QRC_KEY2: &[u8; 8] = b"123ZXC!@";
const QRC_KEY3: &[u8; 8] = b"!@#)(*$%";

type QrcSchedule = [[u8; 6]; 16];

fn qrc_bitnum(a: &[u8], b: u32, c: u32) -> u32 {
    let idx = ((b / 32) * 4 + 3 - ((b % 32) / 8)) as usize;
    (((a[idx] >> (7 - (b % 8))) & 1) as u32) << c
}

fn qrc_bitnum_intr(a: u32, b: u32, c: u32) -> u32 {
    (((a >> (31 - b)) & 1) as u32) << c
}

fn qrc_bitnum_intl(a: u32, b: u32, c: u32) -> u32 {
    (a.wrapping_shl(b) & 0x8000_0000) >> c
}

fn qrc_sbox_bit(a: u8) -> usize {
    ((a & 32) | ((a & 31) >> 1) | ((a & 1) << 4)) as usize
}

fn qrc_initial_permutation(input: &[u8]) -> (u32, u32) {
    let s0 = qrc_bitnum(input, 57, 31)
        | qrc_bitnum(input, 49, 30)
        | qrc_bitnum(input, 41, 29)
        | qrc_bitnum(input, 33, 28)
        | qrc_bitnum(input, 25, 27)
        | qrc_bitnum(input, 17, 26)
        | qrc_bitnum(input, 9, 25)
        | qrc_bitnum(input, 1, 24)
        | qrc_bitnum(input, 59, 23)
        | qrc_bitnum(input, 51, 22)
        | qrc_bitnum(input, 43, 21)
        | qrc_bitnum(input, 35, 20)
        | qrc_bitnum(input, 27, 19)
        | qrc_bitnum(input, 19, 18)
        | qrc_bitnum(input, 11, 17)
        | qrc_bitnum(input, 3, 16)
        | qrc_bitnum(input, 61, 15)
        | qrc_bitnum(input, 53, 14)
        | qrc_bitnum(input, 45, 13)
        | qrc_bitnum(input, 37, 12)
        | qrc_bitnum(input, 29, 11)
        | qrc_bitnum(input, 21, 10)
        | qrc_bitnum(input, 13, 9)
        | qrc_bitnum(input, 5, 8)
        | qrc_bitnum(input, 63, 7)
        | qrc_bitnum(input, 55, 6)
        | qrc_bitnum(input, 47, 5)
        | qrc_bitnum(input, 39, 4)
        | qrc_bitnum(input, 31, 3)
        | qrc_bitnum(input, 23, 2)
        | qrc_bitnum(input, 15, 1)
        | qrc_bitnum(input, 7, 0);
    let s1 = qrc_bitnum(input, 56, 31)
        | qrc_bitnum(input, 48, 30)
        | qrc_bitnum(input, 40, 29)
        | qrc_bitnum(input, 32, 28)
        | qrc_bitnum(input, 24, 27)
        | qrc_bitnum(input, 16, 26)
        | qrc_bitnum(input, 8, 25)
        | qrc_bitnum(input, 0, 24)
        | qrc_bitnum(input, 58, 23)
        | qrc_bitnum(input, 50, 22)
        | qrc_bitnum(input, 42, 21)
        | qrc_bitnum(input, 34, 20)
        | qrc_bitnum(input, 26, 19)
        | qrc_bitnum(input, 18, 18)
        | qrc_bitnum(input, 10, 17)
        | qrc_bitnum(input, 2, 16)
        | qrc_bitnum(input, 60, 15)
        | qrc_bitnum(input, 52, 14)
        | qrc_bitnum(input, 44, 13)
        | qrc_bitnum(input, 36, 12)
        | qrc_bitnum(input, 28, 11)
        | qrc_bitnum(input, 20, 10)
        | qrc_bitnum(input, 12, 9)
        | qrc_bitnum(input, 4, 8)
        | qrc_bitnum(input, 62, 7)
        | qrc_bitnum(input, 54, 6)
        | qrc_bitnum(input, 46, 5)
        | qrc_bitnum(input, 38, 4)
        | qrc_bitnum(input, 30, 3)
        | qrc_bitnum(input, 22, 2)
        | qrc_bitnum(input, 14, 1)
        | qrc_bitnum(input, 6, 0);
    (s0, s1)
}

fn qrc_inverse_permutation(s0: u32, s1: u32, out: &mut [u8]) {
    out[3] = (qrc_bitnum_intr(s1, 7, 7)
        | qrc_bitnum_intr(s0, 7, 6)
        | qrc_bitnum_intr(s1, 15, 5)
        | qrc_bitnum_intr(s0, 15, 4)
        | qrc_bitnum_intr(s1, 23, 3)
        | qrc_bitnum_intr(s0, 23, 2)
        | qrc_bitnum_intr(s1, 31, 1)
        | qrc_bitnum_intr(s0, 31, 0)) as u8;
    out[2] = (qrc_bitnum_intr(s1, 6, 7)
        | qrc_bitnum_intr(s0, 6, 6)
        | qrc_bitnum_intr(s1, 14, 5)
        | qrc_bitnum_intr(s0, 14, 4)
        | qrc_bitnum_intr(s1, 22, 3)
        | qrc_bitnum_intr(s0, 22, 2)
        | qrc_bitnum_intr(s1, 30, 1)
        | qrc_bitnum_intr(s0, 30, 0)) as u8;
    out[1] = (qrc_bitnum_intr(s1, 5, 7)
        | qrc_bitnum_intr(s0, 5, 6)
        | qrc_bitnum_intr(s1, 13, 5)
        | qrc_bitnum_intr(s0, 13, 4)
        | qrc_bitnum_intr(s1, 21, 3)
        | qrc_bitnum_intr(s0, 21, 2)
        | qrc_bitnum_intr(s1, 29, 1)
        | qrc_bitnum_intr(s0, 29, 0)) as u8;
    out[0] = (qrc_bitnum_intr(s1, 4, 7)
        | qrc_bitnum_intr(s0, 4, 6)
        | qrc_bitnum_intr(s1, 12, 5)
        | qrc_bitnum_intr(s0, 12, 4)
        | qrc_bitnum_intr(s1, 20, 3)
        | qrc_bitnum_intr(s0, 20, 2)
        | qrc_bitnum_intr(s1, 28, 1)
        | qrc_bitnum_intr(s0, 28, 0)) as u8;
    out[7] = (qrc_bitnum_intr(s1, 3, 7)
        | qrc_bitnum_intr(s0, 3, 6)
        | qrc_bitnum_intr(s1, 11, 5)
        | qrc_bitnum_intr(s0, 11, 4)
        | qrc_bitnum_intr(s1, 19, 3)
        | qrc_bitnum_intr(s0, 19, 2)
        | qrc_bitnum_intr(s1, 27, 1)
        | qrc_bitnum_intr(s0, 27, 0)) as u8;
    out[6] = (qrc_bitnum_intr(s1, 2, 7)
        | qrc_bitnum_intr(s0, 2, 6)
        | qrc_bitnum_intr(s1, 10, 5)
        | qrc_bitnum_intr(s0, 10, 4)
        | qrc_bitnum_intr(s1, 18, 3)
        | qrc_bitnum_intr(s0, 18, 2)
        | qrc_bitnum_intr(s1, 26, 1)
        | qrc_bitnum_intr(s0, 26, 0)) as u8;
    out[5] = (qrc_bitnum_intr(s1, 1, 7)
        | qrc_bitnum_intr(s0, 1, 6)
        | qrc_bitnum_intr(s1, 9, 5)
        | qrc_bitnum_intr(s0, 9, 4)
        | qrc_bitnum_intr(s1, 17, 3)
        | qrc_bitnum_intr(s0, 17, 2)
        | qrc_bitnum_intr(s1, 25, 1)
        | qrc_bitnum_intr(s0, 25, 0)) as u8;
    out[4] = (qrc_bitnum_intr(s1, 0, 7)
        | qrc_bitnum_intr(s0, 0, 6)
        | qrc_bitnum_intr(s1, 8, 5)
        | qrc_bitnum_intr(s0, 8, 4)
        | qrc_bitnum_intr(s1, 16, 3)
        | qrc_bitnum_intr(s0, 16, 2)
        | qrc_bitnum_intr(s1, 24, 1)
        | qrc_bitnum_intr(s0, 24, 0)) as u8;
}

fn qrc_des_f(state: u32, key: &[u8]) -> u32 {
    let t1 = qrc_bitnum_intl(state, 31, 0)
        | ((state & 0xF0000000) >> 1)
        | qrc_bitnum_intl(state, 4, 5)
        | qrc_bitnum_intl(state, 3, 6)
        | ((state & 0x0F000000) >> 3)
        | qrc_bitnum_intl(state, 8, 11)
        | qrc_bitnum_intl(state, 7, 12)
        | ((state & 0x00F00000) >> 5)
        | qrc_bitnum_intl(state, 12, 17)
        | qrc_bitnum_intl(state, 11, 18)
        | ((state & 0x000F0000) >> 7)
        | qrc_bitnum_intl(state, 16, 23);
    let t2 = qrc_bitnum_intl(state, 15, 0)
        | (state & 0x0000F000) << 15
        | qrc_bitnum_intl(state, 20, 5)
        | qrc_bitnum_intl(state, 19, 6)
        | (state & 0x00000F00) << 13
        | qrc_bitnum_intl(state, 24, 11)
        | qrc_bitnum_intl(state, 23, 12)
        | (state & 0x000000F0) << 11
        | qrc_bitnum_intl(state, 28, 17)
        | qrc_bitnum_intl(state, 27, 18)
        | (state & 0x0000000F) << 9
        | qrc_bitnum_intl(state, 0, 23);
    let mut lrgstate = [
        ((t1 >> 24) & 0xFF) as u8,
        ((t1 >> 16) & 0xFF) as u8,
        ((t1 >> 8) & 0xFF) as u8,
        ((t2 >> 24) & 0xFF) as u8,
        ((t2 >> 16) & 0xFF) as u8,
        ((t2 >> 8) & 0xFF) as u8,
    ];
    for i in 0..6 {
        lrgstate[i] ^= key[i];
    }
    let s = (QRC_SBOX[0][qrc_sbox_bit(lrgstate[0] >> 2)] as u32) << 28
        | (QRC_SBOX[1][qrc_sbox_bit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4))] as u32)
            << 24
        | (QRC_SBOX[2][qrc_sbox_bit(((lrgstate[1] & 0x0F) << 2) | (lrgstate[2] >> 6))] as u32)
            << 20
        | (QRC_SBOX[3][qrc_sbox_bit(lrgstate[2] & 0x3F)] as u32) << 16
        | (QRC_SBOX[4][qrc_sbox_bit(lrgstate[3] >> 2)] as u32) << 12
        | (QRC_SBOX[5][qrc_sbox_bit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4))] as u32) << 8
        | (QRC_SBOX[6][qrc_sbox_bit(((lrgstate[4] & 0x0F) << 2) | (lrgstate[5] >> 6))] as u32) << 4
        | QRC_SBOX[7][qrc_sbox_bit(lrgstate[5] & 0x3F)] as u32;
    qrc_bitnum_intl(s, 15, 0)
        | qrc_bitnum_intl(s, 6, 1)
        | qrc_bitnum_intl(s, 19, 2)
        | qrc_bitnum_intl(s, 20, 3)
        | qrc_bitnum_intl(s, 28, 4)
        | qrc_bitnum_intl(s, 11, 5)
        | qrc_bitnum_intl(s, 27, 6)
        | qrc_bitnum_intl(s, 16, 7)
        | qrc_bitnum_intl(s, 0, 8)
        | qrc_bitnum_intl(s, 14, 9)
        | qrc_bitnum_intl(s, 22, 10)
        | qrc_bitnum_intl(s, 25, 11)
        | qrc_bitnum_intl(s, 4, 12)
        | qrc_bitnum_intl(s, 17, 13)
        | qrc_bitnum_intl(s, 30, 14)
        | qrc_bitnum_intl(s, 9, 15)
        | qrc_bitnum_intl(s, 1, 16)
        | qrc_bitnum_intl(s, 7, 17)
        | qrc_bitnum_intl(s, 23, 18)
        | qrc_bitnum_intl(s, 13, 19)
        | qrc_bitnum_intl(s, 31, 20)
        | qrc_bitnum_intl(s, 26, 21)
        | qrc_bitnum_intl(s, 2, 22)
        | qrc_bitnum_intl(s, 8, 23)
        | qrc_bitnum_intl(s, 18, 24)
        | qrc_bitnum_intl(s, 12, 25)
        | qrc_bitnum_intl(s, 29, 26)
        | qrc_bitnum_intl(s, 5, 27)
        | qrc_bitnum_intl(s, 21, 28)
        | qrc_bitnum_intl(s, 10, 29)
        | qrc_bitnum_intl(s, 3, 30)
        | qrc_bitnum_intl(s, 24, 31)
}

fn qrc_des_crypt(input: &[u8], schedule: &QrcSchedule, output: &mut [u8]) {
    let (mut s0, mut s1) = qrc_initial_permutation(input);
    for i in 0..15 {
        let prev = s1;
        s1 = qrc_des_f(s1, &schedule[i]) ^ s0;
        s0 = prev;
    }
    s0 = qrc_des_f(s1, &schedule[15]) ^ s0;
    qrc_inverse_permutation(s0, s1, output);
}

fn qrc_key_schedule(key: &[u8], decrypt: bool) -> QrcSchedule {
    let mut schedule = [[0u8; 6]; 16];
    let mut c: u32 = 0;
    let mut d: u32 = 0;
    for i in 0..28 {
        c |= qrc_bitnum(key, QRC_KEY_PERM_C[i], 31 - i as u32);
        d |= qrc_bitnum(key, QRC_KEY_PERM_D[i], 31 - i as u32);
    }
    for i in 0..16 {
        let shift = QRC_KEY_RND_SHIFT[i];
        c = (((c << shift) | (c >> (28 - shift))) & 0xFFFF_FFF0) as u32;
        d = (((d << shift) | (d >> (28 - shift))) & 0xFFFF_FFF0) as u32;
        let togen = if decrypt { 15 - i } else { i };
        for j in 0..24 {
            schedule[togen][(j / 8) as usize] |=
                (qrc_bitnum_intr(c, QRC_KEY_COMPRESSION[j], 7 - (j % 8) as u32)) as u8;
        }
        for j in 24..48 {
            schedule[togen][(j / 8) as usize] |=
                (qrc_bitnum_intr(d, QRC_KEY_COMPRESSION[j] - 27, 7 - (j % 8) as u32)) as u8;
        }
    }
    schedule
}

/// 三段自定义 DES 密钥调度（D(KEY1) -> E(KEY2) -> D(KEY3)，与 BakaMusic 一致）
fn qrc_tripledes_key_setup() -> [QrcSchedule; 3] {
    [
        qrc_key_schedule(QRC_KEY1, true),
        qrc_key_schedule(QRC_KEY2, false),
        qrc_key_schedule(QRC_KEY3, true),
    ]
}

fn qrc_tripledes_crypt(input: &[u8], schedule: &[QrcSchedule; 3], output: &mut [u8]) {
    let mut buf = [0u8; 8];
    qrc_des_crypt(input, &schedule[0], &mut buf);
    qrc_des_crypt(&buf, &schedule[1], output);
    qrc_des_crypt(output, &schedule[2], &mut buf);
    output.copy_from_slice(&buf);
}

/// 解密插件返回的加密歌词密文（QQ QRC，三段自定义 DES+zlib 压缩包 hex）。
/// Baka 系 musicfree 插件 getLyric 的注释即声明「由应用层解密」——与移动端/
/// 腕上端一致，前端在密文检测命中后直接调本命令解密复用（三端后端同一实现）。
#[tauri::command]
pub async fn decrypt_plugin_lyric(encrypted_hex: String) -> Result<String, String> {
    qrc_decrypt(&encrypted_hex)
}

fn qrc_decrypt(encrypted_hex: &str) -> Result<String, String> {
    let encrypted_hex = encrypted_hex.trim();
    if encrypted_hex.is_empty() || encrypted_hex.len() % 2 != 0 {
        return Err("Invalid hex data".to_string());
    }
    let mut encrypted = hex_to_bytes(encrypted_hex);
    if encrypted.is_empty() {
        return Err("No data to decrypt".to_string());
    }
    let schedule = qrc_tripledes_key_setup();
    let mut block = [0u8; 8];
    let mut i = 0;
    while i + 8 <= encrypted.len() {
        qrc_tripledes_crypt(&encrypted[i..i + 8], &schedule, &mut block);
        encrypted[i..i + 8].copy_from_slice(&block);
        i += 8;
    }

    // 解压：正确密钥下产物为标准 zlib 流（BakaMusic 用 pako.inflate），
    // 保留多格式尝试兜底老变体
    for attempt in [
        decompress_zlib_to_bytes(&encrypted),
        decompress_zlib_sync_flush(&encrypted),
        decompress_deflate_to_bytes(&encrypted),
        decompress_zlib_to_bytes_skip_header(&encrypted),
        decompress_gzip_to_bytes(&encrypted),
    ] {
        if let Ok(bytes) = attempt {
            if !bytes.is_empty() {
                return String::from_utf8(bytes).map_err(|e| e.to_string());
            }
        }
    }
    Err("decompression failed".to_string())
}

// ==================== TX (QQ Music) Lyric Fetching ====================

fn tx_remove_tag(s: &str) -> String {
    let re1 =
        TX_LYRIC_CONTENT_OPEN_RE.get_or_init(|| Regex::new(r#"^[\S\s]*?LyricContent=""#).unwrap());
    let re2 = TX_LYRIC_CONTENT_CLOSE_RE.get_or_init(|| Regex::new(r#""/>[\S\s]*$"#).unwrap());
    re2.replace_all(&re1.replace_all(s, ""), "").to_string()
}

fn tx_parse_lyric(lrc: &str) -> (String, String) {
    let lrc = lrc.trim().replace('\r', "");
    if lrc.is_empty() {
        return (String::new(), String::new());
    }

    let line_time_re = TX_LINE_TIME_RE.get_or_init(|| Regex::new(r"^\[(\d+),\d+]").unwrap());
    let line_time2_re = TX_LINE_TIME2_RE.get_or_init(|| Regex::new(r"^\[([\d:.]+)]").unwrap());
    let word_time_all_re =
        TX_WORD_TIME_GROUP_RE.get_or_init(|| Regex::new(r"(\(\d+,\d+\))").unwrap());
    let word_time_re = TX_WORD_TIME_RE.get_or_init(|| Regex::new(r"\(\d+,\d+\)").unwrap());
    let word_extract_re =
        TX_WORD_EXTRACT_RE.get_or_init(|| Regex::new(r"\((\d+),(\d+)\)").unwrap());

    let mut lxlrc_lines: Vec<String> = Vec::new();
    let mut lrc_lines: Vec<String> = Vec::new();

    for raw_line in lrc.split('\n') {
        let line = raw_line.trim();
        if let Some(caps) = line_time_re.captures(line) {
            let start_ms: u64 = caps[1].parse().unwrap_or(0);
            let start_str = ms_format(start_ms);
            if start_str.is_empty() {
                continue;
            }
            let words = line_time_re.replace(line, "");
            lrc_lines.push(format!(
                "{}{}",
                start_str,
                word_time_all_re.replace_all(&words, "")
            ));

            let times: Vec<String> = word_time_all_re
                .captures_iter(&words)
                .filter_map(|c| {
                    let inner = &c[0];
                    if let Some(m) = word_extract_re.captures(inner) {
                        let t1: u64 = m[1].parse().unwrap_or(0);
                        let t2: u64 = m[2].parse().unwrap_or(0);
                        Some(format!(
                            "<{},{}>",
                            std::cmp::max(t1 as i64 - start_ms as i64, 0) as u64,
                            t2
                        ))
                    } else {
                        None
                    }
                })
                .collect();

            if times.is_empty() {
                continue;
            }

            let word_arr: Vec<&str> = word_time_re.split(&words).collect();
            let mut new_words = String::new();
            for (i, time) in times.iter().enumerate() {
                new_words.push_str(time);
                if i < word_arr.len() {
                    new_words.push_str(word_arr[i]);
                }
            }
            lxlrc_lines.push(format!("{}{}", start_str, new_words));
        } else {
            if line.starts_with("[offset") {
                lxlrc_lines.push(line.to_string());
                lrc_lines.push(line.to_string());
            }
            if line_time2_re.is_match(line) {
                lrc_lines.push(line.to_string());
            }
        }
    }

    (lrc_lines.join("\n"), lxlrc_lines.join("\n"))
}

fn tx_parse_rlyric(lrc: &str) -> String {
    let lrc = lrc.trim().replace('\r', "");
    if lrc.is_empty() {
        return String::new();
    }

    let line_time_re = TX_LINE_TIME_RE.get_or_init(|| Regex::new(r"^\[(\d+),\d+]").unwrap());
    let word_time_all_re = TX_WORD_TIME_RE.get_or_init(|| Regex::new(r"\(\d+,\d+\)").unwrap());
    let mut lrc_lines: Vec<String> = Vec::new();

    for raw_line in lrc.split('\n') {
        let line = raw_line.trim();
        if let Some(caps) = line_time_re.captures(line) {
            let start_ms: u64 = caps[1].parse().unwrap_or(0);
            let start_str = ms_format(start_ms);
            if start_str.is_empty() {
                continue;
            }
            let words = line_time_re.replace(line, "");
            lrc_lines.push(format!(
                "{}{}",
                start_str,
                word_time_all_re.replace_all(&words, "")
            ));
        }
    }

    lrc_lines.join("\n")
}

fn tx_get_intv(interval: &str) -> u64 {
    if interval.is_empty() {
        return 0;
    }
    let mut interval = interval.to_string();
    if !interval.contains('.') {
        interval.push_str(".0");
    }
    let arr: Vec<&str> = interval.split(|c| c == ':' || c == '.').collect();
    let mut arr = arr.to_vec();
    while arr.len() < 3 {
        arr.insert(0, "0");
    }
    let m: u64 = arr[0].parse().unwrap_or(0);
    let s: u64 = arr[1].parse().unwrap_or(0);
    let ms: u64 = arr[2].parse().unwrap_or(0);
    m * 3600000 + s * 1000 + ms
}

fn tx_fix_rlrc_time_tag(rlrc: &str, lrc: &str) -> String {
    let line_time2_re = TX_LINE_TIME2_RE.get_or_init(|| Regex::new(r"^\[([\d:.]+)]").unwrap());
    let rlrc_lines: Vec<&str> = rlrc.split('\n').collect();
    let mut lrc_lines: Vec<&str> = lrc.split('\n').collect();
    let mut new_lrc: Vec<String> = Vec::new();

    for line in &rlrc_lines {
        if let Some(caps) = line_time2_re.captures(line) {
            let words = line_time2_re.replace(line, "");
            if words.trim().is_empty() {
                continue;
            }
            let t1 = tx_get_intv(&caps[1]);
            while !lrc_lines.is_empty() {
                let lrc_line = lrc_lines.remove(0);
                if let Some(lrc_caps) = line_time2_re.captures(lrc_line) {
                    let t2 = tx_get_intv(&lrc_caps[1]);
                    if ((t1 as i64) - (t2 as i64)).unsigned_abs() < 100 {
                        new_lrc.push(line.replace(&caps[0], &lrc_caps[0]));
                        break;
                    }
                }
            }
        }
    }
    new_lrc.join("\n")
}

fn tx_fix_tlrc_time_tag(tlrc: &str, lrc: &str) -> String {
    let line_time2_re = TX_LINE_TIME2_RE.get_or_init(|| Regex::new(r"^\[([\d:.]+)]").unwrap());
    let tlrc_lines: Vec<&str> = tlrc.split('\n').collect();
    let mut lrc_lines: Vec<&str> = lrc.split('\n').collect();
    let mut new_lrc: Vec<String> = Vec::new();

    for line in &tlrc_lines {
        if let Some(caps) = line_time2_re.captures(line) {
            let words = line_time2_re.replace(line, "");
            if words.trim().is_empty() {
                continue;
            }
            let mut time = caps[1].to_string();
            if time.contains('.') {
                let parts: Vec<&str> = time.split('.').collect();
                if parts.len() == 2 {
                    let pad = 3usize.saturating_sub(parts[1].len());
                    time = format!("{}.{}{}", parts[0], parts[1], "0".repeat(pad));
                }
            }
            let t1 = tx_get_intv(&time);
            while !lrc_lines.is_empty() {
                let lrc_line = lrc_lines.remove(0);
                if let Some(lrc_caps) = line_time2_re.captures(lrc_line) {
                    let t2 = tx_get_intv(&lrc_caps[1]);
                    if ((t1 as i64) - (t2 as i64)).unsigned_abs() < 100 {
                        new_lrc.push(line.replace(&caps[0], &lrc_caps[0]));
                        break;
                    }
                }
            }
        }
    }
    new_lrc.join("\n")
}

fn tx_parse(lrc: &str, tlrc: &str, rlrc: &str) -> LyricResult {
    let mut info = LyricResult::default();
    if !lrc.is_empty() {
        let cleaned = tx_remove_tag(lrc);
        let (lyric, lxlyric) = tx_parse_lyric(&cleaned);
        info.lyric = lyric;
        info.lxlyric = lxlyric;
    }
    if !rlrc.is_empty() {
        let cleaned = tx_remove_tag(rlrc);
        let parsed = tx_parse_rlyric(&cleaned);
        info.rlyric = tx_fix_rlrc_time_tag(&parsed, &info.lyric);
    }
    if !tlrc.is_empty() {
        info.tlyric = tx_fix_tlrc_time_tag(tlrc, &info.lyric);
    }
    info
}

pub(super) async fn fetch_tx_lyric(song_info: &LyricSongInfo) -> Result<Option<LyricResult>, String> {
    let song_id_num = song_info
        .song_id
        .as_ref()
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
        })
        .unwrap_or(0);
    let songmid = &song_info.songmid;
    let interval_sec = song_info
        .interval_ms
        .map(|ms| (ms / 1000) as i64)
        .or_else(|| {
            song_info
                .interval
                .as_ref()
                .and_then(|s| s.parse::<i64>().ok())
        })
        .unwrap_or(0);
    let album_mid = song_info.album_mid.clone().unwrap_or_default();

    let mut lxlyric = String::new();
    let mut lyric = String::new();
    let mut tlyric = String::new();
    let mut rlyric = String::new();

    let body_json = serde_json::json!({
        "comm": { "g_tk": 5381, "uin": 0, "format": "json", "ct": 24, "cv": 0, "platform": "yqq.json", "needNewCode": 1 },
        "req_0": {
            "module": "music.musichallSong.PlayLyricInfo",
            "method": "GetPlayLyricInfo",
            "param": {
                "songMID": songmid,
                "songID": song_id_num,
                "albumMID": album_mid,
                "trans": 1,
                "roma": 1,
                "platform": "yqq",
                "qrc": 1,
                "crypt": 1,
                "lrc_t": 0,
                "qrc_t": 0,
                "cv": 2111,
                "ct": 19,
                "interval": interval_sec
            }
        }
    });
    let body_json_str = body_json.to_string();
    let resp = http_fetch_text(
        "https://u.y.qq.com/cgi-bin/musicu.fcg",
        "POST",
        &[
            ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36"),
            ("Referer", "https://y.qq.com/"),
            ("Origin", "https://y.qq.com"),
            ("Content-Type", "application/json"),
        ],
        Some(&body_json_str),
    )
    .await?;

    if resp.status == 200 {
        if let Ok(body) = serde_json::from_str::<serde_json::Value>(&resp.body) {
            if let Some(data) = body.get("req_0").and_then(|v| v.get("data")) {
                let lyric_field = data
                    .get("lyric")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let trans_field = data
                    .get("trans")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let roma_field = data
                    .get("roma")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if !lyric_field.trim().is_empty() {
                    match qrc_decrypt(lyric_field.trim()) {
                        Ok(decrypted) => {
                            let parsed = tx_parse(&decrypted, "", "");
                            lyric = parsed.lyric;
                            lxlyric = parsed.lxlyric;
                        }
                        Err(e) => {
                            eprintln!("[lyric_fetcher] tx musicu lyric 解密失败 err={}", e);
                        }
                    }
                }
                if !trans_field.trim().is_empty() {
                    if let Ok(decrypted) = qrc_decrypt(trans_field.trim()) {
                        let cleaned = tx_remove_tag(&decrypted);
                        tlyric = tx_fix_tlrc_time_tag(&cleaned, &lyric);
                    }
                }
                if !roma_field.trim().is_empty() {
                    if let Ok(decrypted) = qrc_decrypt(roma_field.trim()) {
                        let cleaned = tx_remove_tag(&decrypted);
                        let pr = tx_parse_rlyric(&cleaned);
                        rlyric = tx_fix_rlrc_time_tag(&pr, &lyric);
                    }
                }
            }
        }
    } else {
        eprintln!("[lyric_fetcher] tx musicu 失败 status={}", resp.status);
    }

    if lyric.is_empty() && lxlyric.is_empty() {
        eprintln!(
            "[lyric_fetcher] tx qrc路径失败，回退旧API songmid={} status={}",
            songmid, resp.status
        );
        let old_url = format!(
            "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq",
            songmid
        );
        let old_resp = http_fetch_text(
            &old_url,
            "GET",
            &[
                ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36"),
                ("Referer", "https://y.qq.com/portal/player.html"),
            ],
            None,
        )
        .await?;

        if old_resp.status == 200 {
            if let Ok(body) = serde_json::from_str::<serde_json::Value>(&old_resp.body) {
                if body.get("retcode").and_then(|v| v.as_i64()) == Some(0) {
                    if let Some(lyric_b64) = body.get("lyric").and_then(|v| v.as_str()) {
                        if let Ok(decoded) =
                            base64::engine::general_purpose::STANDARD.decode(pad_base64(lyric_b64))
                        {
                            lyric = String::from_utf8_lossy(&decoded).into_owned();
                        }
                    }
                    if let Some(trans_b64) = body.get("trans").and_then(|v| v.as_str()) {
                        if let Ok(decoded) =
                            base64::engine::general_purpose::STANDARD.decode(pad_base64(trans_b64))
                        {
                            tlyric = String::from_utf8_lossy(&decoded).into_owned();
                        }
                    }
                }
            }
        }
    }

    if lyric.is_empty() && lxlyric.is_empty() {
        return Ok(None);
    }

    Ok(Some(LyricResult {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
    }))
}

#[cfg(test)]
mod qrc_roundtrip_tests {
    use super::qrc_decrypt;

    /// 密文由 BakaMusic lyric-decrypt.ts 同款 JS 实现（Node + zlib.deflateSync）
    /// 对 fixtures/lyrics/baby.qrc 加密生成，验证 Rust 移植与 BakaMusic 等价。
    #[test]
    fn qrc_decrypt_roundtrip_baka_music_sample() {
        let hex = "28feb85c1e5b0aee52751548debf8cec52f70ac1da86688e31bcd4d2a45cb2c8160f5c250523e901f07ebf7fe6d77f6faa0f5043b807fcc537f7187d35c7679b37036be3184b3105526561110e1753714a7e6d1d7f17b0b2a10fe8c072d2e43ef5ec7d25bc331953a9ca7bf72bc291aa1c86176920dd579407719661fa2779178156cd4d9c435d39b7d92fad21e1e16de1096ea95d514b6e9d649c010e4f4003d763cf03ee9144d0ee69b070891a4636";
        let decrypted = qrc_decrypt(hex).expect("decrypt failed");
        let expected = include_str!("../fixtures/lyrics/baby.qrc");
        // 行级比较：行尾空白不敏感（fixture 历史版本间存在行尾空格差异，与 QRC 解析器宽松容错对齐）
        let norm = |s: &str| s.lines().map(|l| l.trim()).collect::<Vec<_>>().join("\n");
        assert_eq!(norm(&decrypted), norm(expected));
    }
}
