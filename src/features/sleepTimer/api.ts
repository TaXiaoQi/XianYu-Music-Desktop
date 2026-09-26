import { tauriInvoke } from '../../services/tauri/invoke';
import type { SleepTimerAction, SleepTimerSnapshot } from '../../types';

export const sleepTimerApi = {
  /** 设置（或替换）倒计时；seconds 为倒计时秒数 */
  set: (seconds: number, action: SleepTimerAction): Promise<SleepTimerSnapshot> =>
    tauriInvoke('set_sleep_timer', { seconds, action }),
  /** 取消定时器 */
  clear: (): Promise<void> => tauriInvoke('clear_sleep_timer'),
  /** 查询当前定时器（前端刷新/重进设置页后据此恢复显示） */
  get: (): Promise<SleepTimerSnapshot | null> => tauriInvoke('get_sleep_timer'),
  /** 空闲触发时立即执行；与倒计时到点走同一段 Rust 逻辑 */
  runAction: (action: SleepTimerAction): Promise<void> =>
    tauriInvoke('run_sleep_action', { action }),
};
