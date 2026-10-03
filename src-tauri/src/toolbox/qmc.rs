use crate::security::path_validator;
use std::fs;
use std::path::Path;

pub(super) fn try_extract_ekey_from_file(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let file_size = metadata.len();
    if file_size < 8 {
        return None;
    }

    let tail_size = (file_size.min(4096)) as usize;
    let mut file = fs::File::open(path).ok()?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(file_size - tail_size as u64))
        .ok()?;
    let mut tail = vec![0u8; tail_size];
    file.read_exact(&mut tail).ok()?;

    crate::player::qmc2::extract_ekey_from_footer(&tail)
}

pub(super) fn decrypt_qmc_file_inplace(path: &Path, ekey: &str) -> Result<u64, String> {
    use std::io::{Read, Write};

    let crypto = crate::player::qmc2::QmcCrypto::from_ekey(ekey)
        .map_err(|e| format!("ekey 解析失败: {e}"))?;

    let file_size = fs::metadata(path)
        .map_err(|e| format!("读取文件元数据失败: {e}"))?
        .len();

    let temp_path = path.with_extension("qmc_tmp_dec");

    {
        let mut input = fs::File::open(path).map_err(|e| format!("打开加密文件失败: {e}"))?;
        let mut output =
            fs::File::create(&temp_path).map_err(|e| format!("创建临时解密文件失败: {e}"))?;

        let mut offset: u64 = 0;
        let mut buf = vec![0u8; 64 * 1024];

        loop {
            let n = input
                .read(&mut buf)
                .map_err(|e| format!("读取加密数据失败: {e}"))?;
            if n == 0 {
                break;
            }
            crypto.decrypt(offset as usize, &mut buf[..n]);
            output
                .write_all(&buf[..n])
                .map_err(|e| format!("写入解密数据失败: {e}"))?;
            offset += n as u64;
        }

        output
            .flush()
            .map_err(|e| format!("刷新解密文件失败: {e}"))?;
    }

    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("替换原文件失败: {e}")
    })?;

    Ok(file_size)
}

#[tauri::command] // 实现
pub fn decrypt_qmc_file(file_path: String, ekey: Option<String>) -> Result<bool, String> {
    let validated = path_validator::validate_path(&file_path, None)?;
    let path = validated;

    if !path.is_file() {
        return Err(format!("文件不存在: {}", path.display()));
    }

    let actual_ekey = if let Some(ref ek) = ekey {
        if !ek.is_empty() {
            Some(ek.clone())
        } else {
            try_extract_ekey_from_file(&path)
        }
    } else {
        try_extract_ekey_from_file(&path)
    };

    if let Some(ek) = actual_ekey {
        match decrypt_qmc_file_inplace(&path, &ek) {
            Ok(_) => Ok(true),
            Err(e) => Err(format!("QMC2 解密失败: {e}")),
        }
    } else {
        Ok(false)
    }
}
