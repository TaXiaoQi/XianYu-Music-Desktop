// 标签元数据读取（弦予原创实现）：文本四要素、详情字段、内嵌歌词识别、内嵌图片查找。
// 文件级读取与补救在子模块 probe / rescue 中，标签写回在 writer 中。
// 本文件的裁决策略是「按可信度排序标签容器，再逐字段用探针函数取首个命中」。

#[path = "tags/probe.rs"]
mod probe;
#[path = "tags/rescue.rs"]
mod rescue;
#[path = "tags/writer.rs"]
mod writer;

pub use probe::{read_tagged_file_from_path, read_tagged_file_from_path_for_scan};
pub use writer::{write_metadata_to_file, EmbedMetadataRequest};

use lofty::file::TaggedFileExt;
use lofty::picture::{Picture, PictureType};
use lofty::tag::{Accessor, ItemKey, Tag, TagItem, TagType};

// 标题/歌手/专辑/专辑歌手四要素快照。
#[derive(Clone, Default, Debug, PartialEq, Eq)]
pub struct TagTextMetadata {
    pub title: Option<String>, pub artist: Option<String>,
    pub album: Option<String>, pub album_artist: Option<String>,
}

// 详情面板字段快照：流派/年份/轨号/碟号/备注。
#[derive(Clone, Default, Debug, PartialEq, Eq)]
pub struct TagDetailMetadata {
    pub genre: Option<String>, pub year: Option<String>,
    pub track_number: Option<String>, pub disc_number: Option<String>,
    pub comment: Option<String>,
}

// 命中歌词字段时的定位信息：覆写回写时需要按这三元组找到原条目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedLyricsMatch {
    pub tag_type: TagType, pub item_key: ItemKey,
    pub description: String, pub text: String,
}

// ---- 标签容器的裁决顺序 ----

// 未知键名里与歌词相关的候选集合（大小写不敏感比对）。
const LYRIC_KEY_HINTS: [&str; 6] = [
    "LYRICS",
    "LYRIC",
    "LRC",
    "KLYRIC",
    "UNSYNCEDLYRICS",
    "SYNCEDLYRICS",
];

// 各字段的原始键名兜底集合；顺序即优先级，属于行为契约的一部分。
const TITLE_RAW_KEYS: &[&str] = &["TITLE", "INAM"];
const ARTIST_RAW_KEYS: &[&str] = &["ARTIST", "IART", "AUTHOR"];
const ALBUM_RAW_KEYS: &[&str] = &["ALBUM", "IPRD"];
const ALBUM_ARTIST_RAW_KEYS: &[&str] = &["ALBUMARTIST", "ALBUM ARTIST", "TPE2", "IART"];
const GENRE_RAW_KEYS: &[&str] = &["GENRE", "TCON", "IGNR"];
const YEAR_RAW_KEYS: &[&str] = &["DATE", "YEAR", "TYER", "TDRC", "ICRD"];
const TRACK_RAW_KEYS: &[&str] = &["TRACKNUMBER", "TRCK", "TRACK", "ITRK", "IPRT"];
const DISC_RAW_KEYS: &[&str] = &["DISCNUMBER", "DISC", "DISK", "TPOS"];

const ARTIST_STANDARD_KEYS: &[ItemKey] =
    &[ItemKey::TrackArtist, ItemKey::AlbumArtist, ItemKey::Performer, ItemKey::Composer];
const ALBUM_STANDARD_KEYS: &[ItemKey] = &[ItemKey::AlbumTitle, ItemKey::OriginalAlbumTitle];
const ALBUM_ARTIST_STANDARD_KEYS: &[ItemKey] =
    &[ItemKey::AlbumArtist, ItemKey::TrackArtist, ItemKey::Performer];

