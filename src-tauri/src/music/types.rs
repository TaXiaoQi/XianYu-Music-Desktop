// 曲库数据契约聚合层。
// 各结构按用途拆分到子模块，统一在此 re-export；serde 字段名是对外契约。

mod catalog;
mod editing;
mod limits;
mod media;
mod views;

pub use catalog::{
    AlbumCatalogItem, ArtistCatalogItem, SaveArtistAvatarResponse, WriteTagsProgressPayload,
};
pub use editing::{LyricsStorageSource, SaveSongInfoResponse, SongLyricsForEdit};
pub use limits::{
    FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit,
    FULL_COVER_IMAGE_CONCURRENCY_LIMIT, THUMBNAIL_IMAGE_CONCURRENCY_LIMIT,
};
pub use media::{LibrarySong, Song, SongDetail, SongInfoEditPayload};
pub use views::{FolderNode, GeneratedFolder, LibraryFolder};
