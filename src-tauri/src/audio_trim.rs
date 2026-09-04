//! 工具箱 · 音频剪辑（裁剪）：探测音频时长，并用内置 ffmpeg 无损剪切音频区间。
//!
//! ffmpeg 由用户自行提供（同文件转换），通过 `ffmpeg_path` 显式指定或走 PATH。
//! 无损剪切使用 `-ss <start> -t <duration> -i <in> -c copy <out>`，不重新编码、速度快。

use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

/// 裁剪日志行（前端监听 `toolbox-trim-log` 事件实时展示）
#[derive(Debug, Clone, Serialize)]
pub struct TrimLog {
    pub input_path: String,
    pub line: String,
}

/// 单个文件裁剪结果
#[derive(Debug, Serialize)]
pub struct TrimAudioResult {
    pub input_path: String,
    pub output_path: String,
    pub success: bool,
    pub error: Option<String>,
}

/// 解析 `Duration: HH:MM:SS.xx` 中的时长（秒）。
fn parse_duration(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// 探测单个音频文件的时长（秒）。
/// 通过 `ffmpeg -i <file>` 的 stderr 解析 `Duration:` 行（ffmpeg 对无输出操作会返回非零退出码，
/// 因此这里只看 stderr 文本而非退出码）。
#[tauri::command]
pub async fn probe_audio_duration(
    input_path: String,
    ffmpeg_path: Option<String>,
) -> Result<f64, String> {
    let program = ffmpeg_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string());

    let output = tokio::process::Command::new(&program)
        .arg("-i")
        .arg(&input_path)
        .output()
        .await
        .map_err(|e| format!("启动 ffmpeg 失败：{e}"))?;

    let data = String::from_utf8_lossy(&output.stderr);
    for line in data.lines() {
        let line = line.trim();
        if let Some(idx) = line.find("Duration: ") {
            let after = &line[idx + "Duration: ".len()..];
            if let Some(comma) = after.find(',') {
                if let Some(secs) = parse_duration(&after[..comma]) {
                    return Ok(secs);
                }
            }
        }
    }
    Err("无法解析音频时长（文件可能损坏或格式不受 ffmpeg 支持）".to_string())
}

/// 无损剪切音频区间：`-ss <start> -t <dur> -i <in> -c copy <out>`。
/// 输出默认与输入同目录，文件名追加 `_trim` 后缀；也可指定 `output_dir`。
/// ffmpeg stderr 逐行通过 `toolbox-trim-log` 事件实时推送前端。
#[tauri::command]
pub async fn trim_audio(
    app: tauri::AppHandle,
    input_path: String,
    start_secs: f64,
    end_secs: f64,
    output_dir: Option<String>,
    ffmpeg_path: Option<String>,
) -> Result<TrimAudioResult, String> {
    // 参数校验
    let in_path = PathBuf::from(&input_path);
    if !in_path.is_file() {
        return Err("输入文件不存在".to_string());
    }
    if !start_secs.is_finite() || !end_secs.is_finite() || end_secs <= start_secs {
        return Err("无效的裁剪区间（需满足 0 ≤ 起点 < 终点）".to_string());
    }
    let clip_duration = end_secs - start_secs;

    let program = ffmpeg_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string());

    let stem = in_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "audio".to_string());
    let ext = in_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "mp3".to_string());
    let file_name = format!("{stem}_trim.{ext}");

    let out_path = match output_dir
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(dir) => PathBuf::from(dir).join(&file_name),
        None => {
            let mut p = in_path.clone();
            p.set_file_name(&file_name);
            p
        }
    };

    // 无损剪切：input seek（快），`-c copy` 不重新编码
    let mut cmd = tokio::process::Command::new(&program);
    cmd.arg("-y")
        .arg("-ss")
        .arg(start_secs.to_string())
        .arg("-t")
        .arg(clip_duration.to_string())
        .arg("-i")
        .arg(&input_path)
        .arg("-c")
        .arg("copy")
        .arg(&out_path);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Err(format!("启动 ffmpeg 失败：{e}"));
        }
    };

    // 逐行读取 stderr（进度与错误都在 stderr），实时 emit；失败时提取关键错误
    let mut err_text = String::new();
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app.emit(
                "toolbox-trim-log",
                &TrimLog {
                    input_path: input_path.clone(),
                    line: line.clone(),
                },
            );
            err_text.push_str(&line);
            err_text.push('\n');
        }
    }
    let status = child.wait().await;

    let success = matches!(status, Ok(ref s) if s.success());
    let error = if success {
        None
    } else {
        let last = err_text
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("裁剪失败")
            .trim();
        Some(if last.len() > 300 {
            last[..300].to_string()
        } else {
            last.to_string()
        })
    };

    Ok(TrimAudioResult {
        input_path: input_path.clone(),
        output_path: out_path.to_string_lossy().to_string(),
        success,
        error,
    })
}