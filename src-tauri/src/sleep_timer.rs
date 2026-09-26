//! 睡眠定时器：到点（或前端上报的应用内空闲）→ 淡出音量 → 暂停播放 → 执行动作。
//!
//! 与 [`crate::power`] 的「播放时保持系统不睡」是**相反**语义，别混。
//! 计时放在 Rust 而不是前端：webview 被隐藏/后台时 `setTimeout` 会被节流甚至暂停，
//! 倒计时会漂移；而暂停、优雅退出本来就是 Rust 侧的职责。
//!
//! 三个动作里 `HideToTray` 只发事件、由前端复用 `enterTraySleep()` 完成隐藏：前端还有
//! 托盘睡眠簿记（`uiStore.mainWindowUiSleepRequested`、渲染快照、图片缓存清理），
//! Rust 直接 `hide()` 会把那套簿记跳过。

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::player::types::PlayerState;
use crate::player::{pause_audio, set_volume};

/// 到点后通知前端同步状态（事件名沿用既有 `app:` 前缀约定）
pub const SLEEP_TIMER_FIRED_EVENT: &str = "app:sleep-timer-fired";

/// 淡出：约 1.2s 内按 60ms 一步把音量降到 0，暂停后立刻把音量复位
const FADE_STEP_MS: u64 = 60;
const FADE_TOTAL_MS: u64 = 1200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SleepAction {
    /// 只暂停播放
    Pause,
    /// 暂停后退出应用
    Exit,
    /// 暂停后隐藏到托盘（隐藏动作由前端完成）
    HideToTray,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct SleepTimerSnapshot {
    pub action: SleepAction,
    pub remaining_seconds: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
struct SleepTimerFiredPayload {
    action: SleepAction,
}

struct Armed {
    action: SleepAction,
    deadline: Instant,
}

#[derive(Default)]
struct SleepTimerInner {
    armed: Option<Armed>,
    /// 单调递增：重设与取消都自增，用来作废已经在途的睡眠任务
    generation: u64,
}

impl SleepTimerInner {
    /// 设置（或替换）定时器，返回本次的 generation
    fn arm(&mut self, action: SleepAction, delay: Duration) -> u64 {
        self.generation += 1;
        self.armed = Some(Armed {
            action,
            deadline: Instant::now() + delay,
        });
        self.generation
    }

    /// 取消定时器（同样作废在途任务）
    fn cancel(&mut self) {
        self.generation += 1;
        self.armed = None;
    }

    /// 该 generation 是否仍是当前有效的那一次
    fn is_current(&self, generation: u64) -> bool {
        self.generation == generation && self.armed.is_some()
    }

    fn snapshot(&self, now: Instant) -> Option<SleepTimerSnapshot> {
        self.armed.as_ref().map(|armed| SleepTimerSnapshot {
            action: armed.action,
            remaining_seconds: remaining_seconds_at(armed.deadline, now),
        })
    }
}

/// 剩余秒数向上取整，避免显示 0 秒却还没到点
fn remaining_seconds_at(deadline: Instant, now: Instant) -> u64 {
    let remaining = deadline.saturating_duration_since(now);
    remaining.as_secs() + u64::from(remaining.subsec_millis() > 0)
}

#[derive(Default)]
pub struct SleepTimerState(Mutex<SleepTimerInner>);

impl SleepTimerState {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SleepTimerInner>, String> {
        self.0.lock().map_err(|error| error.to_string())
    }
}

/// 设置（或替换）睡眠定时器；`seconds` 为倒计时秒数。
#[tauri::command]
pub async fn set_sleep_timer(
    seconds: u64,
    action: SleepAction,
    app: tauri::AppHandle,
    state: tauri::State<'_, SleepTimerState>,
) -> Result<SleepTimerSnapshot, String> {
    let delay = Duration::from_secs(seconds.max(1));
    // 作用域内取完 generation 即释放锁，避免 MutexGuard 跨 await 存活
    let generation = {
        let mut inner = state.lock()?;
        inner.arm(action, delay)
    };
    spawn_deadline_task(app, delay, generation);
    Ok(SleepTimerSnapshot {
        action,
        remaining_seconds: delay.as_secs(),
    })
}

/// 取消睡眠定时器。
#[tauri::command]
pub fn clear_sleep_timer(state: tauri::State<'_, SleepTimerState>) -> Result<(), String> {
    state.lock()?.cancel();
    Ok(())
}

/// 查询当前定时器；前端重进设置页或刷新后据此恢复显示。
#[tauri::command]
pub fn get_sleep_timer(
    state: tauri::State<'_, SleepTimerState>,
) -> Result<Option<SleepTimerSnapshot>, String> {
    Ok(state.lock()?.snapshot(Instant::now()))
}

/// 立即执行动作：空闲模式触发时前端调这条，与倒计时到点走同一段逻辑。
#[tauri::command]
pub async fn run_sleep_action(action: SleepAction, app: tauri::AppHandle) -> Result<(), String> {
    // 空闲触发也要顺带取消可能同时存在的倒计时，避免二次触发
    if let Some(state) = app.try_state::<SleepTimerState>() {
        if let Ok(mut inner) = state.lock() {
            inner.cancel();
        }
    }
    fire_action(action, app).await;
    Ok(())
}

/// 起一个睡到 deadline 的任务；醒来先核对 generation，被重设/取消过就直接放弃。
fn spawn_deadline_task(app: tauri::AppHandle, delay: Duration, generation: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;

        let action = {
            let Some(state) = app.try_state::<SleepTimerState>() else {
                return;
            };
            let Ok(mut inner) = state.lock() else {
                return;
            };
            if !inner.is_current(generation) {
                return;
            }
            let action = inner.armed.as_ref().map(|armed| armed.action);
            inner.cancel();
            action
        };

        if let Some(action) = action {
            fire_action(action, app).await;
        }
    });
}

