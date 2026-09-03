// 系统/设备信息采集（反馈与错误上报用）。
// 读取 BIOS 中的真实厂商/设备型号（HKLM\HARDWARE\DESCRIPTION\System\BIOS）、
// OS 版本与构建号、计算机名，供后台在反馈 bug 时一眼识别具体设备。
// 仅 Windows 生效；任何一步失败都回退到宽松默认值，绝不抛错。

use serde::Serialize;

#[cfg(windows)]
use windows_sys::Win32::System::SystemInformation;

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SystemInfo {
    /// 厂商，如 "Dell Inc."；读不到回退 "Windows"
    pub device_brand: String,
    /// 设备型号，如 "XPS 15 9520"；读不到回退主机名或 "Windows PC"
    pub device_model: String,
    /// 操作系统版本，如 "Windows 11 (10.0.22631)"
    pub os_version: String,
    /// 系统架构，如 "x64"
    pub architecture: String,
    /// 计算机名（便于在多台机器间定位）
    pub machine_name: String,
}

/// Tauri 命令：采集一次系统/设备信息。
#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    #[cfg(windows)]
    {
        let manufacturer = read_bios_string("SystemManufacturer");
        let product_name = read_bios_string("SystemProductName");
        let machine_name = get_computer_name();
        let architecture = std::env::consts::ARCH.to_string();

        // ODM 未填写的占位透传为空白，避免 "System manufacturer"/-1 噪音
        let empty_words = ["system manufacturer", "to be filled by o.e.m.", "-1", "none", "specified"];
        let clean = |v: &str| {
            let t = v.trim().to_lowercase();
            if v.trim().is_empty() || empty_words.iter().any(|w| t == *w) {
                String::new()
            } else {
                v.trim().to_string()
            }
        };

        let brand = clean(&manufacturer);
        let brand = if brand.is_empty() { "Windows".to_string() } else { brand };
        let model = {
            let m = clean(&product_name);
            if !m.is_empty() {
                m
            } else if !machine_name.is_empty() {
                machine_name.clone()
            } else {
                "Windows PC".to_string()
            }
        };

        SystemInfo {
            device_brand: brand,
            device_model: model,
            os_version: get_os_version(),
            architecture,
            machine_name,
        }
    }
    #[cfg(not(windows))]
    {
        SystemInfo {
            device_brand: std::env::consts::OS.to_string(),
            device_model: std::env::consts::OS.to_string(),
            os_version: std::env::consts::OS.to_string(),
            architecture: std::env::consts::ARCH.to_string(),
            machine_name: String::new(),
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use windows_sys::Win32::System::Registry as Reg;

    /// 读取 Windows NT\CurrentVersion 下的 REG_SZ 值（OS 版本相关）
    pub fn read_key_string(subkey_path: &str, name: &str) -> String {
        read_reg_string(&format!(r"Software\{subkey_path}"), name)
    }

    pub fn read_reg_string(subkey_path: &str, name: &str) -> String {
        unsafe {
            let wide_key: Vec<u16> = subkey_path.encode_utf16().chain(std::iter::once(0)).collect();
            let wide_name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            let mut hkey: *mut c_void = std::ptr::null_mut();
            let status = Reg::RegOpenKeyExW(
                Reg::HKEY_LOCAL_MACHINE,
                wide_key.as_ptr(),
                0,
                Reg::KEY_READ,
                &mut hkey,
            );
            if status != 0 {
                return String::new();
            }
            let mut buf = [0u8; 1024];
            let mut size: u32 = buf.len() as u32;
            let mut typ: u32 = 0;
            let status = Reg::RegQueryValueExW(
                hkey,
                wide_name.as_ptr(),
                std::ptr::null_mut(),
                &mut typ,
                buf.as_mut_ptr(),
                &mut size,
            );
            Reg::RegCloseKey(hkey);
            if status != 0 || typ != 1 /* REG_SZ */ || size < 2 {
                return String::new();
            }
            let wlen = (size as usize / 2).saturating_sub(1);
            let chars: Vec<u16> = buf[..size as usize]
                .chunks_exact(2)
                .take(wlen)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&chars)
        }
    }
}

#[cfg(windows)]
fn get_os_version() -> String {
    let product = imp::read_key_string(
        r"Microsoft\Windows NT\CurrentVersion",
        "ProductName",
    );
    let display = imp::read_key_string(r"Microsoft\Windows NT\CurrentVersion", "DisplayVersion");
    let build = imp::read_key_string(
        r"Microsoft\Windows NT\CurrentVersion",
        "CurrentBuildNumber",
    );

    let name = if !display.is_empty() {
        format!("{product} ({display})")
    } else if !product.is_empty() {
        product
    } else if !build.is_empty() {
        "Windows 10/11".to_string()
    } else {
        "Windows".to_string()
    };

    if build.is_empty() {
        return name;
    }
    format!("{name} (10.0.{build})")
}

#[cfg(windows)]
fn get_computer_name() -> String {
    unsafe {
        let mut buf = [0u16; 260];
        let mut size: u32 = buf.len() as u32;
        // ComputerNameDnsHostname = 9
        let ok = SystemInformation::GetComputerNameExW(9, buf.as_mut_ptr(), &mut size);
        if ok != 0 && size > 0 {
            let len = buf[..size as usize]
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(size as usize);
            return String::from_utf16_lossy(&buf[..len]);
        }
    }
    String::new()
}

#[cfg(windows)]
fn read_bios_string(name: &str) -> String {
    imp::read_reg_string(r"HARDWARE\DESCRIPTION\System\BIOS", name)
}