//! 听歌识曲模块
//!
//! 复现 KuGouMusicApi（qwemusic/server）中 audio_match 模块的调用逻辑：
//! 1. WASAPI Loopback 捕获系统音频输出（10 秒），降采样为 8000Hz / 16bit / 单声道 PCM
//! 2. 构建酷狗 Android 客户端请求参数并生成 signature 签名
//! 3. POST 到 gateway.kugou.com 的指纹识别接口
//! 4. 返回 JSON 响应体，由前端映射为可播放的 Song 列表
//!
//! 签名算法（util/helper.js::signatureAndroidParams）：
//!   salt = "OIlwieks28dk2k092lksi2UIkp"  // 标准版盐值
//!   paramsString = params.keys().sort().map(k => `${k}=${params[k]}`).join("")
//!   signature = MD5(salt + paramsString + dataBytes + salt)  // dataBytes 为原始 PCM
//!
//! 请求头（util/request.js::createRequest）：
//!   dfid / clienttime / mid / kg-rc / kg-thash / kg-rec / kg-rf / User-Agent

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

// ==================== 取消标志 ====================

/// 全局取消标志：前端调用 cancel_recognize_system_audio 时置为 true，
/// 音频捕获循环和 HTTP 请求发送前会检查此标志，实现中途取消。
static RECOGNIZE_CANCELLED: AtomicBool = AtomicBool::new(false);

// ==================== MD5 实现 ====================
// 标准的 MD5 算法（RFC 1321），用于生成酷狗 android 签名。
// 这里内置实现而非引入 md-5 crate，避免外部依赖下载问题。

