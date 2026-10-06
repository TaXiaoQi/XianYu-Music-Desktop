// 崩溃黑匣子：把 panic 与 Windows 未处理异常落盘到 app_data_dir/crash.log。
// release 是窗口子系统程序，stderr 不存在，panic 默认零痕迹，闪退后无从排查——
// 本模块让「闪退」变成可诊断事件：panic 记线程/消息/位置/回溯；
// 栈溢出、访问违例等不走 panic 的硬崩溃经 SEH 过滤器记异常码（0xC00000FD=栈溢出、0xC0000005=访问违例）。

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Manager;

const CRASH_LOG_FILE: &str = "crash.log";
// 超过该大小在启动时清空重来，防无限增长
const MAX_LOG_BYTES: u64 = 512 * 1024;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn log_path() -> PathBuf {
    LOG_PATH
        .get()
        .cloned()
        .unwrap_or_else(|| std::env::temp_dir().join(CRASH_LOG_FILE))
}

fn timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| format!("unix={}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)))
}

fn append(text: &str) {
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = file.write_all(text.as_bytes());
        let _ = file.flush();
    }
}

/// 追加一条带时间戳的普通事件（如「正常退出」），用于区分崩溃与主动关闭。
pub fn log_event(text: &str) {
    append(&format!("\n==== [{}] 事件: {} ====\n", timestamp(), text));
}

pub fn install(app: &tauri::AppHandle) {
    if let Some(dir) = app.path().app_data_dir().ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = LOG_PATH.set(dir.join(CRASH_LOG_FILE));
    }
    let path = log_path();
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread_name = std::thread::current().name().unwrap_or("<unnamed>").to_string();
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "未知 panic 载荷".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "未知".to_string());
        // release strip=symbols 下回溯无符号名，但帧地址 + 模块偏移仍可定位崩溃点
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let ts = timestamp();
        append(&format!(
            "\n==== [{ts}] panic ====\n线程: {thread_name}\n信息: {message}\n位置: {location}\n回溯:\n{backtrace}\n"
        ));
        previous(info);
    }));

    #[cfg(windows)]
    install_exception_filter();
}

#[cfg(windows)]
fn install_exception_filter() {
    use windows_sys::Win32::System::Diagnostics::Debug::{
        SetUnhandledExceptionFilter, EXCEPTION_CONTINUE_SEARCH, EXCEPTION_POINTERS,
    };

    // 过滤器里必须最小化动作：崩溃栈上栈空间所剩无几（栈溢出场景），堆也可能损坏，
    // 一次 append 失败就放弃，随后交还系统走 WER（Windows 错误报告仍有完整转储记录）。
    unsafe extern "system" fn filter(info: *const EXCEPTION_POINTERS) -> i32 {
        let code = unsafe {
            (*info)
                .ExceptionRecord
                .as_ref()
                .map(|r| r.ExceptionCode as u32)
                .unwrap_or(0)
        };
        let text = format!(
            "\n==== [{}] 未处理异常 0x{code:08X} ====\n",
            timestamp()
        );
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
            let _ = file.write_all(text.as_bytes());
            let _ = file.flush();
        }
        EXCEPTION_CONTINUE_SEARCH
    }

    unsafe { SetUnhandledExceptionFilter(Some(filter)) };
}
