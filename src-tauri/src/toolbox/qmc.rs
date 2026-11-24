//! QMC 解密：纯逻辑已迁入共享 core（xianyu_core::toolbox::qmc_decrypt），
//! 本文件仅保留 Tauri 命令薄包装与模块内共享别名。

pub(super) use xianyu_core::toolbox::{decrypt_qmc_file_inplace, try_extract_ekey_from_file};

#[tauri::command]
pub fn decrypt_qmc_file(file_path: String, ekey: Option<String>) -> Result<bool, String> {
    xianyu_core::toolbox::decrypt_qmc_file(file_path, ekey)
}
