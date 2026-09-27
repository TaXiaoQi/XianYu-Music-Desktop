//! 快照身份与本地曲库之间的匹配。
//!
//! 导出的统计只带标题 / 歌手 / 专辑 / 时长，不带文件路径。换过机器或者
//! 重新扫过目录之后，需要在本地曲库里把这首歌找回去。这里用三级键由严
//! 到宽依次尝试：四级全等、去掉专辑、只剩标题。每一级都要求恰好命中一条，
//! 命中多条说明无法判断，直接放弃这一级继续放宽。

use std::collections::HashMap;

use super::portable::PortableSongIdentity;
use super::support::{
    build_song_identity, full_match_key, text_cell, title_artist_match_key, title_only_match_key,
    track_number_from_raw,
};

/// 一次匹配命中的曲库条目：文件路径加组装出的身份。
#[derive(Clone, Debug)]
pub(crate) struct SongMatchHit {
    pub(crate) path: String,
    pub(crate) identity: PortableSongIdentity,
}

/// 三级倒排表，桶键分别为严格键、去专辑键、仅标题键。
#[derive(Default)]
pub(crate) struct SongMatchTable {
    strict_hits: HashMap<String, Vec<SongMatchHit>>,
    no_album_hits: HashMap<String, Vec<SongMatchHit>>,
    title_hits: HashMap<String, Vec<SongMatchHit>>,
}

/// 扫一遍 songs 表，把每首歌按三种键各挂一次。
pub(crate) fn build_library_match_index(conn: &rusqlite::Connection) -> Result<SongMatchTable, String> {
    let mut stmt = conn.prepare("SELECT path, title, artist, album, duration, track_number FROM songs").map_err(|err| err.to_string())?;

    let mapped = stmt
        .query_map([], |entry| {
            let path: String = entry.get(0)?;
            let title: String = text_cell(entry, 1)?;
            let artist: String = text_cell(entry, 2)?;
            let album: String = text_cell(entry, 3)?;
            let duration: i64 = entry.get::<_, Option<i64>>(4)?.unwrap_or_default();
            let track_raw: Option<String> = entry.get(5)?;
            Ok((path, title, artist, album, duration, track_raw))
        })
        .map_err(|err| err.to_string())?;

    let mut table = SongMatchTable::default();

    for (path, title, artist, album, duration, track_raw) in mapped.flatten() {
        let identity = build_song_identity(
            &title,
            &artist,
            &album,
            duration.max(0) * 1000,
            track_number_from_raw(track_raw.as_deref()),
            Some(&path),
        );
        let hit = SongMatchHit {
            path,
            identity: identity.clone(), // 身份本体还要参与下方建键
        };

        table.strict_hits.entry(full_match_key(&identity)).or_default().push(hit.clone());
        table.no_album_hits.entry(title_artist_match_key(&identity)).or_default().push(hit.clone());
        table.title_hits.entry(title_only_match_key(&identity)).or_default().push(hit);
    }

    Ok(table)
}

/// 桶里恰好一条才算命中：零条是没匹配上，多条是无法判断。
fn only_candidate(bucket: &HashMap<String, Vec<SongMatchHit>>, key: &str) -> Option<SongMatchHit> {
    bucket.get(key).and_then(|hits| match hits.as_slice() {
        [only] => Some(only.clone()),
        _ => None,
    })
}

/// 由严到宽依次尝试三级键，返回第一条唯一命中的曲库条目。
pub(crate) fn match_song_identity(table: &SongMatchTable, identity: &PortableSongIdentity) -> Option<SongMatchHit> {
    only_candidate(&table.strict_hits, &full_match_key(identity))
        .or_else(|| only_candidate(&table.no_album_hits, &title_artist_match_key(identity)))
        .or_else(|| only_candidate(&table.title_hits, &title_only_match_key(identity)))
}
