//! 工具箱 · 文件转换：检测系统 ffmpeg，并用它在本地转换常见音频格式。
//!
//! 本模块不捆绑任何二进制：ffmpeg 需由用户自行下载（官网 / static 构建），
//! 并保证 `ffmpeg` 命令能被系统找到（加入 PATH）。检测失败时前端引导用户下载。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

/// 转换日志行（前端监听 `toolbox-convert-log` 事件实时展示）
#[derive(Debug, Clone, Serialize)]
pub struct ConvertLog {
    pub input_path: String,
    pub line: String,
}

/// 支持的全部目标格式（输出文件扩展名）。`alac` 与 `m4a` 都落到 `.m4a` 容器，
/// 仅编码器不同，故单独列为两种"格式"便于用户选择。
const TARGET_FORMATS: &[&str] = &[
    "mp3", "aac", "m4a", "alac", "wav", "flac", "ogg", "opus", "wma", "aiff", "ape",
];

/// ffmpeg 检测结果
#[derive(Debug, Serialize, Deserialize)]
pub struct FfmpegDetection {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConvertAudioResult {
    pub input_path: String,
    pub output_path: String,
    pub success: bool,
    pub error: Option<String>,
}

/// 检测 ffmpeg：优先用显式路径，否则按 PATH 查找 `ffmpeg -version`。
#[tauri::command]
pub async fn detect_ffmpeg(ffmpeg_path: Option<String>) -> FfmpegDetection {
    let program = ffmpeg_path.filter(|p| !p.trim().is_empty()).unwrap_or_else(|| "ffmpeg".to_string());
    let output = match tokio::process::Command::new(&program)
        .arg("-version")
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            return FfmpegDetection {
                available: false,
                path: Some(program),
                version: None,
                error: Some(format!("无法启动 ffmpeg：{e}")),
            };
        }
    };

    if !output.status.success() {
        return FfmpegDetection {
            available: false,
            path: Some(program),
            version: None,
            error: Some("ffmpeg 启动失败（非零退出码）".to_string()),
        };
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout.lines().next().map(|s| s.to_string()).map(|s| {
        if s.len() > 120 {
            s[..120].to_string()
        } else {
            s
        }
    });

    FfmpegDetection {
        available: true,
        path: Some(program),
        version,
        error: None,
    }
}

/// 一次性校准 output 扩展名与编码器参数。
/// 返回 (输出扩展名, ffmpeg 附加编码参数)。
fn format_profile(fmt: &str) -> (&'static str, Vec<&'static str>) {
    match fmt {
        "mp3" => ("mp3", vec!["-codec:a", "libmp3lame", "-q:a", "2"]),
        "aac" => ("m4a", vec!["-codec:a", "aac", "-b:a", "320k"]),
        // m4a 与 alac 共用 .m4a 容器，仅编码器不同（alac → ALAC）
        "m4a" => ("m4a", vec!["-codec:a", "aac", "-b:a", "320k"]),
        "alac" => ("m4a", vec!["-codec:a", "alac"]),
        "opus" => ("opus", vec!["-codec:a", "libopus", "-b:a", "320k"]),
        "wma" => ("wma", vec!["-codec:a", "wmav2"]),
        "ape" => ("ape", vec!["-codec:a", "ape"]),
        "wav" => ("wav", vec![]),
        "flac" => ("flac", vec![]),
        "ogg" => ("ogg", vec![]),
        "aiff" => ("aiff", vec![]), // ffmpeg 按容器自动选默认编码器
        _ => ("mp3", vec!["-codec:a", "libmp3lame", "-q:a", "2"]),
    }
}

