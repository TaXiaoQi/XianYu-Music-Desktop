//! 扫描流程编排子模块。把 快照加载 → 差异计算 → 头像落盘 → 差异入库 →
//! 进度收尾 连成完整链路，并集中声明对外的 Tauri 命令。
//!
//! 命令清单（lib.rs 注册、前端 invoke；函数名 / 参数名 / 返回类型冻结）：
//! - `scan_music_folder`        扫描单个音乐文件夹并入库
//! - `parse_audio_files`        仅解析给定路径清单（不写库）
//! - `parse_music_folder`       递归收集文件夹内可解析路径后批量解析
//! - `scan_folder_as_playlists` 扫描并把结果按子文件夹组织成播放列表
//! - `get_folder_first_song`    查询某文件夹下的第一首歌路径

use super::super::types::FolderNode;
use super::super::types::{GeneratedFolder, Song};
use super::super::utils::{
    descendant_like_patterns, is_supported_library_extension, normalize_path,
};
use super::diff::{build_scan_delta, load_db_snapshot, FolderDiff};
use super::parser::parse_given_paths;
use super::progress::ScanProgressReporter as ScanNotifier;
use super::ScanOptions;
use crate::database::DbState;
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use walkdir::WalkDir;

// ---------- 内部协作 ----------

/// 内嵌头像落盘：只有“单一真实歌手”的曲目才写头像文件。
///
/// 落库前先按路径排序，保证写入顺序稳定；无论是否写出文件，
/// 曲目上的头像字节缓存都会被释放，避免序列化出超大负载。
fn spill_avatar_images(delta: &mut FolderDiff, app: Option<&AppHandle>) {
    let cache_dir = app.map(crate::music::covers::get_cover_cache_dir);

    let order_by_route = |rows: &mut Vec<Song>| rows.sort_by(|a, b| a.path.cmp(&b.path));
    order_by_route(&mut delta.to_add);
    order_by_route(&mut delta.to_update);

    for track in delta.to_add.iter_mut().chain(delta.to_update.iter_mut()) {
        let png = track.artist_avatar_bytes.take();
        if let (Some(dir), Some(png)) = (cache_dir.as_deref(), png) {
            if super::exclusive_real_artist(track).is_some() {
                track.artist_avatar_path =
                    crate::music::covers::save_artist_avatar_auto(&png, dir);
            }
        }
    }
}

/// 把差异清单交给落库层执行；需要独占数据库连接，失败原样上抛。
fn hand_delta_to_store(
    db_conn: &Arc<Mutex<rusqlite::Connection>>,
    delta: &FolderDiff,
    reporter: Option<&ScanNotifier>,
) -> Result<(), String> {
    let mut guard = db_conn.lock().map_err(|error| error.to_string())?;
    super::apply_scan_changes(
        &mut guard,
        &delta.to_add,
        &delta.to_update,
        &delta.to_delete,
        reporter,
    )
}

// ---------- 核心扫描 ----------

/// 扫描单个文件夹的完整实现：命令层与工具箱后台扫描共用。
///
/// 断连保护：磁盘上没有任何候选、库内却存在该文件夹的歌曲、且目录当前
/// 打不开时，判定为临时断连——不执行删除，直接报错返回。
pub fn scan_single_directory_internal(
    folder_path: String,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    app: Option<AppHandle>,
    folder_index: usize,
    folder_total: usize,
    options: ScanOptions,
) -> Result<Vec<Song>, String> {
    let root = normalize_path(&folder_path);
    let notifier = app
        .as_ref()
        .map(|handle| ScanNotifier::attach(handle.clone(), root.clone(), folder_index, folder_total));

    let (snapshot, snapshot_rows) = {
        let guard = db_conn.lock().map_err(|error| error.to_string())?;
        let taken = load_db_snapshot(&guard, &root)?;
        let rows = taken.len();
        (taken, rows)
    };
    let mut delta = build_scan_delta(&root, snapshot, notifier.as_ref(), options)?;

    let dir_open = Path::new(&root).is_dir() && fs::read_dir(&root).is_ok();
    if !delta.has_disk_songs && snapshot_rows > 0 && !dir_open {
        let failure = "文件夹可能已断开连接或路径错误，未执行删除操作".to_string();
        if let Some(notifier) = notifier.as_ref() {
            notifier.conclude_failure(failure.clone());
        }
        return Err(failure);
    }

    spill_avatar_images(&mut delta, app.as_ref());
    hand_delta_to_store(&db_conn, &delta, notifier.as_ref())?;

    if let Some(notifier) = notifier.as_ref() {
        notifier.conclude_success(delta.songs.len());
    }

    Ok(delta.songs)
}