// 标签容器的裁决顺序：Id3v2 最优先，其次主标签与 RiffInfo，
// 其余容器按原始顺序殿后；同一容器只出现一次（指针去重）。
fn tag_lookup_order<'a, T: TaggedFileExt + ?Sized>(tagged_file: &'a T) -> Vec<&'a Tag> {
    let preferred = [
        tagged_file.tag(TagType::Id3v2),
        tagged_file.primary_tag(),
        tagged_file.tag(TagType::RiffInfo),
    ];
    let candidates = preferred
        .into_iter()
        .flatten()
        .chain(tagged_file.tags().iter());

    let mut picked: Vec<&'a Tag> = Vec::new();
    for candidate in candidates {
        if !picked.iter().any(|seen| std::ptr::eq(*seen, candidate)) {
            picked.push(candidate);
        }
    }
    picked
}

// ---- 文本清洗与条目取值 ----

// 去 NUL、去首尾空白；空串按缺失处理。
fn clean_text(raw: &str) -> Option<String> {
    let trimmed = raw.trim_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

// 文本型条目取值；locator 兜底覆盖 RiffInfo 等以 locator 存值的容器。
fn item_text_value(item: &TagItem) -> Option<String> {
    let value = item.value();
    value.text().or_else(|| value.locator()).and_then(clean_text)
}

// 先按标准键直取，再允许「未知键名大小写不敏感匹配」兜底。
fn text_via_keys(tag: &Tag, standard_keys: &[ItemKey], raw_names: &[&str]) -> Option<String> {
    standard_keys
        .iter()
        .find_map(|key| tag.get_string(key).and_then(clean_text))
        .or_else(|| text_under_raw_names(tag, raw_names))
}

// 未知键名兜底：与候选名做 ASCII 大小写不敏感比对。
fn text_under_raw_names(tag: &Tag, raw_names: &[&str]) -> Option<String> {
    tag.items().find_map(|item| {
        let ItemKey::Unknown(raw) = item.key() else {
            return None;
        };
        raw_names
            .iter()
            .any(|candidate| raw.eq_ignore_ascii_case(candidate))
            .then(|| item_text_value(item))
            .flatten()
    })
}

// ---- 逐字段探针：单个标签容器内取一个字段 ----

fn title_in_tag(tag: &Tag) -> Option<String> {
    tag.title().as_deref().and_then(clean_text)
        .or_else(|| text_via_keys(tag, &[ItemKey::TrackTitle], TITLE_RAW_KEYS))
}

fn artist_in_tag(tag: &Tag) -> Option<String> {
    tag.artist().as_deref().and_then(clean_text)
        .or_else(|| text_via_keys(tag, ARTIST_STANDARD_KEYS, ARTIST_RAW_KEYS))
}

fn album_in_tag(tag: &Tag) -> Option<String> {
    tag.album().as_deref().and_then(clean_text)
        .or_else(|| text_via_keys(tag, ALBUM_STANDARD_KEYS, ALBUM_RAW_KEYS))
}

fn album_artist_in_tag(tag: &Tag) -> Option<String> {
    text_via_keys(tag, ALBUM_ARTIST_STANDARD_KEYS, ALBUM_ARTIST_RAW_KEYS)
}

fn genre_in_tag(tag: &Tag) -> Option<String> {
    tag.genre().as_deref().and_then(clean_text)
        .or_else(|| text_via_keys(tag, &[], GENRE_RAW_KEYS))
}

fn year_in_tag(tag: &Tag) -> Option<String> {
    tag.get_string(&ItemKey::RecordingDate).and_then(clean_text)
        .or_else(|| text_via_keys(tag, &[], YEAR_RAW_KEYS))
}

fn track_no_in_tag(tag: &Tag) -> Option<String> {
    tag.track().map(|value| value.to_string())
        .or_else(|| text_via_keys(tag, &[ItemKey::TrackNumber], TRACK_RAW_KEYS))
}

fn disc_no_in_tag(tag: &Tag) -> Option<String> {
    tag.disk().map(|value| value.to_string())
        .or_else(|| text_via_keys(tag, &[ItemKey::DiscNumber], DISC_RAW_KEYS))
}

fn comment_in_tag(tag: &Tag) -> Option<String> {
    tag.get_string(&ItemKey::Comment).and_then(clean_text)
        .or_else(|| comment_from_items(tag))
}

// 备注字段兜底：显式 Comment/Description 条目，或名为 COMMENT/
// COMMENTS/DESCRIPTION 的未知键。
fn comment_from_items(tag: &Tag) -> Option<String> {
    const NAMED_COMMENTS: [&str; 3] = ["COMMENT", "COMMENTS", "DESCRIPTION"];
    tag.items().find_map(|entry| match entry.key() {
        ItemKey::Comment | ItemKey::Description => item_text_value(entry),
        ItemKey::Unknown(raw)
            if NAMED_COMMENTS.contains(&raw.to_ascii_uppercase().as_str()) =>
        {
            item_text_value(entry)
        }
        _ => None,
    })
}

// 逐容器执行同一个探针，返回首个命中值。
fn first_match<T: TaggedFileExt + ?Sized, F: Fn(&Tag) -> Option<String>>(
    tagged_file: &T,
    probe: F,
) -> Option<String> {
    tag_lookup_order(tagged_file)
        .into_iter()
        .find_map(probe)
}

// ---- 公开提取接口 ----

/// 标题/歌手/专辑/专辑歌手四要素；每个字段独立取首个非空命中。
pub fn extract_text_metadata<T: TaggedFileExt + ?Sized>(tagged_file: &T) -> TagTextMetadata {
    TagTextMetadata {
        title: first_match(tagged_file, title_in_tag),
        artist: first_match(tagged_file, artist_in_tag),
        album: first_match(tagged_file, album_in_tag),
        album_artist: first_match(tagged_file, album_artist_in_tag),
    }
}

/// 详情面板字段：流派/年份/轨号/碟号/备注，逐字段多路兜底。
pub fn extract_detail_metadata<T: TaggedFileExt + ?Sized>(tagged_file: &T) -> TagDetailMetadata {
    TagDetailMetadata {
        genre: first_match(tagged_file, genre_in_tag),
        year: first_match(tagged_file, year_in_tag),
        track_number: first_match(tagged_file, track_no_in_tag),
        disc_number: first_match(tagged_file, disc_no_in_tag),
        comment: first_match(tagged_file, comment_in_tag),
    }
}

pub fn extract_embedded_lyrics<T: TaggedFileExt + ?Sized>(tagged_file: &T) -> Option<String> {
    extract_embedded_lyrics_match(tagged_file).map(|match_found| match_found.text)
}

/// 内嵌歌词三段式识别：标准 Lyrics 键 → 伪装成备注/描述的歌词字段 →
/// 任意字段中出现 LRC 时间戳。
pub fn extract_embedded_lyrics_match<T: TaggedFileExt + ?Sized>(
    tagged_file: &T,
) -> Option<EmbeddedLyricsMatch> {
    let order = tag_lookup_order(tagged_file);
    canonical_lyrics(&order)
        .or_else(|| smuggled_lyrics(&order))
        .or_else(|| timestamped_lyrics(&order))
}

// 第一段：标准 Lyrics 键直取。
fn canonical_lyrics(order: &[&Tag]) -> Option<EmbeddedLyricsMatch> {
    order.iter().find_map(|tag| {
        let body = tag.get_string(&ItemKey::Lyrics).and_then(clean_text)?;
        Some(EmbeddedLyricsMatch {
            tag_type: tag.tag_type(), item_key: ItemKey::Lyrics, description: String::new(),
            text: repair_latin1_misdecoded(&body),
        })
    })
}

// 第二段：藏在备注/描述类字段里的歌词正文。
fn smuggled_lyrics(order: &[&Tag]) -> Option<EmbeddedLyricsMatch> {
    for tag in order {
        for entry in tag.items() {
            let Some(body) = item_text_value(entry) else { continue; };

            let looks_like_lyrics = matches!(entry.key(), ItemKey::Comment | ItemKey::Description)
                || matches!(entry.key(), ItemKey::Unknown(raw_key) if key_names_lyrics(raw_key))
                || description_mentions_lyrics(entry.description());

            if looks_like_lyrics && body_plausibly_lyrics(&body) {
                return Some(EmbeddedLyricsMatch {
                    tag_type: tag.tag_type(), item_key: entry.key().clone(),
                    description: entry.description().to_string(),
                    text: repair_latin1_misdecoded(&body),
                });
            }
        }
    }
    Option::None
}

// 第三段：任意字段里出现 LRC 时间戳即认定为歌词。
fn timestamped_lyrics(order: &[&Tag]) -> Option<EmbeddedLyricsMatch> {
    for tag in order {
        for entry in tag.items() {
            let Some(body) = item_text_value(entry) else { continue; };
            if !contains_lrc_timestamp(&body) { continue; }
            return Some(EmbeddedLyricsMatch {
                tag_type: tag.tag_type(), item_key: entry.key().clone(),
                description: entry.description().to_string(),
                text: repair_latin1_misdecoded(&body),
            });
        }
    }
    Option::None
}

// ---- 内嵌图片查找 ----

/// 优先任意容器中的正封面；整体缺失时退回首张图片。
pub fn find_embedded_picture<'a, T: TaggedFileExt + ?Sized>(
    tagged_file: &'a T,
) -> Option<&'a Picture> {
    let order = tag_lookup_order(tagged_file);
    picture_of_kind(&order, PictureType::CoverFront).or_else(|| any_picture(&order))
}

