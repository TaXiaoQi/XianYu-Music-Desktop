//! 收藏与最近播放的目录视图。
//!
//! 前端手里只有一批文件路径，后端负责把它们组织成歌手、专辑、歌单三种
//! 目录，并支持搜索、排序以及"某歌手 / 某专辑"的二级筛选。所有取数都是
//! 按路径逐条查 songs 表，路径数量由调用方决定（收藏条数或最近播放条数），
//! 规模可控，无需批量语句。

use std::collections::HashMap;

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::history::RecentHistoryImportEntry;
use super::support::text_cell;
use crate::database::DbState;
use crate::music::utils::normalize_path;

/// 归组时从 songs 表捞出的精简行：路径外加分类要用的几个字段。
#[derive(Debug)]
struct CatalogSongRow {
    path: String,                        // 首条命中路径，充当目录代表
    artist: String,                      // artist 单值，作最后兜底
    artist_names: Vec<String>,           // 标签解析出的歌手名单
    effective_artist_names: Vec<String>, // 人工校正后的歌手名单
    album: String,                       // 专辑名
    album_artist: String,                // 专辑歌手
    album_key: String,                   // 库里已存的专辑键，可能为空
}

/// 列表视图行：比归组行多出标题与两个时间戳。
#[derive(Debug)]
struct ViewSongRow {
    path: String,                        // 文件路径
    title: String,                       // 标签标题，可能为空串
    artist: String,                      // artist 单值
    artist_names: Vec<String>,           // 标签解析出的歌手名单
    effective_artist_names: Vec<String>, // 人工校正后的歌手名单
    album: String,                       // 专辑名
    album_artist: String,                // 专辑歌手
    album_key: String,                   // 库里已存的专辑键
    added_at: Option<i64>,               // 入库时间
    file_modified_at: Option<i64>,       // 文件改动时间
}

/// 列表排序档位。除 Title / Artist 外的各档都以标题作次级比较。
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub enum SongPathSortMode { // 对外序列化为 snake_case
    Title,             // 标题升序
    Artist,            // 歌手升序
    AddedAt,           // 入库时间降序
    AddedAtAsc,        // 入库时间升序
    FileModifiedAt,    // 文件时间降序
    FileModifiedAtAsc, // 文件时间升序
}

/// 最近播放聚合出的专辑目录项。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentAlbumCatalogItem { // 最近播放的专辑条目
    pub played_at: i64,          // 该专辑最近一次播放时刻
    pub key: String,             // 专辑标识
    pub name: String,            // 专辑展示名
    pub artist: String,          // 专辑歌手展示名
    pub first_song_path: String, // 代表曲目路径
}

/// 最近播放聚合出的歌单目录项。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlaylistCatalogItem { // 最近播放的歌单条目
    pub played_at: i64,          // 歌单内歌曲的最近播放时刻
    pub id: String,              // 歌单标识
    pub name: String,            // 歌单名
    pub count: u32,              // 歌单曲目数
    pub first_song_path: String, // 首条曲目路径
}

/// 前端传入的歌单项。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistImportItem { // 歌单导入项
    pub song_paths: Vec<String>, // 歌单内曲目路径
    pub id: String,              // 歌单标识
    pub name: String,            // 歌单名
}

/// 库里 artist_names 这类字段存的是 JSON 数组字符串，解析不出就当空列表。
fn json_list_or_empty(raw: Option<String>) -> Vec<String> {
    match raw {
        Some(text) => serde_json::from_str::<Vec<String>>(&text).unwrap_or_default(),
        None => Vec::new(),
    }
}

/// 展示名兜底：空白时给 "Unknown"，否则原样返回（不额外裁剪）。
fn or_unknown_label(value: &str) -> String {
    if value.trim().is_empty() {
        "Unknown".to_owned()
    } else {
        value.to_string()
    }
}

/// 取第一个非空白候选；全都空白时给 "Unknown"。
fn first_present_name(candidates: &[&str]) -> String {
    for candidate in candidates {
        if !candidate.trim().is_empty() {
            return (*candidate).to_string();
        }
    }
    "Unknown".to_owned()
}

