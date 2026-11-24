use crate::security::path_validator;

#[tauri::command]
pub fn refresh_folder_songs( // refresh_folder_songs
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
    minimum_file_size_bytes: Option<u64>,
    db_state: tauri::State<'_, crate::database::DbState>,
) -> Result<Vec<crate::music::types::Song>, String> {
    let validated = path_validator::validate_path(&folder_path, None)?;
    let folder_path = validated.to_string_lossy().to_string();
    crate::music::scanner::scan_single_directory_internal(
        folder_path,
        db_state.conn.clone(),
        None,
        1,
        1,
        crate::music::scanner::ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds)
            .with_minimum_file_size_bytes(minimum_file_size_bytes),
    )
}

#[tauri::command]
pub fn file_exists(path: String) -> bool { // file_exists
    xianyu_core::toolbox::file_exists(path)
}
