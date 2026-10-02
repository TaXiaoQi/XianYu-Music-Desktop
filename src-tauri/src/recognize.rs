use serde::{Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{UNIX_EPOCH, SystemTime};
// ==================== 取消标志 ====================

static RECOGNIZE_CANCELLED: AtomicBool = AtomicBool::new(false);

// ============ MD5 摘要算法（RFC 1321 实现） ============
const S_TABLE: [u32; 64] = [ // MD5 移位表
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]; // 移位表结束
const K_TABLE: [u32; 64] = [ // MD5 正弦常量表
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]; // 常量表结束
fn md5_hex(data: &[u8]) -> String { // md5_hex
    let digest = md5_compute(data); // 计算摘要
    let mut s = String::with_capacity(32); // 十六进制输出
    for b in digest.iter() { // 逐字节
        s.push_str(&format!("{:02x}", b)); // 两位十六进制
    } // md5_hex
    s // 拼接结果
} // md5_hex
fn md5_compute(input: &[u8]) -> [u8; 16] { // md5_compute
    let mut msg = input.to_vec(); // 复制消息
    let orig_len_bits = (input.len() as u64).wrapping_mul(8); // 原始比特长度
    msg.push(0x80); // 追加填充位
    while msg.len() % 64 != 56 { // 对齐到 448 位
        msg.push(0); // 补零
    } // md5_compute
    msg.extend_from_slice(&orig_len_bits.to_le_bytes()); // 追加长度字段
    let mut a0: u32 = 0x67452301; // 链接变量 A
    let mut b0: u32 = 0xefcdab89; // 链接变量 B
    let mut c0: u32 = 0x98badcfe; // 链接变量 C
    let mut d0: u32 = 0x10325476; // 链接变量 D
    for chunk in msg.chunks(64) { // 512 位分组
        let mut m = [0u32; 16]; // 消息字数组
        for (i, word) in chunk.chunks(4).enumerate() { // 小端装入
            m[i] = u32::from_le_bytes([word[0], word[1], word[2], word[3]]); // 合并四字节
        } // md5_compute
        let mut a = a0; // 工作副本
        let mut b = b0; // 工作副本
        let mut c = c0; // 工作副本
        let mut d = d0; // 工作副本
        for i in 0..64 { // 四轮循环
            let (f, g) = if i < 16 { // 轮函数选择
                ((b & c) | (!b & d), i) // F 与逻辑
            } else if i < 32 { // 第二轮
                ((d & b) | (!d & c), (5 * i + 1) % 16) // G 置换
            } else if i < 48 { // 第三轮
                (b ^ c ^ d, (3 * i + 5) % 16) // H 异或
            } else { // 反之
                (c ^ (b | !d), (7 * i) % 16) // I 或非
            }; // 轮函数结束
            let temp = d; // 暂存 D
            d = c; // D 取 C
            c = b; // C 取 B
            b = b.wrapping_add( // B 累加
                a.wrapping_add(f) // 加轮函数
                    .wrapping_add(K_TABLE[i]) // 加常量
                    .wrapping_add(m[g]) // 加消息字
                    .rotate_left(S_TABLE[i]), // 循环左移
            ); // 累加完成
            a = temp; // A 取原 D
        } // md5_compute
        a0 = a0.wrapping_add(a); // 累加回 A
        b0 = b0.wrapping_add(b); // 累加回 B
        c0 = c0.wrapping_add(c); // 累加回 C
        d0 = d0.wrapping_add(d); // 累加回 D
    } // md5_compute
    let mut result = [0u8; 16]; // 输出缓冲
    result[0..4].copy_from_slice(&a0.to_le_bytes()); // 写入 A
    result[4..8].copy_from_slice(&b0.to_le_bytes()); // 写入 B
    result[8..12].copy_from_slice(&c0.to_le_bytes()); // 写入 C
    result[12..16].copy_from_slice(&d0.to_le_bytes()); // 写入 D
    result // 返回摘要
} // md5_compute
// ============ 酷狗 Android 客户端签名 ============
const ANDROID_SALT: &str = "OIlwieks28dk2k092lksi2UIkp"; // 客户端固定盐值
fn device_mid() -> String { // device_mid
    md5_hex(b"xianyu-music-desktop-recognize-device-v1")
} // device_mid
fn build_params_string(params: &BTreeMap<String, String>) -> String { // build_params_string
    params // 参数拼接
        .iter() // 遍历参数
        .map(|(k, v)| format!("{}={}", k, v)) // 拼键值对
        .collect::<Vec<_>>() // 收集片段
        .join("") // 直接相连
} // build_params_string
fn sign_android(params: &BTreeMap<String, String>, pcm: &[u8]) -> String { // sign_android
    let params_string = build_params_string(params); // 参数串
    let salt = ANDROID_SALT.as_bytes(); // 盐值字节
    let mut input = Vec::with_capacity(salt.len() * 2 + params_string.len() + pcm.len()); // 预分配输入
    input.extend_from_slice(salt); // 前置盐值
    input.extend_from_slice(params_string.as_bytes()); // 参数串
    input.extend_from_slice(pcm); // 音频数据
    input.extend_from_slice(salt); // 后置盐值
    md5_hex(&input) // 摘要即签名
} // sign_android
// ============ 识别命令响应 ============
use std::collections::{BTreeMap};
#[derive(Serialize)] // 序列化
pub struct RecognizeResponse { // RecognizeResponse
    pub status: u16, // HTTP 状态
    pub body: String, // 响应体
} // RecognizeResponse
#[tauri::command] // 识别命令
pub async fn cancel_recognize_system_audio() -> Result<(), String> {
    RECOGNIZE_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
} // md5_compute
#[tauri::command] // 系统音频识别命令
pub async fn recognize_system_audio() -> Result<RecognizeResponse, String> { // 识别入口
    RECOGNIZE_CANCELLED.store(false, Ordering::SeqCst);

    let cancel_flag = &RECOGNIZE_CANCELLED;
    let pcm = tokio::task::spawn_blocking(move || {
        crate::system_audio::capture_system_audio_pcm(10, cancel_flag)
    })
    .await
    .map_err(|e| format!("音频捕获线程失败: {}", e))??;

    if RECOGNIZE_CANCELLED.load(Ordering::SeqCst) {
        return Err("识别已取消".to_string());
    }
    if pcm.is_empty() { // 空音频检查
        return Err("未捕获到系统音频，请确认系统正在播放音乐".to_string()); // 空输入报错
    } // md5_compute
    recognize_with_pcm_internal(&pcm).await
}

async fn recognize_with_pcm_internal(pcm: &[u8]) -> Result<RecognizeResponse, String> {
    let now = SystemTime::now() // 当前时间
        .duration_since(UNIX_EPOCH) // 纪元起算
        .map_err(|e| e.to_string())?; // 时间获取失败
    let clienttime = now.as_secs(); // 秒级时间
    let fpid = now.as_millis(); // 毫秒指纹
    let mid = device_mid(); // 设备标识
    let mut params: BTreeMap<String, String> = BTreeMap::new(); // 请求参数表
    params.insert("area_code".into(), "1".into()); // 地区码
    params.insert("include_unpublish".into(), "1".into()); // 含未发布
    params.insert("multi_result".into(), "1".into()); // 多结果
    params.insert("fpid".into(), fpid.to_string()); // 指纹时间戳
    params.insert("useid".into(), "0".into());
    params.insert("dfid".into(), "-".into()); // 设备指纹
    params.insert("mid".into(), mid.clone()); // 设备标识
    params.insert("uuid".into(), "-".into()); // 用户标识
    params.insert("appid".into(), "1005".into()); // 应用标识
    params.insert("clientver".into(), "20489".into()); // 客户端版本
    params.insert("clienttime".into(), clienttime.to_string()); // 客户端时间
    let signature = sign_android(&params, pcm); // 计算签名
    params.insert("signature".into(), signature); // 附加签名
    let query_string: String = params // 查询串
        .iter() // 遍历参数
        .map(|(k, v)| format!("{}={}", k, v)) // 拼键值对
        .collect::<Vec<_>>() // 收集片段
        .join("&"); // 与号相连
    let url = format!( // 请求地址
        "https://gateway.kugou.com/fingerprint.service/v1/music_trackid_mulit?{}", // 识别网关
        query_string // 查询参数
    ); // 地址完成
    let mut headers = reqwest::header::HeaderMap::new(); // 请求头集合
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
    insert(&mut headers, "dfid", "-")?; // 设备指纹
    insert(&mut headers, "clienttime", &clienttime.to_string())?; // 客户端时间
    insert(&mut headers, "mid", &mid)?; // 设备标识
    insert(&mut headers, "kg-rc", "1")?; // 酷狗渠道
    insert(&mut headers, "kg-thash", "5d816a0")?; // 酷狗哈希
    insert(&mut headers, "kg-rec", "1")?; // 识别标记
    insert(&mut headers, "kg-rf", "B9EDA08A64250DEFFBCADDEE00F8F25F")?; // 请求来源
    insert(&mut headers, "User-Agent", "KuGou/11490 (Android)")?; // 用户代理
    insert(&mut headers, "content-type", "application/octet-stream")?; // 二进制负载
    if RECOGNIZE_CANCELLED.load(Ordering::SeqCst) {
        return Err("识别已取消".to_string());
    }

    let client = crate::netproxy::client_builder()
        .redirect(reqwest::redirect::Policy::limited(10)) // 跟随重定向
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .timeout(std::time::Duration::from_secs(30)) // 超时三十秒
        .build() // 构建客户端
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?; // 构建失败提示
    let response = client // 发起请求
        .post(&url) // POST 地址
        .headers(headers) // 附加头
        .body(pcm.to_vec()) // 音频指纹体
        .send() // 发送
        .await // 异步等待
        .map_err(|e| format!("识别请求发送失败: {}", e))?; // 请求失败提示
    let status = response.status().as_u16(); // 状态码
    let body = response // 读取响应
        .text() // 文本形式
        .await // 等待完成
        .map_err(|e| format!("读取响应体失败: {}", e))?; // 读取失败提示
    Ok(RecognizeResponse { status, body }) // 返回结果
} // md5_compute
// ============ 单元测试 ============
#[cfg(test)] mod tests {
    use super::*; // 测试引用
    #[test] // MD5 测试
    fn test_md5_known_vectors() { // test_md5_known_vectors
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e"); // 空串摘要
        assert_eq!(md5_hex(b"a"), "0cc175b9c0f1b6a831c399e269772661"); // 单字符摘要
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72"); // 三字符摘要
        assert_eq!( // 多行断言
            md5_hex(b"message digest"), // 消息摘要串
            "f96b697d7cb7938d525a2f31aaf161d0" // 期望值
        ); // 断言结束
        assert_eq!( // 长串断言
            md5_hex(b"abcdefghijklmnopqrstuvwxyz"), // 字母表串
            "c3fcd3d76192e4007dfb496cca67e13b" // 期望值
        ); // 断言结束
    } // test_md5_known_vectors
    #[test] // 签名测试
    fn test_sign_android_empty_data() { // test_sign_android_empty_data
        let mut params: BTreeMap<String, String> = BTreeMap::new(); // 参数表
        params.insert("appid".into(), "1005".into()); // 应用标识
        params.insert("clienttime".into(), "1000000000".into()); // 固定时间
        let salt = ANDROID_SALT; // 盐值
        let params_string = "appid=1005clienttime=1000000000"; // 期望参数串
        let mut input = Vec::new(); // 手工拼接
        input.extend_from_slice(salt.as_bytes()); // 前置盐
        input.extend_from_slice(params_string.as_bytes()); // 参数串
        input.extend_from_slice(salt.as_bytes()); // 后置盐
        let expected = md5_hex(&input); // 期望摘要
        let actual = sign_android(&params, &[]); // 实际签名
        assert_eq!(actual, expected); // 一致性断言
    } // test_sign_android_empty_data
    #[test] // 设备标识测试
    fn test_device_mid_stable() { // test_device_mid_stable
        let m1 = device_mid(); // 首次获取
        let m2 = device_mid(); // 再次获取
        assert_eq!(m1, m2); // 幂等断言
        assert_eq!(m1.len(), 32); // 长度断言
    } // test_device_mid_stable
} // md5_compute
