// path_queries.rs - 路径归属查询命令
//
// 前端原本自行维护「分隔符判断 + 归一化 + 大小写不敏感比较」的路径匹配
// 逻辑（utils/path.ts 的 normalizePath、libraryRootOwnership、
// playerFileManager 的 isSongInFolderScope）。匹配规则只有一处实现才是
// 安全的：这里统一调 Core 的 music::utils 匹配助手，前端改为经命令查询。
// 列表过滤走批量命令，避免逐条 IPC。

use xianyu_core::music::utils;

/// 过滤出位于 folder 目录范围内（相同或内部）的路径，保持入参顺序。
#[tauri::command]
pub fn filter_paths_within_folder(folder_path: String, paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| utils::path_within_root_scope(path, &folder_path))
        .collect()
}

/// 在根路径列表中找出包含 target 的最深根目录；无命中返回 None。
#[tauri::command]
pub fn find_deepest_owning_root(
    root_paths: Vec<String>,
    target_path: String,
) -> Option<String> {
    let refs: Vec<&str> = root_paths.iter().map(String::as_str).collect();
    utils::find_deepest_owning_root(&refs, &target_path).map(str::to_string)
}

/// candidate 是否位于 root 目录范围内（相同或内部，目录边界对齐）。
#[tauri::command]
pub fn path_within_root_scope(candidate: String, root: String) -> bool {
    utils::path_within_root_scope(&candidate, &root)
}

/// candidate 归一化后是否以 root 为前缀（不要求目录边界对齐）。
#[tauri::command]
pub fn path_under_root_prefix(candidate: String, root: String) -> bool {
    utils::path_under_root_prefix(&candidate, &root)
}