/// 由输入路径与输出模板推导输出文件名。
/// - `template` 为空 → 使用原文件名（换新扩展名）
/// - 否则替换 `{title}`(原文件名) 与 `{ext}`(新扩展名)；模板不含 `{title}` 且为多文件时追加序号避免覆盖
fn build_output_stem(
    input: &Path,
    template: &str,
    ext: &str,
    index: usize,
    total: usize,
) -> String {
    let original = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());

    let trimmed = template.trim();
    if trimmed.is_empty() {
        return original;
    }
    let mut stem = trimmed
        .replace("{title}", &original)
        .replace("{ext}", ext);
    // 模板没有 {title} 占位且一次转多个文件 → 附加序号，防止相互覆盖
    if total > 1 && !template.contains("{title}") {
        stem = format!("{stem}_{}", index + 1);
    }
    // 清理非法文件名字符
    for ch in ['\\', '/', ':', '*', '?', '"', '<', '>', '|'] {
        stem = stem.replace(ch, "_");
    }
    if stem.is_empty() {
        original
    } else {
        stem
    }
}

/// 批量转换：对每个输入文件调用 `ffmpeg -y -i <in> [codec args] <out>`。
/// ffmpeg 的 stderr 会逐行通过 `toolbox-convert-log` 事件实时推送前端。
/// 返回每个文件的转换结果（失败不中断批量）。
#[tauri::command]
pub async fn convert_audio(
    app: tauri::AppHandle,
    input_paths: Vec<String>,
    out_dir: String,
    target_format: String,
    ffmpeg_path: Option<String>,
    out_name: Option<String>,
    sample_rate: Option<u32>,
) -> Result<Vec<ConvertAudioResult>, String> {
    // 目标格式白名单校验，防止把任意字符串拼进文件名/参数
    if !TARGET_FORMATS.contains(&target_format.as_str()) {
        return Err(format!("不支持的目标格式：{target_format}"));
    }
    // 输出目录必须存在
    let out_dir = PathBuf::from(&out_dir);
    if !out_dir.is_dir() {
        return Err(format!("输出目录不存在：{}", out_dir.to_string_lossy()));
    }
    // ffmpeg 可执行：优先手动指定路径，否则走 PATH
    let program = ffmpeg_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string());

    let (ext, encode_args) = format_profile(&target_format);
    let template = out_name.unwrap_or_default();
    let total = input_paths.len();
    let mut results = Vec::with_capacity(total);

    for (i, input) in input_paths.iter().enumerate() {
        let in_path = PathBuf::from(input);
        if !in_path.is_file() {
            results.push(ConvertAudioResult {
                input_path: input.clone(),
                output_path: String::new(),
                success: false,
                error: Some("输入文件不存在".to_string()),
            });
            continue;
        }

        let stem = build_output_stem(&in_path, &template, ext, i, total);
        let out_path = out_dir.join(format!("{stem}.{ext}"));

        let mut cmd = tokio::process::Command::new(&program);
        cmd.arg("-y")
            .arg("-i")
            .arg(input);
        // 采样率（用户指定时生效；忽略明显非法值）
        if let Some(rate) = sample_rate {
            if (2000..=768000).contains(&rate) {
                cmd.arg("-ar").arg(rate.to_string());
            }
        }
        cmd.args(&encode_args).arg(&out_path);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                results.push(ConvertAudioResult {
                    input_path: input.clone(),
                    output_path: out_path.to_string_lossy().to_string(),
                    success: false,
                    error: Some(format!("启动 ffmpeg 失败：{e}")),
                });
                continue;
            }
        };

        // 逐行读取 stderr（ffmpeg 进度在 stderr），实时 emit；同时累加用于失败时提取关键错误
        let mut err_text = String::new();
        if let Some(stderr) = child.stderr.take() {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app.emit(
                    "toolbox-convert-log",
                    &ConvertLog {
                        input_path: input.clone(),
                        line: line.clone(),
                    },
                );
                err_text.push_str(&line);
                err_text.push('\n');
            }
        }
        let status = child.wait().await;

        let success = matches!(
            status,
            Ok(ref s) if s.success()
        );
        let error = if success {
            None
        } else {
            // 取 stderr 最后一行非空内容，截断到 300 字符便于展示
            let last = err_text
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("转换失败")
                .trim();
            Some(if last.len() > 300 {
                last[..300].to_string()
            } else {
                last.to_string()
            })
        };

        results.push(ConvertAudioResult {
            input_path: input.clone(),
            output_path: out_path.to_string_lossy().to_string(),
            success,
            error,
        });
    }

    Ok(results)
}