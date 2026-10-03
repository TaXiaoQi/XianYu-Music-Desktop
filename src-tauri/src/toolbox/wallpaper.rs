use crate::security::{path_validator, ssrf};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::Manager;

#[tauri::command] // 壁纸下载命令
pub async fn download_wallpaper( // 下载入口
    app_handle: tauri::AppHandle, // 应用句柄
    url: String, // 下载地址
    filename: String, // 文件名
    protected_path: Option<String>,
) -> Result<String, String> { // 返回保存路径
    use tokio::fs::{File};
    use tokio::io::{AsyncWriteExt};
    if !(url.starts_with("http://") || url.starts_with("https://")) { // 协议校验
        return Err("无效的壁纸下载链接".to_string()); // 无效链接报错
    } // save_bytes_via_dialog
    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("壁纸链接校验失败: {e}"))?;

    let safe_name = std::path::Path::new(&filename) // 提取文件名
        .file_name() // 文件名部分
        .and_then(|n| n.to_str()) // 转字符串
        .unwrap_or("wallpaper.jpg") // 默认名兜底
        .to_string(); // 转为 String
    let safe_name = if std::path::Path::new(&safe_name).extension().is_none() {
        format!("{safe_name}.jpg") // 强制 jpg 后缀
    } else { // 反之
        safe_name // 原样使用
    }; // 文件名完成
    let safe_name = crate::security::path_validator::sanitize_filename_component(&safe_name)?;
    let app_dir = app_handle // 应用数据目录
        .path() // 路径服务
        .app_data_dir() // 数据目录
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?; // 目录获取失败
    let wallpaper_dir = app_dir.join("wallpapers"); // 壁纸子目录
    tokio::fs::create_dir_all(&wallpaper_dir) // 创建目录
        .await // 异步等待
        .map_err(|e| format!("创建壁纸目录失败: {e}"))?; // 创建失败
    let dest_path = wallpaper_dir.join(&safe_name); // 目标路径
    let client = crate::netproxy::client_builder()
        .timeout(Duration::from_secs(60)) // 六十秒超时
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("XianYuMusic-WallpaperDownloader")
        .build() // 构建客户端
        .map_err(|e| format!("创建HTTP客户端失败: {e}"))?; // 构建失败
    let mut response = client // 发起下载
        .get(&url) // GET 请求
        .send() // 发送
        .await // 异步等待
        .map_err(|e| format!("下载壁纸失败: {e}"))?; // 下载失败
    if !response.status().is_success() { // 状态码检查
        return Err(format!("下载服务器返回错误状态: {}", response.status())); // 服务器错误报错
    } // save_bytes_via_dialog
    let mut file = File::create(&dest_path) // 创建文件
        .await // 异步等待
        .map_err(|e| format!("创建文件失败: {e}"))?; // 创建失败
    while let Some(chunk) = response // 循环读取分块
        .chunk() // 数据分块
        .await // 异步等待
        .map_err(|e| format!("读取响应数据失败: {e}"))? // 读取失败
    { // 实现体
        file.write_all(&chunk) // 写入磁盘
            .await // 异步等待
            .map_err(|e| format!("写入文件失败: {e}"))?; // 写入失败
    } // save_bytes_via_dialog
    drop(file);

    evict_wallpaper_cache(&wallpaper_dir, &dest_path, protected_path.as_deref()).await;
    Ok(dest_path.to_string_lossy().to_string()) // 返回保存路径
} // save_bytes_via_dialog

const WALLPAPER_CACHE_LIMIT: u64 = 300 * 1024 * 1024;

async fn evict_wallpaper_cache(
    dir: &std::path::Path,
    fresh: &std::path::Path,
    protected: Option<&str>,
) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(meta) = entry.metadata().await else { continue };
        if !meta.is_file() {
            continue;
        }
        files.push((
            entry.path(),
            meta.len(),
            meta.modified().unwrap_or(SystemTime::now()),
        ));
    }
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= WALLPAPER_CACHE_LIMIT {
        return;
    }
    files.sort_by_key(|f| f.2);
    for (path, size, _) in files {
        if path == fresh || Some(path.to_string_lossy().as_ref()) == protected {
            continue;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            total = total.saturating_sub(size);
            if total <= WALLPAPER_CACHE_LIMIT {
                break;
            }
        }
    }
}

