//! 自定义歌词字体管理。
//!
//! 把用户挑选的字体文件复制进应用数据目录统一保管，并支持把字体内容
//! 编码为 data URL 返回给前端，供歌词渲染直接内嵌加载。

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// 支持导入的字体格式。
#[derive(Clone, Copy, PartialEq, Eq)]
enum FontKind {
    /// TrueType 轮廓字体（.ttf）。
    TrueType,
    /// OpenType 轮廓字体（.otf）。
    OpenType,
}

impl FontKind {
    /// 根据扩展名判定字体格式，其余格式一律拒绝。
    fn probe(path: &Path) -> Result<Self, String> {
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        match extension.as_deref() {
            Some("ttf") => Ok(Self::TrueType),
            Some("otf") => Ok(Self::OpenType),
            _ => Err("Only .ttf and .otf font files are supported".to_string()),
        }
    }

    /// 落盘时使用的文件扩展名。
    fn file_extension(self) -> &'static str {
        match self {
            Self::TrueType => "ttf",
            Self::OpenType => "otf",
        }
    }

    /// 返回给前端的格式描述。
    fn format_label(self) -> &'static str {
        match self {
            Self::TrueType => "truetype",
            Self::OpenType => "opentype",
        }
    }

    /// data URL 头部使用的 MIME 类型。
    fn mime_type(self) -> &'static str {
        match self {
            Self::TrueType => "font/ttf",
            Self::OpenType => "font/otf",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedLyricsFont {
    id: String,
    name: String,
    family: String,
    file_path: String,
    imported_at: u64,
    format: String,
}

/// 取当前 Unix 毫秒时间戳，作为导入时间记录。
fn unix_millis_now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .map_err(|err| err.to_string())
}

/// 以文件主名作为字体展示名；主名为空时回退到默认文案。
fn derive_display_name(source: &Path) -> String {
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::trim)
        .filter(|stem| !stem.is_empty());
    match stem {
        Some(stem) => stem.to_string(),
        None => "Custom Lyrics Font".to_string(),
    }
}

/// 确保应用数据下的自定义字体目录存在，并返回其路径。
fn ensure_fonts_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("custom-lyrics-fonts");
    fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    Ok(directory)
}

/// 导入一个歌词字体文件：校验格式后复制到应用数据目录。
#[tauri::command]
pub fn import_lyrics_font(
    app: AppHandle,
    source_path: String,
) -> Result<ImportedLyricsFont, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Selected font file does not exist".to_string());
    }

    let kind = FontKind::probe(&source)?;
    let font_id = Uuid::new_v4().to_string();
    let stored_name = format!("{font_id}.{}", kind.file_extension());
    let target = ensure_fonts_directory(&app)?.join(stored_name);

    fs::copy(&source, &target).map_err(|err| err.to_string())?;

    Ok(ImportedLyricsFont {
        family: format!("XianYu Imported Lyrics Font {font_id}"),
        id: font_id,
        name: derive_display_name(&source),
        file_path: target.to_string_lossy().into_owned(),
        imported_at: unix_millis_now()?,
        format: kind.format_label().to_string(),
    })
}

/// 把已导入的字体文件读取为 base64 data URL。
/// 出于安全考虑，仅允许读取位于自定义字体目录内的文件。
#[tauri::command]
pub fn read_lyrics_font_data_url(app: AppHandle, font_path: String) -> Result<String, String> {
    let candidate = PathBuf::from(font_path);
    if !candidate.is_file() {
        return Err("Imported font file does not exist".to_string());
    }

    let kind = FontKind::probe(&candidate)?;
    let fonts_dir =
        fs::canonicalize(ensure_fonts_directory(&app)?).map_err(|err| err.to_string())?;
    let real_path = fs::canonicalize(&candidate).map_err(|err| err.to_string())?;

    if !real_path.starts_with(&fonts_dir) {
        return Err("Imported font file is outside the custom lyrics fonts directory".to_string());
    }

    let bytes = fs::read(real_path).map_err(|err| err.to_string())?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{encoded}", kind.mime_type()))
}
