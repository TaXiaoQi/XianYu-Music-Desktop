use super::common::{LyricResult, LyricSongInfo};
use super::{
    kugou::fetch_kg_lyric, kw::fetch_kw_lyric, migu::fetch_mg_lyric, netease::fetch_wy_lyric,
    qq::fetch_tx_lyric,
};

// ==================== Tauri Command ====================

#[tauri::command]
pub async fn fetch_lyric_from_source(
    source: String,
    song_info: LyricSongInfo,
) -> Result<Option<LyricResult>, String> {
    let result = match source.as_str() {
        "kg" => fetch_kg_lyric(&song_info).await?,
        "kw" => fetch_kw_lyric(&song_info).await?,
        "tx" => fetch_tx_lyric(&song_info).await?,
        "wy" => fetch_wy_lyric(&song_info).await?,
        "mg" => fetch_mg_lyric(&song_info).await?,
        _ => return Ok(None),
    };
    Ok(result)
}
