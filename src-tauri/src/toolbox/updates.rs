use crate::security::{path_validator, ssrf};
use std::time::Duration;
use tauri::Manager;

#[tauri::command] // 实现
pub async fn check_update_by_rust(owner: String, repo: String) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest"); // 最新版本地址

    let client = crate::netproxy::client_builder()
        .timeout(Duration::from_secs(10)) // 实现
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("XianYuMusic-Updater")
        .build()
        .map_err(|e| format!("创建更新请求失败: {e}"))?; // 实现

    client
        .get(&url) // GET 请求
        .header("Accept", "application/vnd.github+json") // GitHub API 格式
        .send()
        .await
        .map_err(|e| format!("请求更新接口失败: {e}"))? // 实现
        .error_for_status() // 实现
        .map_err(|e| format!("更新接口返回错误状态: {e}"))? // 实现
        .text()
        .await
        .map_err(|e| format!("读取更新数据失败: {e}")) // 实现
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadProgress { // DownloadProgress
    pub progress: f64, // 实现
    pub downloaded: u64, // 实现
    pub total: u64, // 实现
    pub speed: f64, // 实现
}

#[tauri::command] // 实现
pub async fn download_update_file( // 实现
    app_handle: tauri::AppHandle, // 实现
    url: String, // 实现
) -> Result<String, String> { // 实现
    use std::time::Instant;
    use tauri::{Manager, Emitter};
    use tokio::fs::{File};
    use tokio::io::{AsyncWriteExt};

    let client = crate::netproxy::client_builder()
        .timeout(Duration::from_secs(300)) // 实现
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("XianYuMusic-Updater")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?; // 实现

    let mut download_url = url.clone(); // 实现
    if download_url.contains("github.com") { // 实现
        download_url = format!("https://gh-proxy.com/{}", download_url); // 实现
    }

    ssrf::validate_outbound_url(&download_url)
        .await
        .map_err(|e| format!("更新包下载链接校验失败: {e}"))?;

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("发送下载请求失败: {e}"))?;
    if !response.status().is_success() { // 实现
        return Err(format!("下载服务器返回错误状态: {}", response.status())); // 实现
    }

    let total_size = response.content_length().unwrap_or(0); // 实现
    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;

    let url_lower = url.to_lowercase();
    let filename = if url_lower.contains(".msi") {
        if url_lower.contains("portable") {
            "XianYu.Player_Setup_Portable.msi"
        } else {
            "XianYu.Player_Setup_Standard.msi"
        }
    } else if url_lower.contains(".exe") {
        if url_lower.contains("portable") {
            "XianYu.Player_Setup_Portable.exe"
        } else {
            "XianYu.Player_Setup_Standard.exe"
        }
    } else if url_lower.contains(".deb") {
        "XianYu.Player_Setup.deb"
    } else if url_lower.contains(".rpm") {
        "XianYu.Player_Setup.rpm"
    } else if url_lower.contains(".appimage") {
        "XianYu.Player_Setup.AppImage"
    } else if url_lower.contains(".dmg") {
        "XianYu.Player_Setup.dmg"
    } else {
        "XianYu.Player_Setup.msi"
    };
    let dest_path = download_dir.join(filename); // 实现

    let mut file = File::create(&dest_path)
        .await
        .map_err(|e| format!("创建目标文件失败: {e}"))?;
    let mut downloaded: u64 = 0; // 实现
    let start_time = Instant::now(); // 实现
    let mut last_emit = Instant::now(); // 实现

    let mut response = response; // 实现
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("下载数据分块失败: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
        downloaded += chunk.len() as u64; // 实现

        let now = Instant::now(); // 实现
        if now.duration_since(last_emit).as_millis() >= 100 || downloaded == total_size { // 实现
            let elapsed = start_time.elapsed().as_secs_f64(); // 实现
            let speed = if elapsed > 0.0 {
                downloaded as f64 / elapsed
            } else {
                0.0
            };
            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };

            let payload = DownloadProgress { // 实现
                progress,
                downloaded,
                total: total_size, // 实现
                speed,
            };
            let _ = app_handle.emit("update-download-progress", payload); // 实现
            last_emit = now; // 实现
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新文件缓存失败: {e}"))?;

    Ok(dest_path.to_string_lossy().to_string()) // 实现
}