#[tauri::command] // 实现
pub async fn delete_wallpaper_file(
    app_handle: tauri::AppHandle, // 实现
    local_path: String,
) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir() // 实现
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let wallpaper_dir = app_dir.join("wallpapers");
    let target = PathBuf::from(&local_path);

    if !target.exists() {
        return Ok(());
    }
    if !target.is_file() {
        return Err("目标不是可删除的壁纸文件".to_string());
    }
    let canonical_dir =
        std::fs::canonicalize(&wallpaper_dir).map_err(|e| format!("读取壁纸目录失败: {e}"))?;
    let canonical_target =
        std::fs::canonicalize(&target).map_err(|e| format!("读取壁纸文件失败: {e}"))?;
    if !canonical_target.starts_with(&canonical_dir) {
        return Err("只能删除应用壁纸目录中的文件".to_string());
    }
    tokio::fs::remove_file(&target)
        .await
        .map_err(|e| format!("删除壁纸文件失败: {e}"))?;
    Ok(())
}

const THEME_WALLPAPER_DATA_URL_MAX_LEN: usize = 16 * 1024 * 1024; // base64 上限（对应主题包单包解码后 12MB 壁纸预算）

#[tauri::command]
pub async fn save_theme_wallpaper( // 主题包壁纸资产落盘：data URL 解码写入 appData/theme_assets（独立目录，不参与壁纸缓存逐出）
    app_handle: tauri::AppHandle, // 应用句柄
    data_url: String, // 内嵌 data URL（data:image/<mime>;base64,…）
    filename: String, // 目标文件名（不含扩展名，由调用方生成）
) -> Result<String, String> { // 返回保存路径
    let (mime, encoded) = data_url // 解析 data URL 头
        .strip_prefix("data:image/")
        .and_then(|rest| rest.split_once(','))
        .ok_or_else(|| "无效的主题壁纸内嵌数据".to_string())?;
    let ext = match mime.to_ascii_lowercase().as_str() { // mime 白名单
        "png" => "png",
        "jpeg" | "jpg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        _ => return Err("不支持的主题壁纸格式".to_string()),
    };
    if data_url.len() > THEME_WALLPAPER_DATA_URL_MAX_LEN { // 内嵌体量限制
        return Err("主题壁纸内嵌数据过大".to_string());
    }
    use base64::{engine::general_purpose, Engine as _};
    let bytes = general_purpose::STANDARD // 解码 base64
        .decode(encoded)
        .map_err(|e| format!("主题壁纸数据解码失败: {e}"))?;
    if bytes.is_empty() {
        return Err("主题壁纸内嵌数据为空".to_string());
    }
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let asset_dir = app_dir.join("theme_assets"); // 主题资产专用目录
    tokio::fs::create_dir_all(&asset_dir)
        .await
        .map_err(|e| format!("创建主题资产目录失败: {e}"))?;
    let safe_stem = path_validator::sanitize_filename_component(&filename)?; // 文件名消毒
    let dest_path = asset_dir.join(format!("{safe_stem}.{ext}"));
    tokio::fs::write(&dest_path, &bytes)
        .await
        .map_err(|e| format!("写入主题壁纸失败: {e}"))?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_theme_wallpaper( // 删除主题资产目录中的壁纸文件（换包/取消主题时清理）
    app_handle: tauri::AppHandle, // 应用句柄
    local_path: String,
) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let asset_dir = app_dir.join("theme_assets");
    let target = PathBuf::from(&local_path);
    if !target.exists() {
        return Ok(());
    }
    if !target.is_file() {
        return Err("目标不是可删除的主题壁纸文件".to_string());
    }
    let canonical_dir =
        std::fs::canonicalize(&asset_dir).map_err(|e| format!("读取主题资产目录失败: {e}"))?;
    let canonical_target =
        std::fs::canonicalize(&target).map_err(|e| format!("读取主题壁纸文件失败: {e}"))?;
    if !canonical_target.starts_with(&canonical_dir) {
        return Err("只能删除应用主题资产目录中的文件".to_string());
    }
    tokio::fs::remove_file(&target)
        .await
        .map_err(|e| format!("删除主题壁纸文件失败: {e}"))?;
    Ok(())
}
