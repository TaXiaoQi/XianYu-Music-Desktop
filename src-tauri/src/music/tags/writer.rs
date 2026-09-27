// 标签写入：面向前端「写入元数据」请求的字段覆盖逻辑。

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, Tag, TagExt, TagType};
use serde::Deserialize;
use std::path::Path;

/// 插件/前端提交的元数据写入请求（camelCase serde 契约）。
#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbedMetadataRequest {
    pub file_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<String>,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub lyrics: Option<String>,
    pub cover_data: Option<Vec<u8>>,
    pub cover_mime: Option<String>,
}

fn parse_u32_text(value: &Option<String>) -> Option<u32> {
    value.as_deref().and_then(|s| s.trim().parse::<u32>().ok())
}

/// 依据扩展名挑选新标签的默认类型（文件本身没有主标签时使用）。
fn default_tag_type_for_extension(path: &Path) -> TagType {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") | Some("mpeg") | Some("mpga") => TagType::Id3v2,
        Some("flac") => TagType::VorbisComments,
        Some("m4a") | Some("mp4") | Some("alac") | Some("aac") => TagType::Mp4Ilst,
        Some("ogg") | Some("opus") | Some("oga") => TagType::VorbisComments,
        Some("wav") | Some("wave") => TagType::RiffInfo,
        _ => TagType::Id3v2,
    }
}

fn mime_from_mime_type_str(mime_str: &str) -> MimeType {
    match mime_str {
        "image/png" => MimeType::Png,
        "image/jpeg" | "image/jpg" => MimeType::Jpeg,
        "image/gif" => MimeType::Gif,
        "image/tiff" => MimeType::Tiff,
        "image/bmp" => MimeType::Bmp,
        _ => MimeType::Jpeg,
    }
}

/// 把请求中的非空字段覆盖进主标签并保存；空/缺省字段保持原值。
pub fn write_metadata_to_file(request: &EmbedMetadataRequest) -> Result<(), String> {
    let validated = crate::security::path_validator::validate_path(&request.file_path, None)?;
    let path = validated.as_path();
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }

    let mut tagged_file =
        super::probe::read_tagged_file_from_path(path).map_err(|e| format!("读取音频文件失败: {e}"))?;

    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(default_tag_type_for_extension(path)));
    }

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "无法获取或创建标签".to_string())?;

    if let Some(ref title) = request.title {
        if !title.trim().is_empty() {
            tag.set_title(title.clone());
        }
    }
    if let Some(ref artist) = request.artist {
        if !artist.trim().is_empty() {
            tag.set_artist(artist.clone());
        }
    }
    if let Some(ref album) = request.album {
        if !album.trim().is_empty() {
            tag.set_album(album.clone());
        }
    }
    if let Some(ref album_artist) = request.album_artist {
        if !album_artist.trim().is_empty() {
            tag.insert_text(lofty::tag::ItemKey::AlbumArtist, album_artist.clone());
        }
    }
    if let Some(year) = parse_u32_text(&request.year) {
        tag.set_year(year);
    }
    if let Some(track) = parse_u32_text(&request.track_number) {
        tag.set_track(track);
    }
    if let Some(disc) = parse_u32_text(&request.disc_number) {
        tag.set_disk(disc);
    }

    if let Some(ref lyrics) = request.lyrics {
        if !lyrics.trim().is_empty() {
            tag.insert_text(lofty::tag::ItemKey::Lyrics, lyrics.clone());
        }
    }

    if let Some(ref cover_data) = request.cover_data {
        if !cover_data.is_empty() {
            let mime_str = request.cover_mime.as_deref().unwrap_or("image/jpeg");
            let picture = Picture::new_unchecked(
                PictureType::CoverFront,
                Some(mime_from_mime_type_str(mime_str)),
                None,
                cover_data.clone(),
            );
            tag.remove_picture_type(PictureType::CoverFront);
            tag.push_picture(picture);
        }
    }

    tag.save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("保存标签失败: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod writer_tests {
    use super::EmbedMetadataRequest;

    #[test]
    fn accepts_frontend_camel_case_payload() {
        let json = serde_json::json!({
            "filePath": "D:\\Music\\song.mp3",
            "title": "测试歌曲",
            "artist": "测试歌手",
            "albumArtist": "测试专辑艺术家",
            "trackNumber": "7",
            "discNumber": "1",
            "coverMime": "image/png"
        });

        let request: EmbedMetadataRequest =
            serde_json::from_value(json).expect("frontend payload should deserialize");

        assert_eq!(request.file_path, "D:\\Music\\song.mp3");
        assert_eq!(request.title.as_deref(), Some("测试歌曲"));
        assert_eq!(request.artist.as_deref(), Some("测试歌手"));
        assert_eq!(request.album_artist.as_deref(), Some("测试专辑艺术家"));
        assert_eq!(request.track_number.as_deref(), Some("7"));
        assert_eq!(request.disc_number.as_deref(), Some("1"));
        assert_eq!(request.cover_mime.as_deref(), Some("image/png"));
    }
}