const S_TABLE: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K_TABLE: [u32; 64] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/// 计算 `data` 的 MD5 哈希，返回 32 位小写 hex 字符串
fn md5_hex(data: &[u8]) -> String {
    let digest = md5_compute(data);
    let mut s = String::with_capacity(32);
    for b in digest.iter() {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// MD5 核心计算，返回 16 字节摘要
fn md5_compute(input: &[u8]) -> [u8; 16] {
    let mut msg = input.to_vec();
    let orig_len_bits = (input.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&orig_len_bits.to_le_bytes());

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    for chunk in msg.chunks(64) {
        let mut m = [0u32; 16];
        for (i, word) in chunk.chunks(4).enumerate() {
            m[i] = u32::from_le_bytes([word[0], word[1], word[2], word[3]]);
        }

        let mut a = a0;
        let mut b = b0;
        let mut c = c0;
        let mut d = d0;

        for i in 0..64 {
            let (f, g) = if i < 16 {
                ((b & c) | (!b & d), i)
            } else if i < 32 {
                ((d & b) | (!d & c), (5 * i + 1) % 16)
            } else if i < 48 {
                (b ^ c ^ d, (3 * i + 5) % 16)
            } else {
                (c ^ (b | !d), (7 * i) % 16)
            };
            let temp = d;
            d = c;
            c = b;
            b = b.wrapping_add(
                a.wrapping_add(f)
                    .wrapping_add(K_TABLE[i])
                    .wrapping_add(m[g])
                    .rotate_left(S_TABLE[i]),
            );
            a = temp;
        }

        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut result = [0u8; 16];
    result[0..4].copy_from_slice(&a0.to_le_bytes());
    result[4..8].copy_from_slice(&b0.to_le_bytes());
    result[8..12].copy_from_slice(&c0.to_le_bytes());
    result[12..16].copy_from_slice(&d0.to_le_bytes());
    result
}

// ==================== 酷狗 Android 签名 ====================

/// Android 版签名盐值（标准版，util/helper.js）
const ANDROID_SALT: &str = "OIlwieks28dk2k092lksi2UIkp";

/// 生成设备 mid（运行时固定，由稳定种子计算得来）
fn device_mid() -> String {
    md5_hex(b"xy-music-desktop-recognize-device-v1")
}

/// 构建签名参数字符串：按 key 字典序排序，拼接为 `k1=v1k2=v2...`
/// 与 JS `Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("")` 一致
fn build_params_string(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("")
}

/// 生成酷狗 Android 签名
/// `signature = MD5(salt + paramsString + pcmBytes + salt)`
fn sign_android(params: &BTreeMap<String, String>, pcm: &[u8]) -> String {
    let params_string = build_params_string(params);
    let salt = ANDROID_SALT.as_bytes();
    let mut input = Vec::with_capacity(salt.len() * 2 + params_string.len() + pcm.len());
    input.extend_from_slice(salt);
    input.extend_from_slice(params_string.as_bytes());
    input.extend_from_slice(pcm);
    input.extend_from_slice(salt);
    md5_hex(&input)
}

// ==================== 命令响应 ====================

use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct RecognizeResponse {
    pub status: u16,
    pub body: String,
}

/// 取消正在进行的音频识别
///
/// 前端在用户主动停止识别时调用此命令。后端会将全局取消标志置为 true，
/// 正在进行的 WASAPI 捕获循环会在下一次迭代时退出并返回错误。
#[tauri::command]
pub async fn cancel_recognize_system_audio() -> Result<(), String> {
    RECOGNIZE_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// 一键无感识别：直接捕获系统音频并识别（无需用户选屏幕或勾选分享音频）
///
/// 在 Rust 后端用 WASAPI Loopback 捕获系统音频输出（10 秒），
/// 重采样为 8000Hz / 16bit / 单声道 PCM 后直接调用酷狗指纹识别接口。
/// 整个过程对用户完全透明，前端只需调用此命令即可。
///
/// 调用 cancel_recognize_system_audio 可中途取消捕获。
#[tauri::command]
pub async fn recognize_system_audio() -> Result<RecognizeResponse, String> {
    // 重置取消标志
    RECOGNIZE_CANCELLED.store(false, Ordering::SeqCst);

    // 在阻塞线程池中捕获系统音频（WASAPI loopback 是同步阻塞 API），
    // 避免 std::thread::sleep 阻塞 tokio 异步运行时
    let cancel_flag = &RECOGNIZE_CANCELLED;
    let pcm = tokio::task::spawn_blocking(move || {
        crate::system_audio::capture_system_audio_pcm(10, cancel_flag)
    })
    .await
    .map_err(|e| format!("音频捕获线程失败: {}", e))??;

    // 捕获结束后检查是否被取消
    if RECOGNIZE_CANCELLED.load(Ordering::SeqCst) {
        return Err("识别已取消".to_string());
    }

    if pcm.is_empty() {
        return Err("未捕获到系统音频，请确认系统正在播放音乐".to_string());
    }

    recognize_with_pcm_internal(&pcm).await
}

/// 使用自定义 PCM 数据识别歌曲
///
/// 接收 8000Hz / 16bit / 单声道 PCM 字节流，直接调用酷狗指纹识别接口。
/// 可用于从文件或其他来源提取的音频识别，不依赖 WASAPI 系统音频捕获。
#[tauri::command]
pub async fn recognize_with_pcm(pcm: Vec<u8>) -> Result<RecognizeResponse, String> {
    if pcm.is_empty() {
        return Err("PCM 数据为空".to_string());
    }
    recognize_with_pcm_internal(&pcm).await
}

/// 内部核心逻辑：用 PCM 数据调用酷狗指纹识别接口
///
/// 构建酷狗 Android 客户端请求参数并生成 signature 签名，
/// POST 到 gateway.kugou.com 的指纹识别接口。
async fn recognize_with_pcm_internal(pcm: &[u8]) -> Result<RecognizeResponse, String> {
    // 1. 构建请求参数（audio_match 模块自定义参数 + createRequest 默认参数）
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let clienttime = now.as_secs();
    let fpid = now.as_millis();
    let mid = device_mid();

    // BTreeMap 按 key 字典序排序，与 JS Object.keys().sort() 一致
    let mut params: BTreeMap<String, String> = BTreeMap::new();
    // audio_match 自定义参数
    params.insert("area_code".into(), "1".into());
    params.insert("include_unpublish".into(), "1".into());
    params.insert("multi_result".into(), "1".into());
    params.insert("fpid".into(), fpid.to_string());
    params.insert("useid".into(), "0".into()); // 未登录用户
                                               // createRequest 默认参数
    params.insert("dfid".into(), "-".into());
    params.insert("mid".into(), mid.clone());
    params.insert("uuid".into(), "-".into());
    params.insert("appid".into(), "1005".into());
    params.insert("clientver".into(), "20489".into());
    params.insert("clienttime".into(), clienttime.to_string());

    // 2. 生成 Android 签名
    let signature = sign_android(&params, pcm);
    params.insert("signature".into(), signature);

    // 3. 构建完整 URL（参数拼接到 query string）
    let query_string: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!(
        "https://gateway.kugou.com/fingerprint.service/v1/music_trackid_mulit?{}",
        query_string
    );

    // 4. 构建请求头（复现 createRequest 中的 headers 构建）
    let mut headers = reqwest::header::HeaderMap::new();
    let insert =
        |headers: &mut reqwest::header::HeaderMap, name: &str, value: &str| -> Result<(), String> {
            headers.insert(
                reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|e| format!("无效 header 名 {}: {}", name, e))?,
                reqwest::header::HeaderValue::from_str(value)
                    .map_err(|e| format!("无效 header 值 {}: {}", value, e))?,
            );
            Ok(())
        };
    insert(&mut headers, "dfid", "-")?;
    insert(&mut headers, "clienttime", &clienttime.to_string())?;
    insert(&mut headers, "mid", &mid)?;
    insert(&mut headers, "kg-rc", "1")?;
    insert(&mut headers, "kg-thash", "5d816a0")?;
    insert(&mut headers, "kg-rec", "1")?;
    insert(&mut headers, "kg-rf", "B9EDA08A64250DEFFBCADDEE00F8F25F")?;
    insert(&mut headers, "User-Agent", "KuGou/11490 (Android)")?;
    insert(&mut headers, "content-type", "application/octet-stream")?;

    // 5. 发送 POST 请求（PCM 二进制作为 body）
    // 检查是否已被取消（捕获阶段或手动取消）
    if RECOGNIZE_CANCELLED.load(Ordering::SeqCst) {
        return Err("识别已取消".to_string());
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .headers(headers)
        .body(pcm.to_vec())
        .send()
        .await
        .map_err(|e| format!("识别请求发送失败: {}", e))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应体失败: {}", e))?;

    Ok(RecognizeResponse { status, body })
}

// ==================== 单元测试 ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 MD5 实现正确性（RFC 1321 标准测试向量）
    #[test]
    fn test_md5_known_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"a"), "0cc175b9c0f1b6a831c399e269772661");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            md5_hex(b"message digest"),
            "f96b697d7cb7938d525a2f31aaf161d0"
        );
        assert_eq!(
            md5_hex(b"abcdefghijklmnopqrstuvwxyz"),
            "c3fcd3d76192e4007dfb496cca67e13b"
        );
    }

    /// 验证签名算法与 JS 实现一致（空 PCM 场景）
    #[test]
    fn test_sign_android_empty_data() {
        let mut params: BTreeMap<String, String> = BTreeMap::new();
        params.insert("appid".into(), "1005".into());
        params.insert("clienttime".into(), "1000000000".into());

        // 手动计算预期值：MD5(salt + "appid=1005clienttime=1000000000" + salt)
        let salt = ANDROID_SALT;
        let params_string = "appid=1005clienttime=1000000000";
        let mut input = Vec::new();
        input.extend_from_slice(salt.as_bytes());
        input.extend_from_slice(params_string.as_bytes());
        input.extend_from_slice(salt.as_bytes());
        let expected = md5_hex(&input);

        let actual = sign_android(&params, &[]);
        assert_eq!(actual, expected);
    }

    /// 验证设备 mid 稳定
    #[test]
    fn test_device_mid_stable() {
        let m1 = device_mid();
        let m2 = device_mid();
        assert_eq!(m1, m2);
        assert_eq!(m1.len(), 32);
    }
}
