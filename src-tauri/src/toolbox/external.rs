use crate::security::path_validator;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn authorized_programs_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))
        .map(|dir| dir.join("authorized_programs.json"))
}

fn read_authorized_programs(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let Ok(path) = authorized_programs_path(app_handle) else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&content)
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

fn save_authorized_programs(
    app_handle: &tauri::AppHandle,
    programs: &[PathBuf],
) -> Result<(), String> {
    let path = authorized_programs_path(app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    }
    let entries: Vec<String> = programs
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    let content = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("写入授权程序列表失败: {e}"))
}

#[tauri::command]
pub fn register_external_program(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app_handle.dialog().file();
    #[cfg(windows)]
    {
        dialog = dialog.add_filter("可执行文件", &["exe"]);
    }
    let Some(picked) = dialog.blocking_pick_file() else {
        return Ok(String::new());
    };
    let program_path = picked
        .into_path()
        .map_err(|e| format!("解析所选路径失败: {e}"))?;

    if !program_path.is_file() {
        return Err(format!("目标程序文件不存在: {}", program_path.display()));
    }

    #[cfg(windows)]
    {
        let ext = program_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            return Err(format!("仅允许添加 .exe 程序，当前扩展名: .{ext}"));
        }
    }

    let canonical = program_path
        .canonicalize()
        .map_err(|e| format!("路径规范化失败: {e}"))?;

    let mut programs = read_authorized_programs(&app_handle);
    if !programs.contains(&canonical) {
        programs.push(canonical.clone());
        save_authorized_programs(&app_handle, &programs)?;
    }

    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_external_program(
    app_handle: tauri::AppHandle,
    path: String,
    args: Vec<String>,
) -> Result<(), String> {
    use std::process::{Command};

    let validated = path_validator::validate_path(&path, None)?;

    if !validated.is_file() {
        return Err(format!("目标程序文件不存在: {}", validated.display()));
    }

    if !read_authorized_programs(&app_handle).contains(&validated) {
        return Err("该程序未获授权，请先在工具箱中重新选择".to_string());
    }

    #[cfg(windows)]
    {
        let ext = validated
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            return Err(format!("仅允许启动 .exe 程序，当前扩展名: .{ext}"));
        }
    }

    if args.len() > 1 {
        return Err("最多允许传递一个启动参数".to_string());
    }

    let safe_args: Vec<String> = args
        .into_iter()
        .map(|arg| {
            if arg.contains('\0') {
                return Err("参数包含非法空字节".to_string());
            }
            Ok(arg)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut cmd = Command::new(&validated);
    for arg in safe_args {
        cmd.arg(arg);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch program: {}", e))?;

    Ok(())
}
