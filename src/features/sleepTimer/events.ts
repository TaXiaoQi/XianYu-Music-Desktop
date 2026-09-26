/** 睡眠定时器事件：与 Rust 侧 `sleep_timer.rs` 的 SLEEP_TIMER_FIRED_EVENT 保持一致 */

import type { SleepTimerAction } from '../../types';

export const SLEEP_TIMER_FIRED_EVENT = 'app:sleep-timer-fired';

export interface SleepTimerFiredPayload {
  action: SleepTimerAction;
}
