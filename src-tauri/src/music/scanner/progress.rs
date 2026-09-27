//! 进度上报子模块：扫描各阶段的可见性全靠这里推送给前端。
//!
//! 事件通道共两条（通道名为前端契约，取值冻结）：
//! - `library-scan-progress`：阶段帧，`phase` 取
//!   collecting / parsing / writing / complete / error（snake_case）；
//! - `library-scan-batch`：落库增量帧，携带新写入曲目与被删除路径。
//!
//! 节流约定：
//! - parsing 阶段按“里程碑 + 时间窗”双阈值放行：首条、每 25 条、
//!   末条必发，其余仅在距上一帧超过 200ms 时放行；
//! - batch 增量先入缓冲，按 200ms 间隔冲刷；complete / error 发出前
//!   强制冲刷一次，保证前端先拿到完整增量再看到扫描结束。

use serde::Serialize;
use std::sync::atomic::{AtomicU64, AtomicUsize};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Emitter;

/// 进度事件通道名。前端按该字符串监听，取值冻结。
const EVENT_PROGRESS: &str = "library-scan-progress";
/// 批量增量事件通道名。前端按该字符串监听，取值冻结。
const EVENT_BATCH: &str = "library-scan-batch";
/// 两次事件之间允许的最小间隔（毫秒）。
const MIN_EMIT_GAP_MS: u64 = 200;

// ---------- 事件负载（serde 字段名冻结，前端契约） ----------

/// 进度帧负载。serde 字段名是前端契约：只能调整声明排布，不能改名。
#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
struct ScanFrame {
    failed: bool, done: bool, message: Option<String>,
    folder_total: usize, folder_index: usize, folder_path: String,
    total: usize, current: usize, phase: &'static str,
}

/// 批量增量帧负载。serde 字段名是前端契约：同上，只动排布不动名。
#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
struct BatchDelta {
    folder_total: usize, folder_index: usize,
    folder_path: String, deleted_paths: Vec<String>,
    songs: Vec<crate::music::types::Song>,
}

/// 当前 Unix 毫秒时间戳；时钟异常时按 0 或上限处理，不拖累扫描主流程。
fn unix_millis_now() -> u64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(elapsed) => u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        Err(_) => 0,
    }
}

// ---------- 上报器 ----------

/// 扫描进度上报器。
///
/// 句柄可克隆并带入 rayon 解析线程并发推进：计数走原子量，增量缓冲走互斥锁。
#[derive(Clone)]
pub(crate) struct ScanProgressReporter {
    handle: AppHandle,
    scope_folder: String,
    scope_index: usize,
    scope_total: usize,
    parsed_so_far: Arc<AtomicUsize>,
    last_frame_stamp: Arc<AtomicU64>,
    pending_songs: Arc<Mutex<Vec<crate::music::types::Song>>>,
    pending_paths: Arc<Mutex<Vec<String>>>,
    last_flush_stamp: Arc<AtomicU64>,
}

