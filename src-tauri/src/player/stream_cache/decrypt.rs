use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};

pub(super) fn decrypt_cenc_file(path: &std::path::Path, cek: &str) -> Result<(), String> {
    let mut data = std::fs::read(path).map_err(|e| format!("读取缓存文件失败: {}", e))?;
    let key = crate::player::cenc::cek_to_key(cek).map_err(|e| e.to_string())?;
    let decrypted = crate::player::cenc::decrypt_cenc_in_place(&mut data, &key)
        .map_err(|e| format!("CENC 解密失败: {}", e))?;
    if decrypted {
        let mut f = OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|e| format!("打开缓存文件写回失败: {}", e))?;
        f.seek(SeekFrom::Start(0))
            .map_err(|e| format!("定位缓存文件失败: {}", e))?;
        f.write_all(&data)
            .map_err(|e| format!("写回解密文件失败: {}", e))?;
        f.set_len(data.len() as u64)
            .map_err(|e| format!("设置文件长度失败: {}", e))?;
        f.flush().map_err(|e| format!("刷新文件失败: {}", e))?;
    }
    Ok(())
}
