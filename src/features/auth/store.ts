import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
  checkBanStatus,
  clearAuth,
  getAuthApiSecret,
  getAuthBaseUrl,
  getStoredAuth,
  initAuthFromKeyring,
  onAccountExpired,
  refreshSession,
  setAuthApiSecret,
  setAuthBaseUrl,
  type AuthPayload,
  type AuthUser,
  type ProfileStats,
} from '../../services/auth/authService';
import { showBanDialog, showSessionExpiredDialog } from '../../composables/useBanDialog';
import router from '../../router/index';

let expiredHandlerRegistered = false;

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
      await initAuthFromKeyring();
      const session = await refreshSession();
      if (session) {
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

  if (!expiredHandlerRegistered) {
    expiredHandlerRegistered = true;
    onAccountExpired(() => {
      reset();
      void showSessionExpiredDialog().then((goLogin) => {
        if (goLogin) router.push({ name: 'Auth' });
      });
    });
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
