// 字节级标签补救：前导 ID3v2 提取、RIFF/WAVE 块遍历、RIFF INFO 解析、
// 以及 id3 crate 标签到 lofty 标签的转换。

use super::clean_text;
use id3::TagLike;
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::properties::FileProperties;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

pub(super) fn path_is_wav(path: &Path) -> bool {
    path_has_extension(path, &["wav", "wave"])
}

pub(super) fn path_is_mpeg(path: &Path) -> bool {
    path_has_extension(path, &["mp3", "mpeg", "mpga"])
}

fn path_has_extension(path: &Path, candidates: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| candidates.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub(super) fn is_timestamp_parse_failure(error: &lofty::error::LoftyError) -> bool {
    matches!(error.kind(), lofty::error::ErrorKind::BadTimestamp(_))
}

/// 仅抢救文件头部的 ID3v2 标签（用于裸 MPEG 等无属性可用的场景）。
pub(super) fn salvage_bare_id3(path: &Path, load_pictures: bool) -> Result<TaggedFile, ()> {
    let file = File::open(path).map_err(|_| ())?;
    let mut reader = BufReader::new(file);
    let mut tags = Vec::new();

    if scan_leading_id3v2(&mut reader, &mut tags, load_pictures)?.is_none() || tags.is_empty() {
        return Err(());
    }

    Ok(TaggedFile::new(
        FileType::from_path(path).unwrap_or(FileType::Mpeg),
        FileProperties::default(),
        tags,
    ))
}

/// 抢救「ID3v2 前缀 + RIFF/WAVE 主体」的非标准 WAV 文件。
pub(super) fn salvage_wav(path: &Path, load_pictures: bool) -> Result<TaggedFile, ()> {
    let file = File::open(path).map_err(|_| ())?;
    let mut reader = BufReader::new(file);
    let mut tags = Vec::new();

    let audio_start = match scan_leading_id3v2(&mut reader, &mut tags, load_pictures)? {
        Some(offset) => offset,
        None => 0,
    };

    reader.seek(SeekFrom::Start(audio_start)).map_err(|_| ())?;
    tags.extend(walk_riff_wave_chunks(&mut reader, load_pictures)?);

    if tags.is_empty() {
        return Err(());
    }

    Ok(TaggedFile::new(FileType::Wav, FileProperties::default(), tags))
}

/// 读取并解析文件起始处的 ID3v2 标签；返回标签占用字节数（无则 None）。
fn scan_leading_id3v2<R>(
    reader: &mut R,
    tags: &mut Vec<Tag>,
    load_pictures: bool,
) -> Result<Option<u64>, ()>
where
    R: Read + Seek,
{
    let mut header = [0u8; 10];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        // 文件不足 10 字节：视为没有前导标签而不是失败。
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => {
            reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
            return Ok(None);
        }
        Err(_) => return Err(()),
    }

    let Some(tag_size) = id3v2_declared_size(&header).map(|size| size as u64) else {
        reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
        return Ok(None);
    };

    reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
    if let Some(tag_bytes) = read_exact_chunk(reader, tag_size as usize) {
        append_id3_tag_from_bytes(tags, &tag_bytes, load_pictures);
    }

    Ok(Some(tag_size))
}

/// ID3v2 头部声明的总大小 = 10 字节头 + syncsafe 编码的正文长度。
fn id3v2_declared_size(header: &[u8]) -> Option<usize> {
    if header.len() < 10 || &header[..3] != b"ID3" {
        return None;
    }

    let body = ((header[6] as usize) << 21)
        | ((header[7] as usize) << 14)
        | ((header[8] as usize) << 7)
        | (header[9] as usize);

    Some(10 + body)
}

