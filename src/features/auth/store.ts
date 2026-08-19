import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
  checkBanStatus,
  clearAuth,
  getAuthApiSecret,
  getAuthBaseUrl,
  getStoredAuth,
  initAuthFromKeyring,
  refreshSession,
  setAuthApiSecret,
  setAuthBaseUrl,
  type AuthPayload,
  type AuthUser,
  type ProfileStats,
} from '../../services/auth/authService';
import { showBanDialog } from '../../composables/useBanDialog';

/**
 * 账号认证状态
 *
 * 提供 token / user / stats 的响应式封装，
 * 以及登录态恢复与登出。所有具体的请求逻辑仍在
 * authService 中，本 store 仅负责 UI 层订阅的状态。
 */
export const useAuthStore = defineStore('auth', () => {
  const initial = getStoredAuth();

  const token = ref<string | null>(initial?.token ?? null);
  const user = ref<AuthUser | null>(initial?.user ?? null);
  const stats = ref<ProfileStats | null>(null);
  const initialized = ref(false);
  const initializing = ref(false);

  const isLoggedIn = computed(() => !!token.value && !!user.value);
  const baseUrl = computed({
    get: () => getAuthBaseUrl(),
    set: (value: string) => {
      void setAuthBaseUrl(value);
    },
  });
  const apiSecret = computed({
    get: () => getAuthApiSecret(),
    set: (value: string) => {
      void setAuthApiSecret(value);
    },
  });

  function setAuth(payload: AuthPayload | null) {
    token.value = payload?.token ?? null;
    user.value = payload?.user ?? null;
    if (!payload) {
      stats.value = null;
    }
  }

  function setUser(nextUser: AuthUser) {
    user.value = nextUser;
  }

  function setStats(nextStats: ProfileStats | null) {
    stats.value = nextStats;
  }

  function reset() {
    clearAuth();
    token.value = null;
    user.value = null;
    stats.value = null;
  }

  async function restoreSession() {
    if (initialized.value || initializing.value) return;
    initializing.value = true;
    try {
      // 从 keyring 加载凭证到内存缓存（含 localStorage 迁移）
      await initAuthFromKeyring();
      const session = await refreshSession();
      if (session) {
        // 页面刷新时校验登录状态：状态正常则继承登录态，异常（封禁）才要求下线
        const status = await checkBanStatus();
        if (status.banned) {
          reset();
          void showBanDialog(status.type, status.reason, {
            ciyuanxiId: status.ciyuanxiId,
            nickname: status.nickname,
          });
        } else {
          setAuth(session);
        }
      } else {
        setAuth(null);
      }
      initialized.value = true;
    } finally {
      initializing.value = false;
    }
  }

  return {
    token,
    user,
    stats,
    initialized,
    initializing,
    isLoggedIn,
    baseUrl,
    apiSecret,
    setAuth,
    setUser,
    setStats,
    reset,
    restoreSession,
  };
});