#[tauri::command] // 实现
pub fn is_store_build() -> bool {
    #[cfg(feature = "store-build")]
    let store = true;
    #[cfg(all(not(feature = "store-build"), target_os = "windows"))]
    let store = {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentPackageFullName(len: *mut u32, buf: *mut u16) -> i32;
        }
        const ERROR_INSUFFICIENT_BUFFER: i32 = 122;
        let mut len: u32 = 0;
        let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
        if rc == ERROR_INSUFFICIENT_BUFFER && len > 0 {
            let mut buf = vec![0u16; len as usize];
            let rc2 = unsafe { GetCurrentPackageFullName(&mut len, buf.as_mut_ptr()) };
            rc2 == 0
        } else {
            false
        }
    };
    #[cfg(all(not(feature = "store-build"), not(target_os = "windows")))]
    let store = false;
    store
}

#[tauri::command] // 实现
pub fn run_installer(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::process::{Command};

    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("获取下载目录失败: {e}"))?;

    let validated = path_validator::validate_path_in_dir(&path, &download_dir)?;

    let ext = validated
        .extension() // 实现
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    #[cfg(windows)]
    let ext_allowed = ext == "msi" || ext == "exe";
    #[cfg(target_os = "linux")]
    let ext_allowed = ext == "deb" || ext == "rpm" || ext == "appimage";
    #[cfg(target_os = "macos")]
    let ext_allowed = ext == "dmg";
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    let ext_allowed = false;

    if !ext_allowed {
        return Err(format!(
            "仅允许运行当前平台支持的安装包（Windows: .msi/.exe；Linux: .deb/.rpm/.AppImage；macOS: .dmg），当前扩展名: .{ext}"
        ));
    }

    if !validated.is_file() {
        return Err(format!("安装程序文件不存在: {}", validated.display()));
    }

    let path_str = validated.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        if ext == "msi" {
            Command::new("msiexec")
                .args(["/i", &path_str])
                .spawn()
                .map_err(|e| format!("启动 MSI 安装程序失败: {e}"))?;
        } else {
            Command::new(&path_str)
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {e}"))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = &ext;
        if ext == "appimage" {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&validated)
                    .map_err(|e| format!("读取安装包信息失败: {e}"))?
                    .permissions();
                if perms.mode() & 0o111 == 0 {
                    perms.set_mode(perms.mode() | 0o111);
                    std::fs::set_permissions(&validated, perms)
                        .map_err(|e| format!("设置执行权限失败: {e}"))?;
                }
            }
            Command::new(&path_str)
                .spawn()
                .map_err(|e| format!("启动 AppImage 失败: {e}"))?;
        } else {
            Command::new("xdg-open")
                .arg(&path_str)
                .spawn()
                .map_err(|e| format!("启动系统安装器失败: {e}"))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        let script = "#!/bin/sh\n\
            # XianYu Music 应用内更新安装脚本（参数: $1=dmg 路径）\n\
            sleep 2\n\
            MOUNT=$(hdiutil attach -nobrowse -readonly \"$1\" | grep -o '/Volumes/.*' | head -1)\n\
            if [ -z \"$MOUNT\" ]; then\n\
              exit 1\n\
            fi\n\
            APP=$(find \"$MOUNT\" -maxdepth 2 -name '*.app' -print | head -1)\n\
            if [ -n \"$APP\" ]; then\n\
              TARGET=\"/Applications/$(basename \"$APP\")\"\n\
              rm -rf \"$TARGET\"\n\
              cp -R \"$APP\" \"/Applications/\"\n\
              open \"$TARGET\"\n\
            fi\n\
            hdiutil detach \"$MOUNT\" >/dev/null 2>&1 || true\n";
        let script_path = std::env::temp_dir().join("xianyu_update_install.sh");
        std::fs::write(&script_path, script).map_err(|e| format!("写入安装脚本失败: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755));
        }
        Command::new("/bin/sh")
            .arg(&script_path)
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("启动更新脚本失败: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = &ext;
        let _ = &path_str;
        return Err("当前平台不支持应用内安装更新".to_string());
    }

    Ok(())
}
