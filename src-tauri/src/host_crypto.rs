//! 宿主侧平台签名/加密——桌面端薄层：纯逻辑在共享 core（xianyu_core::host_crypto，
//! 签名算法/测试用例随 core 维护），本文件只保留 Tauri 命令包装。

pub use xianyu_core::host_crypto::*;

// ===== Tauri 命令 =====

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiguSignResult {
    pub sign: String,
    pub device_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeapiResult {
    pub params: String,
    pub enc_sec_key: String,
}

#[tauri::command]
pub fn host_zzc_sign(text: String) -> String {
    zzc_sign(&text)
}

#[tauri::command]
pub fn host_kugou_sign(params: String, platform: String, body: Option<String>) -> String {
    kugou_sign(&params, &platform, body.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn host_kugou_request_key() -> String {
    xianyu_core::host_crypto::host_kugou_request_key()
}

#[tauri::command]
pub fn host_migu_sign(text: String, time: String) -> MiguSignResult {
    let (sign, device_id) = migu_sign(&text, &time);
    MiguSignResult { sign, device_id }
}

#[tauri::command]
pub fn host_linuxapi_encrypt(payload: String) -> String {
    linuxapi_encrypt(&payload)
}

#[tauri::command]
pub fn host_weapi_encrypt(payload: String) -> WeapiResult {
    let (params, enc_sec_key) = weapi_encrypt(&payload);
    WeapiResult {
        params,
        enc_sec_key,
    }
}

#[tauri::command]
pub fn host_sha256_hex(text: String) -> String {
    xianyu_core::host_crypto::sha256_hex(&text)
}

// ===== 歌单同步 v2 协议 song_hash =====
// 协议此前在桌面 TS 与移动 Dart 各写一份，现单点化到 Core
// （xianyu_core::host_crypto::playlist_song_hash）。在线/本地的分类是前端
// 业务逻辑（远端/插件/协议头判定），由调用方判好后传参：在线带 path。

#[derive(serde::Deserialize)]
pub struct PlaylistSongHashEntry {
    pub path: Option<String>,
    pub name: String,
    pub artist: String,
}

/// 批量计算 song_hash（歌单/收藏同步一次上报多首，避免逐条 IPC）。
#[tauri::command]
pub fn host_playlist_song_hashes(entries: Vec<PlaylistSongHashEntry>) -> Vec<String> {
    entries
        .iter()
        .map(|entry| {
            xianyu_core::host_crypto::playlist_song_hash(
                entry.path.as_deref(),
                &entry.name,
                &entry.artist,
            )
        })
        .collect()
}