/// 遍历 RIFF 块，收集 `id3 `/`ID3 ` 块与 LIST/INFO 块中的标签。
fn walk_riff_wave_chunks<R>(reader: &mut R, load_pictures: bool) -> Result<Vec<Tag>, ()>
where
    R: Read + Seek,
{
    if !verify_riff_wave_header(reader)? {
        return Ok(Vec::new());
    }

    let mut tags = Vec::new();
    loop {
        let mut block_header = [0u8; 8];
        match reader.read_exact(&mut block_header) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(_) => return Err(()),
        }

        let block_id = &block_header[..4];
        let block_size = u32::from_le_bytes(
            block_header[4..8]
                .try_into()
                .map_err(|_| ())?
        ) as usize;

        match block_id {
            b"id3 " | b"ID3 " => {
                let Some(block_bytes) = read_exact_chunk(reader, block_size) else {
                    break;
                };
                append_id3_tag_from_bytes(&mut tags, &block_bytes, load_pictures);
            }
            b"LIST" => {
                let Some(block_bytes) = read_exact_chunk(reader, block_size) else {
                    break;
                };
                if let Some(tag) = parse_riff_info_subchunk(&block_bytes) {
                    tags.push(tag);
                }
            }
            _ => {
                if skip_bytes(reader, block_size as u64).is_err() {
                    break;
                }
            }
        }

        // RIFF 规定奇数长度块后有一个填充字节。
        if block_size % 2 == 1 && skip_bytes(reader, 1).is_err() {
            break;
        }
    }

    Ok(tags)
}

fn read_exact_chunk<R>(reader: &mut R, size: usize) -> Option<Vec<u8>>
where
    R: Read,
{
    let mut bytes = vec![0u8; size];
    reader.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

fn skip_bytes<R>(reader: &mut R, size: u64) -> Result<(), ()>
where
    R: Seek,
{
    reader
        .seek(SeekFrom::Current(size as i64))
        .map(|_| ())
        .map_err(|_| ())
}

fn verify_riff_wave_header<R>(reader: &mut R) -> Result<bool, ()>
where
    R: Read,
{
    let mut header = [0u8; 12];
    match reader.read_exact(&mut header) {
        Ok(()) => Ok(&header[..4] == b"RIFF" && &header[8..12] == b"WAVE"),
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
        Err(_) => Err(()),
    }
}

fn append_id3_tag_from_bytes(tags: &mut Vec<Tag>, bytes: &[u8], load_pictures: bool) {
    if let Ok(id3_tag) = id3::Tag::read_from2(Cursor::new(bytes)) {
        tags.push(convert_id3_to_lofty(id3_tag, load_pictures));
    }
}

/// 解析 RIFF INFO 子块（`INFO` + 若干 4 字符键 + 长度 + 数据）。
fn parse_riff_info_subchunk(bytes: &[u8]) -> Option<Tag> {
    if bytes.len() < 4 || &bytes[..4] != b"INFO" {
        return None;
    }

    let mut tag = Tag::new(TagType::RiffInfo);
    let mut cursor = 4usize;

    while cursor + 8 <= bytes.len() {
        let raw_key = &bytes[cursor..cursor + 4];
        let value_size =
            u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().ok()?) as usize;
        let value_start = cursor + 8;
        let value_end = value_start.saturating_add(value_size);

        if value_end > bytes.len() {
            break;
        }

        if let Some(value) = decode_riff_info_value(&bytes[value_start..value_end]) {
            let key = String::from_utf8_lossy(raw_key);
            let _ = tag.insert(TagItem::new(
                ItemKey::from_key(TagType::RiffInfo, &key),
                ItemValue::Text(value),
            ));
        }

        cursor = cursor.saturating_add(8 + value_size + (value_size % 2));
    }

    let has_any_item = tag.items().next().is_some();
    has_any_item.then_some(tag)
}

/// RIFF INFO 文本解码顺序：UTF-16LE（偶长度）→ UTF-8 → GBK。
fn decode_riff_info_value(raw: &[u8]) -> Option<String> {
    let raw = raw
        .split(|byte| *byte == 0)
        .next()
        .unwrap_or(raw)
        .trim_ascii();

    if raw.is_empty() {
        return None;
    }

    if raw.len() >= 2 && raw.len() % 2 == 0 {
        let units: Vec<u16> = raw
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();

        if let Ok(decoded) = String::from_utf16(&units) {
            if let Some(text) = clean_text(&decoded) {
                return Some(text);
            }
        }
    }

    if let Ok(decoded) = std::str::from_utf8(raw) {
        if let Some(text) = clean_text(decoded) {
            return Some(text);
        }
    }

    let (decoded, _, _) = encoding_rs::GBK.decode(raw);
    clean_text(&decoded)
}