/// 歌手头像专用：仅认 Artist 类型的图片。
pub fn find_embedded_artist_picture<'a, T: TaggedFileExt + ?Sized>(
    tagged_file: &'a T,
) -> Option<&'a Picture> {
    let order = tag_lookup_order(tagged_file);
    picture_of_kind(&order, PictureType::Artist)
}

// 按图片类型跨容器查找第一张。
fn picture_of_kind<'a>(order: &[&'a Tag], wanted: PictureType) -> Option<&'a Picture> {
    order.iter().flat_map(|tag| tag.pictures())
        .find(|picture| picture.pic_type() == wanted)
}

// 不挑类型，取第一张能找到的图。
fn any_picture<'a>(order: &[&'a Tag]) -> Option<&'a Picture> {
    order.iter().flat_map(|tag| tag.pictures()).next()
}

// ---- 歌词启发式 ----

// 未知键名是否指向歌词字段。
fn key_names_lyrics(raw_key: &str) -> bool {
    LYRIC_KEY_HINTS.contains(&raw_key.to_ascii_uppercase().as_str())
}

// 描述文本是否提及歌词（LYRIC / LRC 字样）。
fn description_mentions_lyrics(description: &str) -> bool {
    let folded = description.trim().to_ascii_uppercase();
    !folded.is_empty() && ["LYRIC", "LRC"].iter().any(|token| folded.contains(token))
}

