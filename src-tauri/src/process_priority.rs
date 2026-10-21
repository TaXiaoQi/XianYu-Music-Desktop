//! 进程级调度与电源策略（仅 Windows 实装）：主程序高占用下的保命线。
//!
//! - ABOVE_NORMAL_PRIORITY_CLASS：比普通进程优先获得 CPU，又不像 HIGH /
//!   REALTIME 那样挤压系统其它进程；CPU 打满时保住音频线程与界面响应。
//! - 关闭 EcoQoS 执行速度节流：窗口失焦/最小化被 Windows 判定为低功耗场景
//!   时，防止播放线程被降频降核导致卡顿。
//!
//! 防睡眠由 power.rs 负责（播放期间 SetThreadExecutionState），互补不重复。

#[cfg(windows)]
pub fn boost() {
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, SetPriorityClass, SetProcessInformation,
        ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
        ProcessPowerThrottling,
    };

    unsafe {
        SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);

        // StateMask 置 0 = 显式退出 EcoQoS（本进程不进效率模式）
        let state = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            StateMask: 0,
        };
        SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            &state as *const PROCESS_POWER_THROTTLING_STATE as *const core::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn boost() {}
