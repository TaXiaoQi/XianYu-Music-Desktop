use std::path::Path;

/// ffmpeg 程序选择链：用户自定义路径 → 内置 sidecar（随安装包分发 / dev 源码树）→ PATH
pub fn resolve_ffmpeg(custom: Option<&str>) -> String {
    if let Some(p) = custom.map(str::trim).filter(|p| !p.is_empty()) {
        return p.to_string();
    }

    let exe_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(exe_name);
            if bundled.is_file() {
                return bundled.to_string_lossy().into_owned();
            }
        }
    }

    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        let triple = if cfg!(windows) {
            format!(
                "ffmpeg-{}-pc-windows-msvc.exe",
                std::env::consts::ARCH
            )
        } else {
            exe_name.to_string()
        };
        let dev = Path::new(manifest).join("bin").join(&triple);
        if dev.is_file() {
            return dev.to_string_lossy().into_owned();
        }
    }

    "ffmpeg".to_string()
}
