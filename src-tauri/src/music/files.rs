// 歌曲文件操作聚合入口。
// 实现按职责拆分到子模块：歌词解码/读写、信息编辑、文件搬移、背景图、歌手头像。

pub(crate) mod avatar_writer;
pub(crate) mod backgrounds;
pub(crate) mod lyrics_codec;
pub(crate) mod lyrics_io;
pub(crate) mod tag_editing;
pub(crate) mod transfer;

// 供 tags 模块复用的歌词文件解码能力。
pub(crate) use lyrics_codec::{decode_lyrics_file_bytes, is_cjk_char};

pub use avatar_writer::save_artist_avatar;
pub use backgrounds::{clear_song_background, get_song_background, save_song_background};
pub use lyrics_io::{
    get_song_lyrics_for_edit, get_song_lyrics_payload, parse_lyrics_text, read_lyrics_file,
    save_song_lyrics,
};
pub use tag_editing::{get_song_detail, save_song_info};
#[allow(unused_imports)]
pub use transfer::{
    batch_move_music_files, create_folder, delete_folder, delete_music_file, is_directory,
    move_file_to_folder, move_music_file, show_in_folder, BatchMoveMusicFilesResult,
    MovedMusicFilePath,
};