/// 到点执行：淡出 → 暂停 → 复位音量 → 通知前端 → 按动作收尾。
async fn fire_action(action: SleepAction, app: tauri::AppHandle) {
    fade_out_and_pause(&app).await;
    let _ = app.emit(SLEEP_TIMER_FIRED_EVENT, SleepTimerFiredPayload { action });

    match action {
        SleepAction::Pause => {}
        SleepAction::Exit => crate::graceful_shutdown(&app),
        // 隐藏交给前端：它还要走托盘睡眠簿记（见模块头注释）
        SleepAction::HideToTray => {}
    }
}

async fn fade_out_and_pause(app: &tauri::AppHandle) {
    if app.try_state::<PlayerState>().is_none() {
        return;
    }

    let start = f32::from_bits(
        app.state::<PlayerState>()
            .user_volume
            .load(Ordering::Relaxed),
    );

    if start > 0.0 {
        let steps = (FADE_TOTAL_MS / FADE_STEP_MS).max(1);
        for step in 1..=steps {
            let ratio = 1.0 - (step as f32 / steps as f32);
            let _ = set_volume(start * ratio, app.state::<PlayerState>());
            tokio::time::sleep(Duration::from_millis(FADE_STEP_MS)).await;
        }
    }

    let _ = pause_audio(app.state::<PlayerState>());

    // 暂停后把音量复位：否则后端会一直停在 0，用户恢复播放时可能没声音
    if start > 0.0 {
        let _ = set_volume(start, app.state::<PlayerState>());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_seconds_rounds_up_and_never_goes_negative() {
        let now = Instant::now();
        assert_eq!(remaining_seconds_at(now, now), 0);
        assert_eq!(
            remaining_seconds_at(now + Duration::from_millis(1500), now),
            2
        );
        assert_eq!(remaining_seconds_at(now, now + Duration::from_secs(5)), 0);
    }

    #[test]
    fn arming_and_cancelling_invalidate_earlier_generations() {
        let mut inner = SleepTimerInner::default();
        let first = inner.arm(SleepAction::Pause, Duration::from_secs(60));
        assert!(inner.is_current(first));

        let second = inner.arm(SleepAction::Exit, Duration::from_secs(5));
        assert!(second > first);
        assert!(!inner.is_current(first));
        assert!(inner.is_current(second));

        inner.cancel();
        assert!(!inner.is_current(second));
        assert!(inner.snapshot(Instant::now()).is_none());

        // 取消之后再设置，generation 必须继续递增，不能回到已作废的值
        let third = inner.arm(SleepAction::HideToTray, Duration::from_secs(1));
        assert!(third > second);
    }

    #[test]
    fn snapshot_reports_action_and_remaining_seconds() {
        let mut inner = SleepTimerInner::default();
        inner.arm(SleepAction::HideToTray, Duration::from_secs(90));

        let snapshot = inner.snapshot(Instant::now()).expect("刚设置过，应当有值");
        assert_eq!(snapshot.action, SleepAction::HideToTray);
        assert!(snapshot.remaining_seconds > 88 && snapshot.remaining_seconds <= 90);
    }
}
