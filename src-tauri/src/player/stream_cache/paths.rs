use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

static CUSTOM_CACHE_DIR: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn custom_cache_dir_lock() -> &'static RwLock<Option<PathBuf>> {
    CUSTOM_CACHE_DIR.get_or_init(|| RwLock::new(None))
}

pub fn set_cache_dir(path: &str) {
    let new_dir = if path.trim().is_empty() {
        None
    } else {
        let p = PathBuf::from(path);
        if let Err(e) = std::fs::create_dir_all(&p) {
            eprintln!("[StreamCache] 创建自定义缓存目录失败: {e}");
            return;
        }
        Some(p)
    };
    if let Ok(mut guard) = custom_cache_dir_lock().write() {
        *guard = new_dir;
    }
}

pub fn get_cache_dir_str() -> String {
    if let Ok(guard) = custom_cache_dir_lock().read() {
        if let Some(ref p) = *guard {
            return p.to_string_lossy().into_owned();
        }
    }
    cache_dir().to_string_lossy().into_owned()
}

pub(super) fn cache_dir() -> PathBuf {
    if let Ok(guard) = custom_cache_dir_lock().read() {
        if let Some(ref custom) = *guard {
            let _ = std::fs::create_dir_all(custom);
            return custom.clone();
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let dir = PathBuf::from(appdata)
                .join("com.xymusic.desktop")
                .join("stream_cache");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
    }

    let dir = std::env::temp_dir().join("xianyu-music-stream-cache");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