/// 一首歌归到哪些歌手名下：校正名单优先，其次标签解析名单，最后退回单值。
fn artist_roster_of(effective: &[String], parsed: &[String], fallback: &str) -> Vec<String> {
    if !effective.is_empty() {
        return effective.to_vec();
    }
    if !parsed.is_empty() {
        return parsed.to_vec();
    }
    vec![fallback.to_string()]
}

/// 专辑稳定键：库里存过 album_key 就直接用；否则用小写专辑名 + 小写
/// 专辑歌手（两者都缺时补 unknown）拼出来。
fn album_identity_key(album: &str, album_artist: &str, artist: &str, stored_key: &str) -> String {
    if !stored_key.trim().is_empty() {
        return stored_key.to_owned();
    }

    let album_part = match album.trim().is_empty() {
        true => "unknown".to_owned(),
        false => album.to_ascii_lowercase(), // 仅 ASCII 小写，保持与既有键一致
    };
    let artist_part = if album_artist.trim().is_empty() {
        if artist.trim().is_empty() {
            "unknown".to_owned()
        } else {
            artist.to_ascii_lowercase() // 退回单曲歌手
        }
    } else {
        album_artist.to_ascii_lowercase() // 优先专辑歌手
    };

    format!("{album_part}::{artist_part}")
}

/// 取路径末段文件名，拿不到就整条路径凑合。
fn path_leaf_name(full_path: &str) -> String {
    match std::path::Path::new(full_path).file_name() {
        Some(leaf) => leaf.to_string_lossy().into_owned(),
        None => full_path.to_owned(),
    }
}

/// 列表里的歌名：标签没写标题时用文件名顶上。
fn view_display_title(row: &ViewSongRow) -> String {
    if !row.title.trim().is_empty() {
        return row.title.clone();
    }
    path_leaf_name(&row.path)
}

/// 搜索匹配：文件名、标题、歌手、专辑、专辑歌手，以及解析出的每个歌手名，
/// 命中任意一个即通过；空查询直接放行。
fn row_passes_search(row: &ViewSongRow, needle: &str) -> bool {
    let lowered = needle.trim().to_lowercase();
    if lowered.is_empty() {
        return true;
    }

    let plain_fields = [
        path_leaf_name(&row.path).to_lowercase(),
        row.title.to_lowercase(),
        row.artist.to_lowercase(),
        row.album.to_lowercase(),
        row.album_artist.to_lowercase(),
    ];
    if plain_fields.iter().any(|field| field.contains(&lowered)) {
        return true;
    }

    artist_roster_of(&row.effective_artist_names, &row.artist_names, &row.artist)
        .iter()
        .any(|name| name.to_lowercase().contains(&lowered))
}

/// 精确判断这首歌是否属于某个歌手（按解析后的歌手名单比对）。
fn row_under_artist(row: &ViewSongRow, wanted: &str) -> bool {
    artist_roster_of(&row.effective_artist_names, &row.artist_names, &row.artist)
        .iter()
        .any(|name| name == wanted)
}

/// 视图行排序。除 Title / Artist 外的档位都以标题作次级比较。
fn order_view_rows(rows: &mut [ViewSongRow], sort_mode: &SongPathSortMode) {
    rows.sort_by(|left, right| {
        let by_title = || {
            view_display_title(left).to_lowercase().cmp(&view_display_title(right).to_lowercase())
        };

        match sort_mode {
            SongPathSortMode::Title => by_title(),
            SongPathSortMode::Artist => {
                left.artist.to_lowercase().cmp(&right.artist.to_lowercase()).then_with(by_title)
            }
            SongPathSortMode::AddedAt => {
                right.added_at.unwrap_or_default().cmp(&left.added_at.unwrap_or_default()).then_with(by_title)
            }
            SongPathSortMode::AddedAtAsc => {
                left.added_at.unwrap_or_default().cmp(&right.added_at.unwrap_or_default()).then_with(by_title)
            }
            SongPathSortMode::FileModifiedAt => {
                right.file_modified_at.unwrap_or_default().cmp(&left.file_modified_at.unwrap_or_default()).then_with(by_title)
            }
            SongPathSortMode::FileModifiedAtAsc => {
                left.file_modified_at.unwrap_or_default().cmp(&right.file_modified_at.unwrap_or_default()).then_with(by_title)
            }
        }
    });
}