/// id3 crate 标签 → lofty 标签；文本字段逐项拷贝，图片按需。
fn convert_id3_to_lofty(id3_tag: id3::Tag, load_pictures: bool) -> Tag {
    let mut converted = Tag::new(TagType::Id3v2);

    insert_text_if_present(&mut converted, ItemKey::TrackTitle, id3_tag.title());
    insert_text_if_present(&mut converted, ItemKey::TrackArtist, id3_tag.artist());
    insert_text_if_present(&mut converted, ItemKey::AlbumTitle, id3_tag.album());
    insert_text_if_present(&mut converted, ItemKey::AlbumArtist, id3_tag.album_artist());
    insert_text_if_present(
        &mut converted,
        ItemKey::RecordingDate,
        id3_tag.year().map(|value| value.to_string()).as_deref(),
    );
    insert_text_if_present(
        &mut converted,
        ItemKey::TrackNumber,
        id3_tag.track().map(|value| value.to_string()).as_deref(),
    );
    insert_text_if_present(
        &mut converted,
        ItemKey::DiscNumber,
        id3_tag.disc().map(|value| value.to_string()).as_deref(),
    );

    for comment in id3_tag.comments() {
        let Some(text) = clean_text(&comment.text) else {
            continue;
        };
        let _ = converted.insert(TagItem::new(ItemKey::Comment, ItemValue::Text(text)));
    }

    for lyrics in id3_tag.lyrics() {
        let Some(text) = clean_text(&lyrics.text) else {
            continue;
        };
        let _ = converted.insert(TagItem::new(ItemKey::Lyrics, ItemValue::Text(text)));
    }

    if load_pictures {
        for picture in id3_tag.pictures() {
            converted.push_picture(Picture::new_unchecked(
                PictureType::from_u8(u8::from(picture.picture_type)),
                Some(MimeType::from_str(&picture.mime_type)),
                clean_text(&picture.description),
                picture.data.clone(),
            ));
        }
    }

    converted
}

fn insert_text_if_present(tag: &mut Tag, key: ItemKey, value: Option<&str>) {
    if let Some(value) = value.and_then(clean_text) {
        let _ = tag.insert_text(key, value);
    }
}

// ---- 前导 ID3v2 文本覆盖（用于 MPEG 内 APE/ID3v1 冲突时取头部真值） ----

/// 对 MPEG 文件：把文件头部 ID3v2 中的核心文本字段覆盖到已解析结果上。
pub(super) fn overlay_leading_id3v2_text(path: &Path, tagged_file: &mut TaggedFile) {
    if tagged_file.file_type() != FileType::Mpeg {
        return;
    }

    let Ok(file) = File::open(path) else {
        return;
    };
    let Some(leading_tag) = parse_leading_id3v2_frames(&mut BufReader::new(file)) else {
        return;
    };

    match tagged_file.tag_mut(TagType::Id3v2) {
        Some(existing_tag) => overlay_core_text_fields(existing_tag, &leading_tag),
        None => {
            let _ = tagged_file.insert_tag(leading_tag);
        }
    }
}

