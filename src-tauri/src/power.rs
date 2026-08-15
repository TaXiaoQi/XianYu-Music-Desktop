#[cfg(target_os = "windows")]
mod platform {
    use std::sync::{mpsc, OnceLock};

    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    static PREVENT_SLEEP_SENDER: OnceLock<Result<mpsc::Sender<bool>, String>> = OnceLock::new();

    fn create_sender() -> Result<mpsc::Sender<bool>, String> {
        let (sender, receiver) = mpsc::channel::<bool>();
        std::thread::Builder::new()
            .name("prevent-system-sleep".to_string())
            .spawn(move || {
                let mut active = false;

                while let Ok(mut requested) = receiver.recv() {
                    while let Ok(next) = receiver.try_recv() {
                        requested = next;
                    }

                    if requested == active {
                        continue;
                    }

                    let flags = if requested {
                        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
                    } else {
                        ES_CONTINUOUS
                    };
                    let result = unsafe { SetThreadExecutionState(flags) };
                    if result == 0 {
                        eprintln!("failed to update Windows execution state");
                        continue;
                    }

                    active = requested;
                }

                if active {
                    unsafe {
                        SetThreadExecutionState(ES_CONTINUOUS);
                    }
                }
            })
            .map_err(|error| format!("failed to start sleep-prevention thread: {error}"))?;

        Ok(sender)
    }

    pub fn set(active: bool) -> Result<(), String> {
        let sender = PREVENT_SLEEP_SENDER.get_or_init(create_sender);
        sender
            .as_ref()
            .map_err(Clone::clone)?
            .send(active)
            .map_err(|error| format!("failed to update sleep prevention: {error}"))
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn set(_active: bool) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn set_prevent_sleep(active: bool) -> Result<(), String> {
    platform::set(active)
}