// 非空字段被认作歌词正文的条件：含 LRC 时间戳，或有效行数不少于 2。
fn body_plausibly_lyrics(text: &str) -> bool {
    contains_lrc_timestamp(text) || count_meaningful_lines(text) >= 2
}

// 非空白行的行数。
fn count_meaningful_lines(text: &str) -> usize {
    text.lines().filter(|line| !line.trim().is_empty()).count()
}

/// 字节级扫描 `[分:秒.厘秒]` 与 `[分:秒]` 两种 LRC 时间戳形态。
pub fn contains_lrc_timestamp(text: &str) -> bool {
    let raw = text.as_bytes();
    (0..raw.len()).any(|start| raw[start] == b'[' && lrc_stamp_at(&raw[start + 1..]))
}

// 判定从 '[' 之后开始的片段是否构成完整时间戳：
// 分钟至少 1 位，秒必须恰好 2 位，厘秒可有可无但出现时至少 1 位。
fn lrc_stamp_at(rest: &[u8]) -> bool {
    let minute_span = digit_run(rest, 0);
    if minute_span == 0 || rest.get(minute_span) != Some(&b':') {
        return false;
    }

    let seconds_at = minute_span + 1;
    if digit_run(rest, seconds_at) != 2 {
        return false;
    }

    match rest.get(seconds_at + 2) {
        Some(b']') => true,
        Some(b'.') => {
            let fraction_at = seconds_at + 3;
            let fraction_span = digit_run(rest, fraction_at);
            fraction_span > 0 && rest.get(fraction_at + fraction_span) == Some(&b']')
        }
        _ => false,
    }
}

