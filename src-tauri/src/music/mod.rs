// music/mod.rs - 模块入口，统一导出

pub mod auth;
pub mod covers;
pub mod cue;
pub mod files;
pub mod library;
pub mod lx_search;
pub mod lyric_fetcher;
pub mod lyrics;
pub mod palette;
pub mod scanner;
pub mod sidebar;
pub mod tags;
pub mod types;
pub mod url_resolver;
pub mod utils;

// Re-export types
pub use types::*;

// Re-export commands for lib.rs registration
pub use auth::{
    authed_request, clear_auth_credentials, get_auth_api_secret, get_auth_base_url,
    get_auth_credentials, save_auth_credentials, set_auth_api_secret, set_auth_base_url,
    signed_post_json,
};
pub use covers::{clear_cover_cache, get_song_cover, get_song_cover_thumbnail, run_cache_cleanup};
pub use files::{
    batch_move_music_files, clear_song_background, create_folder, delete_folder, delete_music_file,
    get_song_background, get_song_detail, get_song_lyrics, get_song_lyrics_for_edit,
    get_song_lyrics_payload, is_directory, move_file_to_folder, move_music_file, parse_lyrics_text,
    read_lyrics_file, save_artist_avatar, save_song_background, save_song_info, save_song_lyrics,
    show_in_folder,
};
pub use library::{
    add_library_folder, get_folder_children, get_library_album_catalog, get_library_artist_catalog,
    get_library_folders, get_library_hierarchy, get_library_song_paths_by_album,
    get_library_song_paths_by_artist, get_library_song_paths_for_all_view,
    get_library_song_paths_for_folder_view, get_library_songs_by_paths, get_library_songs_cached,
    remove_library_folder, scan_library, search_library_songs,
};
pub use lx_search::clear_lx_all_cache;
pub use lyric_fetcher::fetch_lyric_from_source;
pub use palette::extract_palette;
pub use scanner::{
    get_folder_first_song, parse_audio_files, parse_music_folder, scan_folder_as_playlists,
    scan_music_folder,
};
pub use url_resolver::{
    clear_lx_url_cache, find_alternative_lx_source, get_lx_cover, resolve_lx_music_url,
    resolve_lx_with_quality_fallback,
};
// Deprecated compatibility exports. Keep registered for legacy data/tools only.
pub use sidebar::{
    add_sidebar_folder, get_sidebar_folders, get_sidebar_hierarchy, remove_sidebar_folder,
};
