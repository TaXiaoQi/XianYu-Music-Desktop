import { onMounted, onUnmounted, watch } from 'vue';

import { useAuthStore } from '../features/auth/store';
import { checkBanStatus } from '../services/auth/authService';
import { showBanDialog } from './useBanDialog';

/** 封禁检测轮询间隔（毫秒） */
const BAN_CHECK_INTERVAL_MS = 30_000;

/**
 * 登录态心跳：定期调用 check_ban_status。
 * 服务端封禁账号/设备后，客户端在下一个周期被踢下线并弹出封禁提示（更新提示框样式，支持申诉）。
 */
export function useBanCheck() {
  const authStore = useAuthStore();
  let timer: ReturnType<typeof setInterval> | null = null;
  let bannedShown = false;

  async function runCheck(): Promise<void> {
    if (!authStore.isLoggedIn) return;
    const status = await checkBanStatus();
    if (!status.banned || bannedShown) return;
    bannedShown = true;
    authStore.reset();
    await showBanDialog(status.type, status.reason, {
      ciyuanxiId: status.ciyuanxiId,
      nickname: status.nickname,
    });
  }

  function start(): void {
    stop();
    void runCheck();
    timer = setInterval(() => void runCheck(), BAN_CHECK_INTERVAL_MS);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onMounted(() => {
    watch(
      () => authStore.isLoggedIn,
      (loggedIn) => {
        if (loggedIn) {
          bannedShown = false;
          start();
        } else {
          stop();
        }
      },
      { immediate: true },
    );
  });

  onUnmounted(stop);

  return { runCheck };
}