// 音频文件标签读取入口与容错补救逻辑。
// 常规路径走 lofty Probe；对带前导 ID3v2 的 WAV、损坏 MPEG、坏时间戳等
// 异常文件，退回到手写的字节级解析，尽量抢救出文本标签。

use lofty::config::ParseOptions;
use lofty::file::{FileType, TaggedFile};
use lofty::probe::Probe;
use std::fs::File;
use std::path::Path;

use super::rescue;

pub fn read_tagged_file_from_path(path: &Path) -> lofty::error::Result<TaggedFile> {
    open_tagged_file(path, true)
}

/// 扫描专用：跳过封面图片字节，降低大文件扫描开销。
pub fn read_tagged_file_from_path_for_scan(path: &Path) -> lofty::error::Result<TaggedFile> {
    open_tagged_file(path, false)
}

fn open_tagged_file(path: &Path, load_pictures: bool) -> lofty::error::Result<TaggedFile> {
    let options = ParseOptions::new().read_cover_art(load_pictures);

    // QMC 加密壳需要先解密再探测，仅对已知壳扩展名启用。
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if is_qmc_shell_extension(&ext.to_ascii_lowercase()) {
            if let Some(tagged) = try_read_decrypted_qmc(path, options) {
                return Ok(tagged);
            }
        }
    }

    match Probe::open(path)?
        .guess_file_type()?
        .options(options)
        .read()
    {
        Ok(mut tagged_file) => {
            rescue::overlay_leading_id3v2_text(path, &mut tagged_file);
            Ok(tagged_file)
        }
        Err(original_err) if rescue::path_is_wav(path) => {
            rescue::salvage_wav(path, load_pictures).map_err(|_| original_err)
        }
        Err(original_err) if rescue::path_is_mpeg(path) => {
            rescue::salvage_bare_id3(path, load_pictures).map_err(|_| original_err)
        }
        Err(original_err) if rescue::is_timestamp_parse_failure(&original_err) => {
            rescue::salvage_bare_id3(path, load_pictures).map_err(|_| original_err)
        }
        Err(original_err) => Err(original_err),
    }
}

fn is_qmc_shell_extension(lower_ext: &str) -> bool {
    matches!(
        lower_ext,
        "mgg"
            | "mgg0"
            | "mggl"
            | "mflac"
            | "mflac0"
            | "qmc0"
            | "qmc2"
            | "qmc3"
            | "qmcflac"
            | "qmcogg"
    )
}

/// 尝试以 QMC 解密流读取标签；任何一步失败都返回 None 走常规路径。
fn try_read_decrypted_qmc(path: &Path, options: ParseOptions) -> Option<TaggedFile> {
    use crate::player::qmc2::{detect_qmc_crypto, QmcDecryptReader};

    let crypto = detect_qmc_crypto(path)?;
    let file = File::open(path).ok()?;
    let reader = QmcDecryptReader::new(file, crypto);

    let mut probe = match qmc_inner_extension(path) {
        Some(inner_ext) => {
            let mut p = Probe::new(reader);
            if let Ok(file_type) = file_type_for_extension(inner_ext) {
                p = p.set_file_type(file_type);
            }
            p
        }
        None => Probe::new(reader).guess_file_type().ok()?,
    };

    probe = probe.options(options);
    probe.read().ok()
}

/// QMC 壳扩展名到真实音频扩展名的映射。
fn qmc_inner_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "qmcflac" | "mflac" | "mflac0" => "flac",
        "qmc0" | "qmc3" => "mp3",
        "qmc2" | "qmcogg" | "mgg" | "mgg0" | "mggl" => "ogg",
        _ => return None,
    })
}

fn file_type_for_extension(ext: &str) -> Result<FileType, ()> {
    Ok(match ext {
        "flac" => FileType::Flac,
        "mp3" => FileType::Mpeg,
        "ogg" => FileType::Vorbis,
        "m4a" | "mp4" => FileType::Mp4,
        _ => return Err(()),
    })
}

#[cfg(test)]
mod probe_tests {
    use super::{read_tagged_file_from_path, read_tagged_file_from_path_for_scan};
    use crate::music::tags::find_embedded_picture;
    use id3::TagLike;
    use id3::Version;
    use lofty::file::FileType;
    use lofty::prelude::TaggedFileExt;
    use lofty::probe::Probe;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_name(tag: &str, suffix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("xyq_{tag}_{nanos}.{suffix}"))
    }

    fn minimal_wav_body() -> Vec<u8> {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&38u32.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&44_100u32.to_le_bytes());
        wav.extend_from_slice(&88_200u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(&[0, 0]);
        wav
    }

    fn id3_prefixed_wav(with_cover: bool) -> Vec<u8> {
        let mut id3_tag = id3::Tag::new();
        id3_tag.set_title("Fallback WAV");
        if with_cover {
            id3_tag.add_frame(id3::frame::Picture {
                mime_type: "image/png".to_string(),
                picture_type: id3::frame::PictureType::CoverFront,
                description: "front".to_string(),
                data: vec![137, 80, 78, 71],
            });
        }
        let mut bytes = Vec::new();
        id3_tag
            .write_to(&mut bytes, Version::Id3v24)
            .expect("id3 serialize");
        bytes.extend_from_slice(&minimal_wav_body());
        bytes
    }

    #[test]
    fn wav_with_leading_id3v2_is_recovered_by_salvage_path() {
        let temp_path = unique_temp_name("wavsalvage", "wav");
        fs::write(&temp_path, id3_prefixed_wav(false)).expect("write wav");

        // 常规 Probe 无法识别该文件，补救解析器应能拿到标签。
        assert!(Probe::open(&temp_path).expect("open").read().is_err());
        let tagged_file =
            read_tagged_file_from_path(&temp_path).expect("salvage should read the wav");
        assert_eq!(tagged_file.file_type(), FileType::Wav);

        let _ = fs::remove_file(temp_path);
    }

    #[test]
    fn scan_mode_drops_pictures_while_full_mode_keeps_them() {
        let temp_path = unique_temp_name("wavcover", "wav");
        fs::write(&temp_path, id3_prefixed_wav(true)).expect("write wav");

        let full = read_tagged_file_from_path(&temp_path).expect("full read");
        let scan = read_tagged_file_from_path_for_scan(&temp_path).expect("scan read");

        assert!(find_embedded_picture(&full).is_some());
        assert!(find_embedded_picture(&scan).is_none());

        let _ = fs::remove_file(temp_path);
    }
}