// ---------- Tauri 命令 ----------

/// 扫描单个音乐文件夹并入库。
#[tauri::command]
pub async fn scan_music_folder(
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<Song>, String> {
    let handle = db_state.conn.clone();
    let options = ScanOptions {
        min_duration_secs: minimum_duration_seconds.unwrap_or(0),
    };

    // 命令入口固定按“只有一个文件夹”的上下文上报进度（索引 1/1）。
    let pending = tauri::async_runtime::spawn_blocking(move || {
        scan_single_directory_internal(
            folder_path,
            handle,
            Some(app),
            1,
            1,
            options,
        )
    });
    pending.await.map_err(|error| error.to_string())?
}

/// 仅解析给定路径清单并返回结果，不写库。
#[tauri::command]
pub async fn parse_audio_files(
    paths: Vec<String>,
    minimum_duration_seconds: Option<u32>,
) -> Result<Vec<Song>, String> {
    let options = ScanOptions {
        min_duration_secs: minimum_duration_seconds.unwrap_or(0),
    };

    let decoded = tauri::async_runtime::spawn_blocking(move || parse_given_paths(paths, options))
        .await
        .map_err(|error| error.to_string())?;
    Ok(decoded)
}

/// 递归收集文件夹内受支持路径后批量解析，不写库。
#[tauri::command]
pub async fn parse_music_folder(
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
) -> Result<Vec<Song>, String> {
    let options = ScanOptions {
        min_duration_secs: minimum_duration_seconds.unwrap_or(0),
    };

    let pending = tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&folder_path);
        if !root.is_dir() || fs::read_dir(root).is_err() {
            return Err("所选路径不是可读取的文件夹".to_string());
        }

        // 递归收罗所有受支持扩展名的文件，排序去重后交给批量解析。
        let mut candidates: Vec<String> = Vec::new();
        for entry in WalkDir::new(root).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let ext = entry
                .path()
                .extension()
                .map(|piece| piece.to_string_lossy().to_lowercase());
            match ext {
                Some(kind) if is_supported_library_extension(&kind) => {
                    candidates.push(normalize_path(&entry.path().to_string_lossy()));
                }
                _ => {}
            }
        }
        candidates.sort();
        candidates.dedup();

        Ok(parse_given_paths(candidates, options))
    });
    pending.await.map_err(|error| error.to_string())?
}

