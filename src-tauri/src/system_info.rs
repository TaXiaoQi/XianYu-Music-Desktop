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

/// Tauri 命令：硬件级机器标识。
/// 优先取 SMBIOS（系统 UUID/整机/主板/机箱序列号）组合的 SHA-256 指纹：
/// 重装系统不变、仅更换主板才变，规避重装系统解封；刻意不绑定硬盘
/// （换盘属常见升级不应变 ID）。全部取不到（个别虚拟机/异常 OEM）时
/// 回退 MachineGuid（重装系统会变），再失败返回空串（前端回退本地缓存 ID）。
/// Linux：优先 DMI（多数发行版序列号字段仅 root 可读，读不到即跳过），
/// 全空回退 /etc/machine-id（系统安装时生成，重装系统才会变）。
#[tauri::command]
pub fn get_machine_id() -> String {
    #[cfg(windows)]
    {
        if let Some(id) = hardware_id() {
            return id;
        }
        return imp::read_reg_string(r"Software\Microsoft\Cryptography", "MachineGuid");
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(id) = hardware_id() {
            return id;
        }
        read_machine_id_file("/etc/machine-id")
            .or_else(|| read_machine_id_file("/var/lib/dbus/machine-id"))
            .unwrap_or_default()
    }
    // macOS：hardware_id() 读 IOPlatformUUID/IOPlatformSerialNumber（几乎必成功）；
    // 读不到（极端沙盒/异常环境）回退空串，前端回退本地缓存 ID。
    #[cfg(target_os = "macos")]
    {
        hardware_id().unwrap_or_default()
    }
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
    #[cfg(target_os = "linux")]
    {
        let manufacturer = read_first_line("/sys/class/dmi/id/sys_vendor");
        let product_name = read_first_line("/sys/class/dmi/id/product_name");
        let machine_name = read_first_line("/proc/sys/kernel/hostname");
        let architecture = std::env::consts::ARCH.to_string();

        // ODM 未填写的占位透传为空白，与 Windows 分支同一套噪音词
        let empty_words = [
            "system manufacturer",
            "to be filled by o.e.m.",
            "no enclosure",
            "-1",
            "none",
            "default string",
            "specified",
        ];
        let clean = |v: &str| {
            let t = v.trim().to_lowercase();
            if v.trim().is_empty() || empty_words.iter().any(|w| t == *w) {
                String::new()
            } else {
                v.trim().to_string()
            }
        };

        let brand = clean(&manufacturer);
        let brand = if brand.is_empty() { "Linux".to_string() } else { brand };
        let model = {
            let m = clean(&product_name);
            if !m.is_empty() {
                m
            } else if !machine_name.is_empty() {
                machine_name.clone()
            } else {
                "Linux PC".to_string()
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
    // macOS：品牌固定 Apple，机型取 sysctl hw.model（如 "Mac16,2"），
    // 电脑名取 scutil ComputerName（与「系统设置 > 通用 > 关于本机」一致）。
    #[cfg(target_os = "macos")]
    {
        let machine_name = mac_computer_name();
        let model = mac_model();
        SystemInfo {
            device_brand: "Apple".to_string(),
            device_model: if model.is_empty() { "Mac".to_string() } else { model },
            os_version: get_os_version(),
            architecture: std::env::consts::ARCH.to_string(),
            machine_name,
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

// ============ 硬件级机器指纹 ============
// 数据源（用户态免管理员）：SMBIOS 表（GetSystemFirmwareTable 'RSMB'）——
// 系统 UUID、整机/主板/机箱序列号，写在固件里，重装系统不变、仅换主板才变。
// 刻意不绑定硬盘序列号：换盘/加盘属常见升级，不应导致设备 ID 变化。
// 全部被 ODM 留空/OEM 占位（个别虚拟机）时回退 MachineGuid。

/// 硬件指纹：可用数据全空时返回 None（由调用方回退 MachineGuid）。
#[cfg(windows)]
fn hardware_id() -> Option<String> {
    let tables = smbios_tables();
    let mut sys_uuid = String::new();
    let mut system = String::new();
    let mut board = String::new();
    let mut chassis = String::new();
    for (t, data, strings) in &tables {
        let field = |idx: u8, strings: &[String]| -> String {
            let s = smbios_string(idx, strings);
            if plausible_serial(&s) { s } else { String::new() }
        };
        match *t {
            // Type 1 系统信息：UUID @0x0A..0x1A，整机序列号字符串索引 @0x09
            1 if data.len() >= 0x1A => {
                let u = &data[0x0A..0x1A];
                let all_zero = u.iter().all(|&b| b == 0);
                let all_ff = u.iter().all(|&b| b == 0xFF);
                if !all_zero && !all_ff {
                    sys_uuid = u.iter().map(|b| format!("{b:02x}")).collect();
                }
                if system.is_empty() {
                    system = field(data[0x09], strings);
                }
            }
            // Type 2 主板：序列号字符串索引 @0x07
            2 if data.len() >= 0x08 => {
                if board.is_empty() {
                    board = field(data[0x07], strings);
                }
            }
            // Type 3 机箱：序列号字符串索引 @0x07（SMBIOS 2.1+）
            3 if data.len() >= 0x08 => {
                if chassis.is_empty() {
                    chassis = field(data[0x07], strings);
                }
            }
            _ => {}
        }
    }

    if sys_uuid.is_empty() && system.is_empty() && board.is_empty() && chassis.is_empty() {
        return None;
    }
    let payload =
        format!("xyhw1|sys={sys_uuid}|sn={system}|board={board}|chassis={chassis}");
    use sha2::{Digest, Sha256};
    Some(hex::encode(Sha256::digest(payload.as_bytes())))
}

/// 读 SMBIOS 表（RSMB），解析为 (类型, 结构数据, 字符串表) 列表。
/// 表头 8 字节（RawSMBIOSData：Used/Major/Minor/DmiRevision/Length u32）。
#[cfg(windows)]
fn smbios_tables() -> Vec<(u8, Vec<u8>, Vec<String>)> {
    use windows_sys::Win32::System::SystemInformation::GetSystemFirmwareTable;
    let provider: u32 = 0x5253_4D42; // 'RSMB'
    let mut out = Vec::new();
    unsafe {
        let need = GetSystemFirmwareTable(provider, 0, std::ptr::null_mut(), 0);
        if need == 0 {
            return out;
        }
        let mut buf = vec![0u8; need as usize];
        let got = GetSystemFirmwareTable(provider, 0, buf.as_mut_ptr(), need);
        if got < 8 {
            return out;
        }
        buf.truncate(got as usize);
        let total = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize;
        let end = (8 + total).min(buf.len());
        let mut p = 8usize;
        while p + 4 <= end {
            let ty = buf[p];
            let len = buf[p + 1] as usize;
            if len < 4 || p + len > end {
                break;
            }
            let data = buf[p..p + len].to_vec();
            // 字符串区：紧跟结构体，\0 分隔，\0\0 结束（空串区即两个连续 \0）
            let mut q = p + len;
            let mut terminated = false;
            while q + 1 < end {
                if buf[q] == 0 && buf[q + 1] == 0 {
                    terminated = true;
                    break;
                }
                q += 1;
            }
            if !terminated {
                break;
            }
            let mut strings = Vec::new();
            let mut idx = p + len;
            while idx < q {
                let e = buf[idx..q]
                    .iter()
                    .position(|&b| b == 0)
                    .map(|i| idx + i)
                    .unwrap_or(q);
                strings.push(String::from_utf8_lossy(&buf[idx..e]).trim().to_string());
                idx = e + 1;
            }
            out.push((ty, data, strings));
            p = q + 2;
        }
    }
    out
}

/// 取 SMBIOS 字符串（索引 1-based，0 = 无）。
#[cfg(windows)]
fn smbios_string(idx: u8, strings: &[String]) -> String {
    if idx == 0 {
        return String::new();
    }
    strings.get(idx as usize - 1).cloned().unwrap_or_default()
}

/// 过滤 OEM 占位/无意义序列号（"To be filled by O.E.M."/"Default string"/全 0 等）。
fn plausible_serial(v: &str) -> bool {
    let t = v.trim();
    if t.chars().count() < 3 {
        return false;
    }
    const BAD: [&str; 13] = [
        "none",
        "n/a",
        "default",
        "default string",
        "to be filled by o.e.m.",
        "o.e.m.",
        "oem",
        "unknown",
        "invalid",
        "not specified",
        "not defined",
        "system serial number",
        "chassis serial number",
    ];
    let lower = t.to_lowercase();
    if BAD.contains(&lower.as_str()) {
        return false;
    }
    // 全 0/全同字符（如 "00000000"、"1111-1111"）
    let mut chars = t.chars();
    let first = chars.next().unwrap_or(' ');
    if t.chars().all(|c| c == first) || t.chars().all(|c| c == '0' || c == '-' || c == ' ') {
        return false;
    }
    true
}

// ============ Linux 实现 ============

/// Linux 硬件指纹：读取 DMI 序列号字段（与 Windows 分支同一 payload 格式，
/// 保证双端 ID 算法一致）。多数发行版这些文件仅 root 可读（0400），
/// 普通用户运行时读取失败得到空串 → 全空返回 None（由调用方回退 machine-id）。
#[cfg(target_os = "linux")]
fn hardware_id() -> Option<String> {
    let field = |path: &str| -> String {
        let v = read_first_line(path);
        if plausible_serial(&v) { v } else { String::new() }
    };
    let sys_uuid = field("/sys/class/dmi/id/product_uuid");
    let system = field("/sys/class/dmi/id/product_serial");
    let board = field("/sys/class/dmi/id/board_serial");
    let chassis = field("/sys/class/dmi/id/chassis_serial");

    if sys_uuid.is_empty() && system.is_empty() && board.is_empty() && chassis.is_empty() {
        return None;
    }
    let payload =
        format!("xyhw1|sys={sys_uuid}|sn={system}|board={board}|chassis={chassis}");
    use sha2::{Digest, Sha256};
    Some(hex::encode(Sha256::digest(payload.as_bytes())))
}

// ============ macOS 实现 ============

/// macOS 硬件指纹：IOPlatformUUID + IOPlatformSerialNumber（ioreg 读取）。
/// IOPlatformUUID 即主板级系统 UUID（重装系统不变、仅换主板才变，与 Windows
/// SMBIOS/换硬盘不变策略同语义），序列号同理。payload 格式与 Windows/Linux
/// 分支一致（board/chassis 在 mac 无独立对应字段，留空）。
#[cfg(target_os = "macos")]
fn hardware_id() -> Option<String> {
    let sys_uuid = read_ioreg_value("IOPlatformUUID");
    let system = read_ioreg_value("IOPlatformSerialNumber");

    if sys_uuid.is_empty() && system.is_empty() {
        return None;
    }
    let payload = format!("xyhw1|sys={sys_uuid}|sn={system}|board=|chassis=");
    use sha2::{Digest, Sha256};
    Some(hex::encode(Sha256::digest(payload.as_bytes())))
}

/// 解析 `ioreg -rd1 -c IOPlatformExpertDevice` 输出中指定 key 的字符串值
/// （行形如 `    "IOPlatformUUID" = "8C10-..."`，key 前有缩进）。
#[cfg(target_os = "macos")]
fn read_ioreg_value(key: &str) -> String {
    let Ok(output) = std::process::Command::new("ioreg")
        .arg("-rd1")
        .arg("-c")
        .arg("IOPlatformExpertDevice")
        .output()
    else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let prefix = format!("\"{key}\" = \"");
    for line in stdout.lines() {
        if let Some(idx) = line.find(&prefix) {
            let rest = &line[idx + prefix.len()..];
            if let Some(end) = rest.find('"') {
                return rest[..end].to_string();
            }
        }
    }
    String::new()
}

/// mac 电脑名：scutil --get ComputerName（与「系统设置 > 通用 > 关于本机」一致），
/// 失败回退 hostname 命令。
#[cfg(target_os = "macos")]
fn mac_computer_name() -> String {
    if let Ok(output) = std::process::Command::new("scutil")
        .arg("--get")
        .arg("ComputerName")
        .output()
    {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    if let Ok(output) = std::process::Command::new("hostname").output() {
        return String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    String::new()
}

/// mac 机型标识：sysctl -n hw.model（如 "Mac16,2"，ioreg 的 model 字段是
/// data 类型解析麻烦，sysctl 直接给型号标识）。
#[cfg(target_os = "macos")]
fn mac_model() -> String {
    std::process::Command::new("sysctl")
        .arg("-n")
        .arg("hw.model")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// macOS OS 版本：sw_vers -productVersion（如 "15.6.1"），统一补 "macOS " 前缀。
#[cfg(target_os = "macos")]
fn get_os_version() -> String {
    if let Ok(output) = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
    {
        let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !v.is_empty() {
            return format!("macOS {v}");
        }
    }
    "macOS".to_string()
}

/// 读取文本文件首行并 trim；文件不存在/不可读时返回空串。
#[cfg(target_os = "linux")]
fn read_first_line(path: &str) -> String {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| content.lines().next().map(|line| line.trim().to_string()))
        .unwrap_or_default()
}

/// 读取 machine-id 文件（32 位十六进制小写）；空内容视为不存在。
#[cfg(target_os = "linux")]
fn read_machine_id_file(path: &str) -> Option<String> {
    let raw = read_first_line(path);
    if raw.is_empty() { None } else { Some(raw) }
}

/// Linux OS 版本：/etc/os-release 的 PRETTY_NAME（如 "Ubuntu 24.04.1 LTS"）。
#[cfg(target_os = "linux")]
fn get_os_version() -> String {
    let content = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    for line in content.lines() {
        if let Some(value) = line.strip_prefix("PRETTY_NAME=") {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }
    "Linux".to_string()
}

#[cfg(all(test, windows))]
mod hardware_id_tests {
    #[test]
    fn hardware_id_on_dev_machine() {
        let id = super::get_machine_id();
        println!("hardware machine id = {id}");
        assert!(!id.is_empty());
    }
}