/// 按路径读一条归组行，查不到时得到 None。
fn fetch_grouping_row(conn: &rusqlite::Connection, norm_path: &str) -> Result<Option<CatalogSongRow>, String> {
    let found = conn.query_row(
        "SELECT path, artist, artist_names, effective_artist_names, album, album_artist, album_key
         FROM songs
         WHERE path = ?1",
        [norm_path],
        |record| {
            Ok(CatalogSongRow {
                path: record.get(0)?,
                artist: text_cell(record, 1)?,
                artist_names: json_list_or_empty(record.get(2)?),
                effective_artist_names: json_list_or_empty(record.get(3)?),
                album: text_cell(record, 4)?,
                album_artist: text_cell(record, 5)?,
                album_key: text_cell(record, 6)?,
            })
        },
    );
    found.optional().map_err(|err| err.to_string())
}

/// 按路径读一条列表视图行，查不到时得到 None。
fn fetch_listing_row(conn: &rusqlite::Connection, norm_path: &str) -> Result<Option<ViewSongRow>, String> {
    let found = conn.query_row(
        "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, added_at, file_modified_at
         FROM songs
         WHERE path = ?1",
        [norm_path],
        |record| {
            Ok(ViewSongRow {
                path: record.get(0)?,
                title: text_cell(record, 1)?,
                artist: text_cell(record, 2)?,
                artist_names: json_list_or_empty(record.get(3)?),
                effective_artist_names: json_list_or_empty(record.get(4)?),
                album: text_cell(record, 5)?,
                album_artist: text_cell(record, 6)?,
                album_key: text_cell(record, 7)?,
                added_at: record.get(8)?,
                file_modified_at: record.get(9)?,
            })
        },
    );
    found.optional().map_err(|err| err.to_string())
}

/// 把收藏列表归成歌手目录：歌手按出现次数计数，再回查 artists 表补头像。
#[tauri::command]
pub fn get_favorite_artist_catalog(db: State<DbState>, favorite_paths: Vec<String>)
    -> Result<Vec<crate::music::types::ArtistCatalogItem>, String> {
    if favorite_paths.is_empty() { return Ok(vec![]); }

    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let mut tally = HashMap::<String, (u32, String)>::new();

    for raw in favorite_paths {
        let norm = normalize_path(&raw);
        if norm.is_empty() { continue; }

        let Some(row) = fetch_grouping_row(&conn, &norm)? else { continue; };

        for name in artist_roster_of(&row.effective_artist_names, &row.artist_names, &row.artist) {
            let bucket = tally
                .entry(or_unknown_label(&name))
                .or_insert((0u32, row.path.clone()));
            bucket.0 = bucket.0.saturating_add(1);
        }
    }

    let mut stmt = conn.prepare("SELECT id, avatar_path FROM artists WHERE name = ?").map_err(|err| err.to_string())?;

    let mut ranked: Vec<crate::music::types::ArtistCatalogItem> = Vec::new();
    for (artist_name, (plays, sample_path)) in tally {
        let found = stmt
            .query_row([&artist_name], |row| {
                let id: i64 = row.get(0)?;
                let avatar: Option<String> = row.get(1)?;
                Ok((id, avatar))
            })
            .unwrap_or_else(|_| (0, None));

        ranked.push(crate::music::types::ArtistCatalogItem {
            id: found.0,
            name: artist_name,
            count: plays,
            first_song_path: sample_path,
            avatar_path: found.1,
        });
    }

    ranked.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(ranked)
}