/// 逐帧解析前导 ID3v2，只提取四大核心文本字段，够齐即提前结束。
fn parse_leading_id3v2_frames<R>(reader: &mut R) -> Option<Tag>
where
    R: Read + Seek,
{
    let mut header = [0u8; 10];
    reader.read_exact(&mut header).ok()?;
    if &header[..3] != b"ID3" {
        return None;
    }

    let major = header[3];
    if !(2..=4).contains(&major) {
        return None;
    }

    let mut remaining = id3v2_declared_size(&header)?.saturating_sub(10);
    if header[5] & 0x40 != 0 {
        remaining = bypass_extended_header(reader, major, remaining)?;
    }

    let mut tag = Tag::new(TagType::Id3v2);
    let frame_header_len = if major == 2 { 6 } else { 10 };

    while remaining >= frame_header_len {
        let mut frame_header = vec![0u8; frame_header_len];
        reader.read_exact(&mut frame_header).ok()?;
        remaining = remaining.saturating_sub(frame_header_len);

        let (frame_id, frame_size) = if major == 2 {
            // v2.2 使用 3 字符帧 ID + 3 字节大端长度。
            let id = std::str::from_utf8(&frame_header[..3]).ok()?.to_string();
            let size = ((frame_header[3] as usize) << 16)
                | ((frame_header[4] as usize) << 8)
                | frame_header[5] as usize;
            (id, size)
        } else {
            let id = std::str::from_utf8(&frame_header[..4]).ok()?.to_string();
            let size = if major == 4 {
                decode_syncsafe_int(&frame_header[4..8])?
            } else {
                u32::from_be_bytes(frame_header[4..8].try_into().ok()?) as usize
            };
            (id, size)
        };

        // 帧ID全零（padding）或长度越界：认为标签正文结束。
        if frame_id.as_bytes().iter().all(|byte| *byte == 0) || frame_size == 0 {
            break;
        }
        if frame_size > remaining {
            break;
        }

        if let Some(key) = frame_id_to_item_key(&frame_id) {
            let mut payload = vec![0u8; frame_size];
            reader.read_exact(&mut payload).ok()?;
            if let Some(text) = decode_text_frame_payload(&payload) {
                let _ = tag.insert_text(key, text);
            }
        } else {
            reader.seek(SeekFrom::Current(frame_size as i64)).ok()?;
        }

        remaining = remaining.saturating_sub(frame_size);

        if tag.get_string(&ItemKey::TrackTitle).is_some()
            && tag.get_string(&ItemKey::TrackArtist).is_some()
            && tag.get_string(&ItemKey::AlbumTitle).is_some()
            && tag.get_string(&ItemKey::AlbumArtist).is_some()
        {
            break;
        }
    }

    let has_any_item = tag.items().next().is_some();
    has_any_item.then_some(tag)
}

fn bypass_extended_header<R>(reader: &mut R, major: u8, remaining: usize) -> Option<usize>
where
    R: Read + Seek,
{
    if remaining < 4 {
        return None;
    }

    let mut size_bytes = [0u8; 4];
    reader.read_exact(&mut size_bytes).ok()?;

    let skip_size = if major == 4 {
        decode_syncsafe_int(&size_bytes)?.saturating_sub(4)
    } else {
        u32::from_be_bytes(size_bytes) as usize
    };
    if skip_size > remaining.saturating_sub(4) {
        return None;
    }

    reader.seek(SeekFrom::Current(skip_size as i64)).ok()?;
    Some(remaining.saturating_sub(4 + skip_size))
}

/// syncsafe 整数：每字节只用低 7 位。
fn decode_syncsafe_int(bytes: &[u8]) -> Option<usize> {
    if bytes.len() != 4 || bytes.iter().any(|byte| byte & 0x80 != 0) {
        return None;
    }

    Some(
        ((bytes[0] as usize) << 21)
            | ((bytes[1] as usize) << 14)
            | ((bytes[2] as usize) << 7)
            | bytes[3] as usize,
    )
}

fn frame_id_to_item_key(frame_id: &str) -> Option<ItemKey> {
    match frame_id {
        "TIT2" | "TT2" => Some(ItemKey::TrackTitle),
        "TPE1" | "TP1" => Some(ItemKey::TrackArtist),
        "TALB" | "TAL" => Some(ItemKey::AlbumTitle),
        "TPE2" | "TP2" => Some(ItemKey::AlbumArtist),
        _ => None,
    }
}

/// 文本帧载荷首字节为编码号：0 latin1 / 1 utf16+BOM / 2 utf16BE / 3 utf8。
fn decode_text_frame_payload(data: &[u8]) -> Option<String> {
    let (encoding, text_bytes) = data.split_first()?;
    let decoded = match encoding {
        0 => text_bytes.iter().map(|byte| char::from(*byte)).collect(),
        1 => utf16_following_bom(text_bytes)?,
        2 => utf16be_to_string(text_bytes)?,
        3 => std::str::from_utf8(text_bytes).ok()?.to_string(),
        _ => return None,
    };

    clean_text(decoded.trim_matches('\0'))
}