/// 扫描并把结果按子文件夹组织成播放列表。
#[tauri::command]
pub async fn scan_folder_as_playlists(
    root_path: String,
    minimum_duration_seconds: Option<u32>,
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<GeneratedFolder>, String> {
    let songs = scan_music_folder(
        root_path.clone(),
        minimum_duration_seconds,
        app,
        db_state,
    )
    .await?;

    // 依父目录分堆，每堆对应一个播放列表。
    let mut piles: HashMap<PathBuf, Vec<Song>> = HashMap::new();
    for track in songs {
        if let Some(parent) = Path::new(&track.path).parent() {
            piles.entry(parent.to_path_buf()).or_default().push(track);
        }
    }

    let mut playlists: Vec<GeneratedFolder> = piles
        .into_iter()
        .filter(|(_, pile)| !pile.is_empty())
        .map(|(dir, pile)| {
            let label = dir
                .file_name()
                .map(|piece| piece.to_string_lossy().into_owned())
                .unwrap_or_else(|| "未知文件夹".to_string());
            GeneratedFolder {
                name: label,
                path: dir.to_string_lossy().into_owned(),
                songs: pile,
            }
        })
        .collect();
    playlists.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(playlists)
}

/// 查询文件夹首曲路径。
#[tauri::command]
pub async fn get_folder_first_song(
    folder_path: String,
    db_state: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let handle = db_state.conn.clone();

    let pending = tauri::async_runtime::spawn_blocking(move || {
        let guard = handle.lock().map_err(|error| error.to_string())?;
        let target = Path::new(&folder_path);
        Ok(locate_first_track(target, &guard))
    });
    pending.await.map_err(|error| error.to_string())?
}

// ---------- 文件夹树查询 ----------

/// 取某文件夹（含全部子目录）下路径排序最小的歌曲路径。
fn locate_first_track(path: &Path, conn: &rusqlite::Connection) -> Option<String> {
    let root_text = normalize_path(&path.to_string_lossy());
    let (mark_exact, mark_deep) = descendant_like_patterns(&root_text);

    let mut lookup = conn
        .prepare(
            "SELECT path
             FROM songs
             WHERE path = ?1
                OR path LIKE ?2 ESCAPE '^'
                OR path LIKE ?3 ESCAPE '^'
             ORDER BY path ASC
             LIMIT 1",
        )
        .ok()?;

    lookup
        .query_row(params![&root_text, mark_exact, mark_deep], |row| row.get(0))
        .optional()
        .ok()?
}

/// 统计某文件夹（含全部子目录）内的歌曲数量；查询失败按 0 计。
fn tally_descendant_songs(folder: &Path, conn: &rusqlite::Connection) -> usize {
    let root_text = normalize_path(&folder.to_string_lossy());
    let (mark_exact, mark_deep) = descendant_like_patterns(&root_text);

    let hits: i64 = conn
        .query_row(
            "SELECT COUNT(*)
         FROM songs
         WHERE path = ?1
            OR path LIKE ?2 ESCAPE '^'
            OR path LIKE ?3 ESCAPE '^'",
            params![&root_text, mark_exact, mark_deep],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0);

    hits.max(0) as usize
}

/// 列出文件夹的直接子目录并按名字排序；目录不可读时交回 None。
fn child_dirs_sorted(folder: &Path) -> Option<Vec<PathBuf>> {
    let mut kids: Vec<PathBuf> = fs::read_dir(folder)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();

    let name_of = |candidate: &Path| {
        candidate
            .file_name()
            .map(|piece| piece.to_string_lossy().into_owned())
            .unwrap_or_else(|| candidate.to_string_lossy().into_owned())
    };
    kids.sort_by(|left, right| name_of(left).cmp(&name_of(right)));

    Some(kids)
}

/// 递归构建文件夹树节点（库文件夹浏览页使用）。
///
/// 深度未达上限时预展开子节点；歌曲计数覆盖当前节点及全部后代。
pub fn scan_folder_recursive(
    folder_path: PathBuf,
    current_depth: u32,
    max_depth: u32,
    conn: &rusqlite::Connection,
) -> Option<FolderNode> {
    // 深度超限直接放弃，防止对超深目录树无限展开。
    if current_depth > max_depth {
        return None;
    }

    let node_path = normalize_path(&folder_path.to_string_lossy());
    let folder_name = folder_path
        .file_name()
        .map(|piece| piece.to_string_lossy().into_owned())
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| node_path.clone());

    let kids = child_dirs_sorted(&folder_path)?;
    let kid_total = kids.len();
    let preload = current_depth < max_depth;
    let children: Vec<FolderNode> = if preload {
        kids.iter()
            .filter_map(|kid| {
                scan_folder_recursive(kid.clone(), current_depth + 1, max_depth, conn)
            })
            .collect()
    } else {
        Vec::new()
    };
    let song_total = tally_descendant_songs(&folder_path, conn);

    Some(FolderNode {
        name: folder_name,
        path: node_path,
        children,
        child_count: kid_total,
        children_loaded: preload || kid_total == 0,
        song_count: song_total,
        cover_song_path: if song_total > 0 {
            locate_first_track(&folder_path, conn)
        } else {
            None
        },
        is_expanded: false,
    })
}