/// 把收藏列表归成专辑目录：同键专辑合并计数，首个路径作代表。
#[tauri::command]
pub fn get_favorite_album_catalog(db: State<DbState>, favorite_paths: Vec<String>)
    -> Result<Vec<crate::music::types::AlbumCatalogItem>, String> {
    if favorite_paths.is_empty() { return Ok(vec![]); }

    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let mut grouped_by_album = HashMap::<String, crate::music::types::AlbumCatalogItem>::new();

    for raw in favorite_paths {
        let norm = normalize_path(&raw);
        if norm.is_empty() { continue; }

        let Some(row) = fetch_grouping_row(&conn, &norm)? else { continue; };

        let album_key = album_identity_key(&row.album, &row.album_artist, &row.artist, &row.album_key);
        let slot = grouped_by_album
            .entry(album_key.clone())
            .or_insert_with(|| crate::music::types::AlbumCatalogItem {
                key: album_key,
                name: or_unknown_label(&row.album),
                count: 0, // 后续逐条累加
                artist: first_present_name(&[row.album_artist.as_str(), row.artist.as_str()]),
                first_song_path: row.path.clone(), // 代表曲目
            });

        slot.count = slot.count.saturating_add(1);
    }

    let mut ranked: Vec<crate::music::types::AlbumCatalogItem> =
        grouped_by_album.into_values().collect();
    ranked.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.artist.to_lowercase().cmp(&right.artist.to_lowercase()))
    });

    Ok(ranked)
}

/// 把最近播放归成专辑目录，每张专辑只保留最近一次播放的时间与路径。
#[tauri::command]
pub fn get_recent_album_catalog(db: State<DbState>, recent_entries: Vec<RecentHistoryImportEntry>)
    -> Result<Vec<RecentAlbumCatalogItem>, String> {
    if recent_entries.is_empty() { return Ok(vec![]); }

    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let mut grouped_by_album = HashMap::<String, RecentAlbumCatalogItem>::new();

    for item in recent_entries {
        let norm = normalize_path(&item.song_path);
        if norm.is_empty() { continue; }

        let Some(row) = fetch_grouping_row(&conn, &norm)? else { continue; };

        let album_key = album_identity_key(&row.album, &row.album_artist, &row.artist, &row.album_key);
        let stamp = item.played_at;

        let existing = grouped_by_album.get_mut(&album_key);
        if let Some(current) = existing {
            // 只认更晚的播放；时刻并列时保留原先的代表路径。
            if stamp > current.played_at {
                current.played_at = stamp;
                current.first_song_path = row.path.clone();
            }
        } else {
            grouped_by_album.insert(album_key.clone(), RecentAlbumCatalogItem {
                key: album_key,
                name: or_unknown_label(&row.album),
                artist: first_present_name(&[row.album_artist.as_str(), row.artist.as_str()]),
                played_at: stamp,
                first_song_path: row.path.clone(), // 首次出现时的路径
            });
        }
    }

    let mut ranked: Vec<RecentAlbumCatalogItem> = grouped_by_album.into_values().collect();
    ranked.sort_by(|left, right| right.played_at.cmp(&left.played_at));
    Ok(ranked)
}

/// 收藏列表的歌曲路径视图：支持搜索、排序，以及"某歌手 / 某专辑"的二级筛选。
#[tauri::command]
pub fn get_favorite_song_paths_view(db: State<DbState>, favorite_paths: Vec<String>, query: Option<String>,
    sort_mode: SongPathSortMode, detail_filter_type: Option<String>, detail_filter_value: Option<String>,
)
    -> Result<Vec<String>, String> {
    if favorite_paths.is_empty() { return Ok(vec![]); }

    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let search_text = query.map(|raw| raw.trim().to_lowercase());
    let filter_kind = detail_filter_type
        .map(|raw| raw.trim().to_lowercase())
        .filter(|text| !text.is_empty());
    let filter_value = detail_filter_value
        .map(|raw| raw.trim().to_string())
        .filter(|text| !text.is_empty());

    let mut rows: Vec<ViewSongRow> = Vec::new();

    for raw in favorite_paths {
        let norm = normalize_path(&raw);
        if norm.is_empty() { continue; }

        let Some(row) = fetch_listing_row(&conn, &norm)? else { continue; };

        // 二级筛选：指定歌手或专辑时，不匹配的行直接跳过。
        let passes_filter = if filter_kind.as_deref() == Some("artist") {
            filter_value.as_deref().map_or(true, |wanted| row_under_artist(&row, wanted))
        } else if filter_kind.as_deref() == Some("album") {
            filter_value.as_deref().map_or(true, |wanted| {
                album_identity_key(&row.album, &row.album_artist, &row.artist, &row.album_key)
                    == wanted
            })
        } else {
            true
        };
        if !passes_filter {
            continue;
        }

        if let Some(needle) = search_text.as_deref() {
            if !row_passes_search(&row, needle) {
                continue;
            }
        }

        rows.push(row); // 筛选与搜索都通过，收下这条
    }

    order_view_rows(&mut rows, &sort_mode);
    Ok(rows.into_iter().map(|item| item.path).collect())
}