fn utf16_following_bom(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        utf16be_to_string(&bytes[2..])
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        utf16le_to_string(&bytes[2..])
    } else {
        utf16le_to_string(bytes)
    }
}

fn utf16le_to_string(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }

    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

fn utf16be_to_string(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }

    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

/// 用前导标签的非空文本覆盖目标标签中的对应字段。
fn overlay_core_text_fields(target_tag: &mut Tag, leading_tag: &Tag) {
    const CORE_KEYS: &[ItemKey] = &[
        ItemKey::TrackTitle,
        ItemKey::TrackArtist,
        ItemKey::AlbumTitle,
        ItemKey::AlbumArtist,
    ];

    for key in CORE_KEYS {
        if let Some(value) = leading_tag.get_string(key).and_then(clean_text) {
            let _ = target_tag.insert_text(key.clone(), value);
        }
    }
}

#[cfg(test)]
mod rescue_tests {
    use super::*;

    #[test]
    fn mpeg_text_prefers_leading_id3v2_over_trailing_id3v1() {
        use id3::TagLike;
        use id3::Version;

        let mut id3_tag = id3::Tag::new();
        id3_tag.set_title("爱琴海");
        id3_tag.set_artist("周杰伦");
        id3_tag.set_album("太阳之子");

        let mut bytes = Vec::new();
        id3_tag
            .write_to(&mut bytes, Version::Id3v23)
            .expect("id3v2 serialize");

        bytes.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        bytes.extend(std::iter::repeat(0).take(413));

        let mut id3v1 = [0u8; 128];
        id3v1[..3].copy_from_slice(b"TAG");
        id3v1[3..9].copy_from_slice(&[0xB0, 0xAE, 0xC7, 0xD9, 0xBA, 0xA3]);
        id3v1[33..39].copy_from_slice(&[0xD6, 0xDC, 0xBD, 0xDC, 0xC2, 0xD7]);
        id3v1[63..71].copy_from_slice(&[0xCC, 0xAB, 0xD1, 0xF4, 0xD6, 0xAE, 0xD7, 0xD3]);
        bytes.extend_from_slice(&id3v1);

        let temp_path = std::env::temp_dir().join(format!(
            "xyq_id3v1conflict_{}.mp3",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&temp_path, &bytes).unwrap();

        let tagged_file = crate::music::tags::read_tagged_file_from_path_for_scan(&temp_path)
            .expect("salvaged mp3 should read");
        let metadata = crate::music::tags::extract_text_metadata(&tagged_file);

        assert_eq!(metadata.title.as_deref(), Some("爱琴海"));
        assert_eq!(metadata.artist.as_deref(), Some("周杰伦"));
        assert_eq!(metadata.album.as_deref(), Some("太阳之子"));

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn mp3_with_fullwidth_timestamp_frames_still_reads_text() {
        use id3::TagLike;
        use id3::Version;

        let mut id3_tag = id3::Tag::new();
        id3_tag.set_title("Timestamp Demo");
        id3_tag.set_artist("Artist");
        id3_tag.add_frame(id3::frame::Frame::text("TDRC", "２０２４"));

        let mut bytes = Vec::new();
        id3_tag
            .write_to(&mut bytes, Version::Id3v24)
            .expect("id3v2 serialize");
        bytes.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        bytes.extend(std::iter::repeat(0).take(413));

        let temp_path = std::env::temp_dir().join(format!(
            "xyq_badts_{}.mp3",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&temp_path, &bytes).unwrap();

        let tagged_file = crate::music::tags::read_tagged_file_from_path_for_scan(&temp_path)
            .expect("salvage should ignore invalid timestamp frame");
        let metadata = crate::music::tags::extract_text_metadata(&tagged_file);

        assert_eq!(metadata.title.as_deref(), Some("Timestamp Demo"));
        assert_eq!(metadata.artist.as_deref(), Some("Artist"));

        let _ = std::fs::remove_file(temp_path);
    }
}