// 从 from 起连续 ASCII 数字的数量。
fn digit_run(bytes: &[u8], from: usize) -> usize {
    bytes[from..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count()
}

// ---- 乱码修复 ----

/// 修补「UTF-16/GBK 字节被按 Latin-1 误存」的歌词：
/// 把 0x80..=0xFF 区字符折回字节重新解码。仅当重解码不产生替换符、
/// 且 CJK 字符确实变多时才采纳，避免毁掉真正的拉丁文歌词。
fn repair_latin1_misdecoded(text: &str) -> String {
    let high_byte_chars = text
        .chars()
        .filter(|c| (0x80..=0xFF).contains(&(*c as u32)))
        .count();
    let non_ascii_chars = text.chars().filter(|c| !c.is_ascii()).count();
    if high_byte_chars == 0 || non_ascii_chars == 0 || high_byte_chars * 2 < non_ascii_chars {
        return text.to_owned();
    }

    let squeezed: Vec<u8> = text
        .chars()
        .map(|c| if (c as u32) <= 0xFF { c as u8 } else { b'?' })
        .collect();

    let repaired = crate::music::files::decode_lyrics_file_bytes(&squeezed);
    if repaired.contains('\u{FFFD}') {
        return text.to_owned();
    }

    let cjk_count =
        |sample: &str| sample.chars().filter(|c| crate::music::files::is_cjk_char(*c)).count();
    if cjk_count(&repaired) > cjk_count(text) {
        repaired
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tag_extraction_tests {
    use super::{
        contains_lrc_timestamp, extract_detail_metadata, extract_embedded_lyrics,
        extract_text_metadata, find_embedded_picture, repair_latin1_misdecoded,
    };
    use lofty::{
        file::TaggedFile, picture::{MimeType, Picture, PictureType},
        properties::FileProperties, tag::{ItemKey, ItemValue, Tag, TagItem, TagType},
    };

    // 以 WAV 容器装载标签集合，供各提取函数裁决。
    fn container_with(tags: Vec<Tag>) -> TaggedFile {
        TaggedFile::new(lofty::file::FileType::Wav, FileProperties::default(), tags)
    }

    #[test] fn id3v2_text_beats_riff_info_text() {
        let mut riff_sheet = Tag::new(TagType::RiffInfo);
        riff_sheet.insert_text(ItemKey::TrackTitle, "RIFF Title".to_string());
        riff_sheet.insert_text(ItemKey::TrackArtist, "RIFF Artist".to_string());
        riff_sheet.insert_text(ItemKey::AlbumTitle, "RIFF Album".to_string());

        let mut id3_sheet = Tag::new(TagType::Id3v2);
        id3_sheet.insert_text(ItemKey::TrackTitle, "ID3 Title".to_string());
        id3_sheet.insert_text(ItemKey::TrackArtist, "ID3 Artist".to_string());
        id3_sheet.insert_text(ItemKey::AlbumTitle, "ID3 Album".to_string());

        let metadata = extract_text_metadata(&container_with(vec![riff_sheet, id3_sheet]));

        assert_eq!(metadata.title.as_deref(), Some("ID3 Title"));
        assert_eq!(metadata.artist.as_deref(), Some("ID3 Artist"));
        assert_eq!(metadata.album.as_deref(), Some("ID3 Album"));
    }

    #[test] fn riff_info_serves_as_text_fallback() {
        let mut riff_sheet = Tag::new(TagType::RiffInfo);
        riff_sheet.insert_text(ItemKey::TrackTitle, "Wave Title".to_string());
        riff_sheet.insert_text(ItemKey::TrackArtist, "Wave Artist".to_string());
        riff_sheet.insert_text(ItemKey::AlbumTitle, "Wave Album".to_string());

        let metadata = extract_text_metadata(&container_with(vec![riff_sheet]));

        assert_eq!(metadata.title.as_deref(), Some("Wave Title"));
        assert_eq!(metadata.artist.as_deref(), Some("Wave Artist"));
        assert_eq!(metadata.album.as_deref(), Some("Wave Album"));
    }

    #[test] fn lyrics_hidden_in_comment_field_are_found() {
        let mut id3_sheet = Tag::new(TagType::Id3v2);
        id3_sheet.insert(TagItem::new(
            ItemKey::Comment,
            ItemValue::Text("[00:01.00]line one\n[00:02.00]line two".to_string()),
        ));

        let lyrics = extract_embedded_lyrics(&container_with(vec![id3_sheet]));

        assert_eq!(lyrics.as_deref(), Some("[00:01.00]line one\n[00:02.00]line two"));
    }

    #[test] fn gbk_misdecoded_lyrics_get_repaired() {
        let (gbk, _, _) = encoding_rs::GBK.encode("[00:01.00]中文歌词");
        let mojibake: String = gbk.iter().map(|byte| *byte as char).collect();

        assert_eq!(repair_latin1_misdecoded(&mojibake), "[00:01.00]中文歌词");
    }

    #[test] fn genuine_latin1_lyrics_stay_untouched() {
        let french = "[00:01.00]C'est déjà ça";
        assert_eq!(repair_latin1_misdecoded(french), french);
    }

    #[test] fn track_and_disc_numbers_surface_in_detail_metadata() {
        let mut id3_sheet = Tag::new(TagType::Id3v2);
        id3_sheet.insert_text(ItemKey::TrackNumber, "7".to_string());
        id3_sheet.insert_text(ItemKey::DiscNumber, "2".to_string());

        let metadata = extract_detail_metadata(&container_with(vec![id3_sheet]));

        assert_eq!(metadata.track_number.as_deref(), Some("7"));
        assert_eq!(metadata.disc_number.as_deref(), Some("2"));
    }

    #[test] fn front_cover_is_preferred_over_other_picture_types() {
        let mut id3_sheet = Tag::new(TagType::Id3v2);
        id3_sheet.push_picture(Picture::new_unchecked(
            PictureType::CoverBack, Some(MimeType::Jpeg), None, vec![1, 2, 3],
        ));

        let mut riff_sheet = Tag::new(TagType::RiffInfo);
        riff_sheet.push_picture(Picture::new_unchecked(
            PictureType::CoverFront, Some(MimeType::Png), None, vec![4, 5, 6],
        ));

        let tagged_file = container_with(vec![id3_sheet, riff_sheet]);
        let picture = find_embedded_picture(&tagged_file).expect("front cover expected");

        assert_eq!(picture.pic_type(), PictureType::CoverFront);
        assert_eq!(picture.data(), &[4, 5, 6]);
    }

    #[test] fn lrc_timestamp_detection_covers_both_formats() {
        assert!(contains_lrc_timestamp("[01:23.45]text"));
        assert!(contains_lrc_timestamp("prefix [1:02] text"));
        assert!(!contains_lrc_timestamp("[01:23:45]"));
        assert!(!contains_lrc_timestamp("no bracket here"));
    }
}
