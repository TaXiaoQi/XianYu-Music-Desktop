import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
  clearAuth,
  getAuthBaseUrl,
  getStoredAuth,
  refreshSession,
  setAuthBaseUrl,
  type AuthPayload,
  type AuthUser,
  type ProfileStats,
} from '../../services/auth/authService';

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
    set: (value: string) => setAuthBaseUrl(value),
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
      const session = await refreshSession();
      setAuth(session);
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
    setAuth,
    setUser,
    setStats,
    reset,
    restoreSession,
  };
});
