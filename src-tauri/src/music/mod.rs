// 曲库域模块聚合入口。
// 对外暴露三类能力：曲库扫描（scanner）、标签与文件编辑（tags/files/covers/cue）、
// 查询目录（library），其余为歌词、调色板、远程音源等辅助子模块。

pub mod auth;
pub mod covers; // 实现
pub mod cue; // 实现
pub mod files; // 实现
pub mod library; // 实现
pub mod lx_search;
pub mod lyric_fetcher;
pub mod lyrics; // 实现
pub mod palette;
pub mod playlist_fetcher;
pub mod scanner; // 实现
pub mod tags; // 实现
pub mod types; // 实现
pub mod url_resolver;
pub mod utils; // 实现

// ---------- 共享数据契约（serde 字段名被前端依赖，冻结） ----------
pub use types::*; // 实现

// ---------- 标签写入 / 远程音源 / 调色板 ----------
pub use auth::{
  authed_request, clear_auth_credentials, get_auth_api_secret, get_auth_base_url,
  get_auth_credentials, save_auth_credentials, set_auth_api_secret, set_auth_base_url,
};
pub use lyric_fetcher::{decrypt_plugin_lyric, fetch_lyric_from_source};
pub use playlist_fetcher::fetch_playlist_from_source;
pub use palette::extract_palette;
pub use url_resolver::{find_alternative_lx_source, get_lx_cover};

// ---------- 封面缓存 ----------
pub use covers::{clear_cover_cache, get_song_cover, get_song_cover_thumbnail, run_cache_cleanup}; // 实现

// ---------- 歌曲文件与歌词编辑 ----------
pub use files::{ // 实现
  batch_move_music_files, clear_song_background, create_folder, delete_folder, delete_music_file,
  get_song_background, get_song_detail, get_song_lyrics_for_edit, get_song_lyrics_payload,
  is_directory, move_file_to_folder, move_music_file, parse_lyrics_text, read_lyrics_file,
  save_artist_avatar, save_song_background, save_song_info, save_song_lyrics, show_in_folder,
};

// ---------- 曲库目录查询与全库扫描 ----------
pub use library::{ // 实现
  add_library_folder, get_folder_children, get_library_album_catalog, get_library_artist_catalog,
  get_library_folders, get_library_hierarchy, get_library_song_paths_by_album,
  get_library_song_paths_by_artist, get_library_song_paths_for_all_view,
  get_library_song_paths_for_folder_view, get_library_songs_cached, remove_library_folder,
  scan_library, search_library_songs,
};

// ---------- 扫描器命令 ----------
pub use scanner::{ // 实现
  get_folder_first_song, parse_audio_files, parse_music_folder, scan_folder_as_playlists,
  scan_music_folder,
};
