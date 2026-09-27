// 封面图片生成的并发闸门：缩略图与全尺寸封面各占独立额度。

use tokio::sync::Semaphore;

pub const THUMBNAIL_IMAGE_CONCURRENCY_LIMIT: usize = 2;
pub const FULL_COVER_IMAGE_CONCURRENCY_LIMIT: usize = 2;

/// 缩略图并发限额状态（由 app 启动时注入 Tauri manage）。
pub struct ThumbnailImageConcurrencyLimit(pub Semaphore);

/// 全尺寸封面并发限额状态。
pub struct FullCoverImageConcurrencyLimit(pub Semaphore);

#[cfg(test)]
mod limits_tests {
    use super::{
        FullCoverImageConcurrencyLimit, FULL_COVER_IMAGE_CONCURRENCY_LIMIT,
        THUMBNAIL_IMAGE_CONCURRENCY_LIMIT, ThumbnailImageConcurrencyLimit,
    };
    use tokio::sync::Semaphore;

    #[test]
    fn thumbnail_and_full_cover_limits_are_independent_quota_of_two() {
        assert_eq!(THUMBNAIL_IMAGE_CONCURRENCY_LIMIT, 2);
        assert_eq!(FULL_COVER_IMAGE_CONCURRENCY_LIMIT, 2);

        let _thumbnail_gate = ThumbnailImageConcurrencyLimit(Semaphore::new(2));
        let _full_cover_gate = FullCoverImageConcurrencyLimit(Semaphore::new(2));
    }
}