/// 最近播放的歌曲路径视图：同一路径只留最新时刻，再按搜索与排序输出。
#[tauri::command]
pub fn get_recent_song_paths_view(
    db: State<DbState>, recent_entries: Vec<RecentHistoryImportEntry>,
    query: Option<String>, sort_mode: SongPathSortMode,
)
    -> Result<Vec<String>, String> {
    if recent_entries.is_empty() { return Ok(vec![]); }

    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let search_text = query.map(|raw| raw.trim().to_lowercase());

    // 先折叠出每个路径最近一次的播放时刻。
    let mut newest_by_path = HashMap::<String, i64>::new();
    for item in recent_entries {
        let norm = normalize_path(&item.song_path);
        if norm.is_empty() { continue; }

        let slot = newest_by_path.entry(norm).or_insert(item.played_at);
        *slot = (*slot).max(item.played_at);
    }

    let mut rows: Vec<ViewSongRow> = Vec::new();
    for norm in newest_by_path.into_keys() {
        let Some(row) = fetch_listing_row(&conn, &norm)? else { continue; };

        if let Some(needle) = search_text.as_deref() {
            if !row_passes_search(&row, needle) {
                continue;
            }
        }

        rows.push(row); // 搜索通过，收下这条
    }

    order_view_rows(&mut rows, &sort_mode);
    Ok(rows.into_iter().map(|item| item.path).collect())
}

/// 歌单目录：用歌单内歌曲的最近播放时间代表歌单的播放时间，
/// 一首都没听过的歌单不出现在结果里。
#[tauri::command]
pub fn get_recent_playlist_catalog(playlists: Vec<PlaylistImportItem>, recent_entries: Vec<RecentHistoryImportEntry>)
    -> Result<Vec<RecentPlaylistCatalogItem>, String> {
    if playlists.is_empty() || recent_entries.is_empty() { return Ok(vec![]); }

    // 路径 → 最近一次播放时刻。
    let mut newest_by_path = HashMap::<String, i64>::new();
    for item in recent_entries {
        let norm = normalize_path(&item.song_path);
        if norm.is_empty() { continue; }

        let slot = newest_by_path.entry(norm).or_insert(item.played_at);
        *slot = (*slot).max(item.played_at);
    }

    let mut output: Vec<RecentPlaylistCatalogItem> = Vec::new();

    for playlist in playlists { // 逐个歌单求最近播放
        let mut newest = 0i64;

        for track_path in &playlist.song_paths {
            if let Some(&stamp) = newest_by_path.get(&normalize_path(track_path)) {
                newest = newest.max(stamp);
            }
        }

        if newest <= 0 { continue; }

        output.push(RecentPlaylistCatalogItem {
            id: playlist.id,     // 歌单标识
            name: playlist.name, // 展示名
            count: u32::try_from(playlist.song_paths.len()).unwrap_or(u32::MAX),
            played_at: newest,
            first_song_path: playlist.song_paths.first().map(String::clone).unwrap_or_default(),
        });
    }

    output.sort_by(|left, right| right.played_at.cmp(&left.played_at));
    Ok(output)
}