impl ScanProgressReporter {
    /// 绑定应用句柄与本次扫描的文件夹上下文（第几个 / 共几个）。
    pub(super) fn attach(
        app: AppHandle,
        folder_path: String,
        folder_index: usize,
        folder_total: usize,
    ) -> Self {
        Self {
            handle: app,
            scope_folder: folder_path,
            scope_index: folder_index,
            scope_total: folder_total,
            parsed_so_far: Arc::new(AtomicUsize::new(0)),
            last_frame_stamp: Arc::new(AtomicU64::new(0)),
            pending_songs: Arc::new(Mutex::new(Vec::new())),
            pending_paths: Arc::new(Mutex::new(Vec::new())),
            last_flush_stamp: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 底层帧发送：事件投递失败一律静默吞掉，绝不反过来影响扫描。
    fn dispatch_frame(
        &self,
        phase: &'static str,
        current: usize,
        total: usize,
        message: Option<String>,
        done: bool,
        failed: bool,
    ) {
        let _ = self.handle.emit(
            EVENT_PROGRESS,
            ScanFrame {
                failed,
                done,
                message,
                folder_total: self.scope_total,
                folder_index: self.scope_index,
                folder_path: self.scope_folder.clone(),
                total,
                current,
                phase,
            },
        );
    }

    /// 盘点阶段（发现候选文件）。
    pub(super) fn emit_collecting(&self, current: usize, total: usize, message: Option<String>) {
        self.dispatch_frame("collecting", current, total, message, false, false);
    }

    /// 解析阶段开场：计数与节流窗口归零，先推一条起点帧。
    pub(super) fn enter_parsing(&self, total: usize) {
        self.parsed_so_far.store(0, Ordering::Relaxed);
        self.last_frame_stamp.store(0, Ordering::Relaxed);
        self.dispatch_frame(
            "parsing",
            0,
            total,
            Some(format!("正在解析 {} 首歌曲", total)),
            false,
            false,
        );
    }

    /// 解析计数 +1（并行线程内调用）；按里程碑与时间窗双阈值决定放行。
    pub(super) fn advance_parse_tick(&self, total: usize) {
        let done_now = self.parsed_so_far.fetch_add(1, Ordering::Relaxed) + 1;
        let stamp = unix_millis_now();
        let window_open = stamp.saturating_sub(self.last_frame_stamp.load(Ordering::Relaxed))
            >= MIN_EMIT_GAP_MS;
        let milestone = done_now == 1 || done_now == total || done_now % 25 == 0;

        if !(milestone || window_open) {
            return;
        }

        self.last_frame_stamp.store(stamp, Ordering::Relaxed);
        self.dispatch_frame(
            "parsing",
            done_now,
            total,
            Some(format!("已解析 {done_now}/{total} 首歌曲")),
            false,
            false,
        );
    }

    /// 写库阶段帧。
    pub(super) fn report_writing(&self, current: usize, total: usize) {
        self.dispatch_frame(
            "writing",
            current,
            total,
            Some(format!("正在写入数据库 {current}/{total}")),
            false,
            false,
        );
    }

    /// 排空两个增量缓冲并发出 batch 帧；两个缓冲都空则跳过。
    fn flush_batch_queue(&self, stamp: u64) {
        let fresh_songs = self
            .pending_songs
            .lock()
            .map(|mut slot| std::mem::take(&mut *slot))
            .unwrap_or_default();
        let gone_paths = self
            .pending_paths
            .lock()
            .map(|mut slot| std::mem::take(&mut *slot))
            .unwrap_or_default();

        if fresh_songs.is_empty() && gone_paths.is_empty() {
            return;
        }

        self.last_flush_stamp.store(stamp, Ordering::Relaxed);
        let _ = self.handle.emit(
            EVENT_BATCH,
            BatchDelta {
                folder_total: self.scope_total,
                folder_index: self.scope_index,
                folder_path: self.scope_folder.clone(),
                deleted_paths: gone_paths,
                songs: fresh_songs,
            },
        );
    }

    /// 扫描完成收尾：先强制冲刷增量缓冲，再发 complete 帧。
    pub(super) fn conclude_success(&self, total_songs: usize) {
        self.flush_batch_queue(unix_millis_now());
        self.dispatch_frame(
            "complete",
            total_songs,
            total_songs,
            Some(format!("已完成扫描，共 {} 首歌曲", total_songs)),
            true,
            false,
        );
    }

    /// 扫描失败收尾：先强制冲刷增量缓冲，再发 error 帧。
    pub(super) fn conclude_failure(&self, message: String) {
        self.flush_batch_queue(unix_millis_now());
        self.dispatch_frame("error", 0, 0, Some(message), true, true);
    }

    /// 增量入队；距上次冲刷超过间隔就立即冲一次。
    pub(super) fn queue_delta(
        &self,
        fresh: Vec<crate::music::types::Song>,
        gone: Vec<String>,
    ) {
        if fresh.is_empty() && gone.is_empty() {
            return;
        }

        if let Ok(mut slot) = self.pending_songs.lock() {
            slot.extend(fresh);
        }
        if let Ok(mut slot) = self.pending_paths.lock() {
            slot.extend(gone);
        }

        let stamp = unix_millis_now();
        if stamp.saturating_sub(self.last_flush_stamp.load(Ordering::Relaxed)) >= MIN_EMIT_GAP_MS {
            self.flush_batch_queue(stamp);
        }
    }
}
