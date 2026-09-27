import { onBeforeUnmount, onMounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useToast } from '../../composables/toast';
import { useI18n } from '../i18n';
import { usePlaybackStore } from '../playback/store';
import { SLEEP_TIMER_FIRED_EVENT, type SleepTimerFiredPayload } from './events';
import { useSleepTimerStore } from './store';

/** 算作「应用内活动」的事件；够用且不需要整机 GetLastInputInfo */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * 睡眠定时的运行时：应用内活动监听 + 每秒心跳 + 后端到点事件同步。
 * 在 App.vue 里挂一次即可；`onHideToTray` 由 App.vue 传入（复用它的托盘睡眠簿记）。
 */
export function useSleepTimer(options: { onHideToTray: () => void }) {
  const sleepTimer = useSleepTimerStore();
  const playbackStore = usePlaybackStore();
  const { showToast } = useToast();
  const { t } = useI18n();

  const noteActivity = () => {
    sleepTimer.noteActivity(Date.now());
  };

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unlisten: UnlistenFn | null = null;
  let disposed = false;

  onMounted(async () => {
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, noteActivity, { passive: true });
    }

    heartbeat = setInterval(() => {
      void sleepTimer.tick(Date.now(), playbackStore.isPlaying);
    }, 1000);

    unlisten = await listen<SleepTimerFiredPayload>(SLEEP_TIMER_FIRED_EVENT, (event) => {
      const firedAction = event.payload?.action ?? 'pause';

      // 音频已经由 Rust 淡出并暂停，前端只做状态同步（不能再走 pauseSong）
      playbackStore.markPausedExternally();
      sleepTimer.handleFired(firedAction);

      if (firedAction === 'hide_to_tray') {
        options.onHideToTray();
        showToast(t('sleepTimer.toastHidden'), 'info');
      } else if (firedAction === 'pause') {
        showToast(t('sleepTimer.toastPaused'), 'info');
      }
      // exit：进程正在退出，不再提示
    });

    // 挂载过程中就被卸载（例如热重载）时补一次注销
    if (disposed) {
      unlisten?.();
      unlisten = null;
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, noteActivity);
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    unlisten?.();
    unlisten = null;
  });
}
