// 歌手与专辑目录：聚合条目构造与按目录取曲目路径。

use tauri::State;

use crate::database::{DbState};
use crate::music::types::{AlbumCatalogItem, ArtistCatalogItem};
use crate::music::utils::clamp_i64_to_u32; // 实现

use super::common::{db_err, prepare, run_with_db, string_column};

// 歌手目录行 → ArtistCatalogItem。
fn artist_catalog_entry(row: &rusqlite::Row) -> rusqlite::Result<ArtistCatalogItem> {
  let artist_id: i64 = row.get(0)?;
  let artist_name: String = row.get(1)?;
  let song_total: i64 = row.get(2)?;
  let lead_path: String = row.get(3)?;
  let avatar: Option<String> = row.get(4)?;
  Ok(ArtistCatalogItem {
    id: artist_id,
    name: artist_name,
    count: clamp_i64_to_u32(song_total),
    first_song_path: lead_path,
    avatar_path: avatar,
  })
}

/// 歌手目录：按歌手聚合曲目数与代表作路径。
#[tauri::command] // 实现
pub async fn get_library_artist_catalog( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<ArtistCatalogItem>, String> { // 实现
  run_with_db(&db_state, |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT artists.id,
                        artists.name, 
                        COUNT(song_artists.song_id) AS song_count, 
                        COALESCE((
                            SELECT songs.path 
                            FROM song_artists AS nested_song_artists 
                            JOIN songs ON songs.id = nested_song_artists.song_id 
                            WHERE nested_song_artists.artist_id = artists.id 
                            ORDER BY songs.added_at DESC, songs.id ASC 
                            LIMIT 1
                        ), ''),
                        artists.avatar_path 
                 FROM artists 
                 JOIN song_artists ON song_artists.artist_id = artists.id 
                 GROUP BY artists.id, artists.name 
                 ORDER BY artists.name COLLATE NOCASE ASC", 
    )?;

    let mut rows = stmt.query([]).map_err(db_err)?;
    let mut roster = Vec::new();
    while let Some(row) = rows.next().map_err(db_err)? {
      if let Ok(entry) = artist_catalog_entry(row) {
        roster.push(entry);
      }
    }
    Ok(roster)
  })
  .await
}

// 专辑目录行 → AlbumCatalogItem；无 album_key 时用「album::artist」小写合成键。
fn album_catalog_entry(row: &rusqlite::Row) -> rusqlite::Result<AlbumCatalogItem> {
  let raw_key: String = row.get(0)?;
  let album_name: String = row.get(1)?;
  let album_owner: String = row.get(2)?;
  let song_total: i64 = row.get(3)?;
  let lead_path: String = row.get(4)?;

  let identity = match raw_key.trim().is_empty() {
    true => format!(
      "{}::{}",
      album_name.to_ascii_lowercase(),
      album_owner.to_ascii_lowercase()
    ),
    false => raw_key,
  };
  Ok(AlbumCatalogItem {
    key: identity,
    name: album_name,
    count: clamp_i64_to_u32(song_total),
    artist: album_owner,
    first_song_path: lead_path,
  })
}

/// 专辑目录：按专辑三元组聚合曲目数与首曲路径。
#[tauri::command] // 实现
pub async fn get_library_album_catalog( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<AlbumCatalogItem>, String> { // 实现
  run_with_db(&db_state, |conn| {
        let mut stmt = prepare(
            conn,
            "SELECT
                    COALESCE(NULLIF(TRIM(album_key), ''), '') AS album_key, 
                    COALESCE(NULLIF(TRIM(album), ''), 'Unknown') AS album_name, 
                    COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown') AS album_artist_name, 
                    COUNT(*) AS song_count, 
                    COALESCE((
                        SELECT nested.path 
                        FROM songs AS nested 
                        WHERE (
                            COALESCE(NULLIF(TRIM(nested.album_key), ''), '') = COALESCE(NULLIF(TRIM(songs.album_key), ''), '') 
                            AND COALESCE(NULLIF(TRIM(nested.album), ''), 'Unknown') = COALESCE(NULLIF(TRIM(songs.album), ''), 'Unknown') 
                            AND COALESCE(NULLIF(TRIM(nested.album_artist), ''), NULLIF(TRIM(nested.artist), ''), 'Unknown') 
                                = COALESCE(NULLIF(TRIM(songs.album_artist), ''), NULLIF(TRIM(songs.artist), ''), 'Unknown') 
                        )
                        ORDER BY nested.added_at DESC, nested.id ASC 
                        LIMIT 1
                    ), '') AS first_song_path 
                 FROM songs
                 GROUP BY
                    COALESCE(NULLIF(TRIM(album_key), ''), ''), 
                    COALESCE(NULLIF(TRIM(album), ''), 'Unknown'), 
                    COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown') 
                 ORDER BY album_name COLLATE NOCASE ASC, album_artist_name COLLATE NOCASE ASC", 
        )?;

        let mut rows = stmt.query([]).map_err(db_err)?;
        let mut shelf = Vec::new();
        while let Some(row) = rows.next().map_err(db_err)? {
            if let Ok(entry) = album_catalog_entry(row) {
                shelf.push(entry);
            }
        }
        Ok(shelf)
    })
    .await
}

/// 某位歌手名下的全部曲目路径（标题排序）。
#[tauri::command] // 实现
pub async fn get_library_song_paths_by_artist( // 实现
  artist_name: String,
  db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> { // 实现
  run_with_db(&db_state, move |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT songs.path
             FROM songs
             JOIN song_artists ON song_artists.song_id = songs.id
             JOIN artists ON artists.id = song_artists.artist_id
             WHERE artists.name = ?1 COLLATE NOCASE
             GROUP BY songs.id, songs.path
             ORDER BY COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
    )?;
    string_column(&mut stmt, [artist_name])
  })
  .await
}

/// 某张专辑（合成键）名下的全部曲目路径（标题排序）。
#[tauri::command] // 实现
pub async fn get_library_song_paths_by_album( // 实现
  album_key: String,
  db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> { // 实现
  run_with_db(&db_state, move |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT path
             FROM songs
             WHERE LOWER(
                COALESCE(
                  NULLIF(TRIM(album_key), ''),
                  COALESCE(NULLIF(TRIM(album), ''), 'Unknown') || '::' ||
                  COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown')
                )
             ) = LOWER(?1)
             ORDER BY COALESCE(NULLIF(TRIM(title), ''), path) COLLATE NOCASE ASC",
    )?;
    string_column(&mut stmt, [album_key])
  })
  .await
}
