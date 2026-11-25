use serde::{Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{UNIX_EPOCH, SystemTime};
// ==================== 取消标志 ====================

static RECOGNIZE_CANCELLED: AtomicBool = AtomicBool::new(false);

// ============ 酷狗 Android 签名（纯逻辑在 Core） ============
// MD5 摘要、device_mid、build_params_string、sign_android 已迁入共享仓库
// xianyu_core::recognize（签名算法与测试用例随 core 维护）。桌面端历史上
// 使用独立设备种子，故此处传自有种子保持设备身份不变。
use std::collections::{BTreeMap};
use xianyu_core::recognize::{device_mid_with_seed, sign_android};

/// 桌面端识别设备种子（历史值，勿改动，否则设备 mid 变化）。
const DESKTOP_RECOGNIZE_DEVICE_SEED: &str = "xianyu-music-desktop-recognize-device-v1";

// ============ 识别命令响应 ============
#[derive(Serialize)] // 序列化
pub struct RecognizeResponse { // RecognizeResponse
    pub status: u16, // HTTP 状态
    pub body: String, // 响应体
} // RecognizeResponse
#[tauri::command] // 识别命令
pub async fn cancel_recognize_system_audio() -> Result<(), String> {
    RECOGNIZE_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
} // cancel_recognize_system_audio
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
    } // 空输入检查结束
    recognize_with_pcm_internal(&pcm).await
}

async fn recognize_with_pcm_internal(pcm: &[u8]) -> Result<RecognizeResponse, String> {
    let now = SystemTime::now() // 当前时间
        .duration_since(UNIX_EPOCH) // 纪元起算
        .map_err(|e| e.to_string())?; // 时间获取失败
    let clienttime = now.as_secs(); // 秒级时间
    let fpid = now.as_millis(); // 毫秒指纹
    let mid = device_mid_with_seed(DESKTOP_RECOGNIZE_DEVICE_SEED); // 设备标识（历史种子）
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
        .iter() // 遍历
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
} // recognize_with_pcm_internal
