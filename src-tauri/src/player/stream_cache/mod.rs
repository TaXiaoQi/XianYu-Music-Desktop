mod api;
mod buffer;
mod decrypt;
mod downloader;
mod eviction;
mod mv;
mod paths;
mod url;
mod validate;

pub use api::{clear_all, copy_cache_to, is_url_cached};
#[allow(unused_imports)]
pub use buffer::{
    is_buffer_ready, ReadSeek, StreamingTempFileReader, StreamingTempFileState, MIN_BUFFER_BYTES,
};
pub use downloader::{start_streaming_download, start_streaming_download_video};
pub use eviction::{current_cache_size, max_cache_size, set_max_cache_size};
#[allow(unused_imports)]
pub use mv::{
    cache_read_range, mv_cache_status, open_completed_cache, CompletedCacheFile, MvCacheStatus,
};
pub use paths::{get_cache_dir_str, set_cache_dir};
pub use url::stream_cache_key;
