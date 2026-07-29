<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../../features/auth/store';
import { useSettingsStore } from '../../features/settings/store';
import { useToast } from '../../composables/toast';
import {
  DEFAULT_AUTH_BASE_URL,
  getAuthBaseUrl,
  setAuthBaseUrl,
} from '../../services/auth/authService';

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { showToast } = useToast();
const router = useRouter();

const draftBaseUrl = ref(getAuthBaseUrl());
const isDirty = computed(() => draftBaseUrl.value.trim() !== getAuthBaseUrl());

watch(
  () => authStore.baseUrl,
  (value) => {
    draftBaseUrl.value = value;
  },
);

function handleSaveBaseUrl() {
  const next = draftBaseUrl.value.trim();
  setAuthBaseUrl(next);
  showToast('后端地址已更新', 'success');
}

function handleResetBaseUrl() {
  draftBaseUrl.value = DEFAULT_AUTH_BASE_URL;
  setAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
  showToast('已恢复默认后端地址', 'info');
}

function handleOpenAccount() {
  void router.push('/auth');
}

// 退出登录二次确认
const showLogoutConfirm = ref(false);

function handleLogout() {
  showLogoutConfirm.value = true;
}

function confirmLogout() {
  showLogoutConfirm.value = false;
  authStore.reset();
  showToast('已退出登录', 'info');
}

// 上传选项
const uploadItems: Array<{ key: keyof typeof settingsStore.settings.upload; label: string; desc: string }> = [
  { key: 'playlists', label: '歌单', desc: '同步本地创建与编辑的歌单' },
  { key: 'history', label: '播放历史', desc: '同步播放记录到云端' },
  { key: 'favorites', label: '收藏', desc: '同步收藏的歌曲' },
  { key: 'plugins', label: '插件', desc: '同步已安装的插件配置' },
];

function toggleUpload(key: keyof typeof settingsStore.settings.upload) {
  settingsStore.patchSettings({
    upload: {
      ...settingsStore.settings.upload,
      [key]: !settingsStore.settings.upload[key],
    },
  });
}
</script>

<template>
  <div class="w-full space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <!-- 登录状态 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        账号状态
      </h2>
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-black/5 dark:bg-white/10 text-[#EC4141] text-sm font-black"
          >
            <img
              v-if="authStore.isLoggedIn && authStore.user?.avatar"
              :src="authStore.user.avatar"
              alt=""
              class="h-full w-full object-cover"
            />
            <span v-else-if="authStore.isLoggedIn">
              {{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}
            </span>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
              <template v-if="authStore.isLoggedIn">
                {{ authStore.user?.nickname || authStore.user?.username }}
              </template>
              <template v-else>未登录</template>
            </div>
            <div class="text-xs text-gray-500 dark:text-white/50 truncate mt-0.5">
              <template v-if="authStore.isLoggedIn">
                @{{ authStore.user?.username }} · {{ authStore.user?.email }}
              </template>
              <template v-else>登录后可同步个人资料到云端服务器</template>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            v-if="authStore.isLoggedIn"
            type="button"
            class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-4 py-1.5 rounded-md text-xs font-medium transition cursor-pointer"
            @click="handleLogout"
          >
            退出登录
          </button>
          <button
            type="button"
            class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 py-1.5 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer"
            @click="handleOpenAccount"
          >
            {{ authStore.isLoggedIn ? '前往个人中心' : '前往登录' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 后端地址 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        后端地址
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        登录、注册、找回密码等接口的根地址。默认指向弦予音乐官方服务端；如自建后端可在此覆盖。
      </p>
      <div class="flex items-stretch gap-2 flex-wrap">
        <input
          v-model="draftBaseUrl"
          type="text"
          placeholder="https://example.com/api"
          spellcheck="false"
          class="flex-1 min-w-[240px] h-10 px-3 bg-transparent border-b border-black/15 dark:border-white/15 text-sm font-mono text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
        />
        <button
          type="button"
          class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isDirty"
          @click="handleSaveBaseUrl"
        >
          保存
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer"
          @click="handleResetBaseUrl"
        >
          恢复默认
        </button>
      </div>
      <p class="text-xs text-gray-500 dark:text-white/50 m-0">
        默认地址：<code class="font-mono">{{ DEFAULT_AUTH_BASE_URL }}</code>
      </p>
    </section>

    <!-- 上传选项 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        上传
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        选择需要同步到云端的数据类型，关闭后该项数据将仅保留在本地。
      </p>
      <div class="grid gap-2">
        <div
          v-for="item in uploadItems"
          :key="item.key"
          class="upload-item"
        >
          <div class="upload-copy">
            <div class="upload-label">{{ item.label }}</div>
            <div class="upload-desc">{{ item.desc }}</div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="settingsStore.settings.upload[item.key]"
            class="upload-switch"
            :class="{ 'is-on': settingsStore.settings.upload[item.key] }"
            @click="toggleUpload(item.key)"
          >
            <span class="upload-switch-thumb"></span>
          </button>
        </div>
      </div>
    </section>

    <!-- 退出登录确认弹窗 -->
    <Teleport to="body">
      <Transition name="logout-modal">
        <div
          v-if="showLogoutConfirm"
          class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          @click.self="showLogoutConfirm = false"
        >
          <div class="logout-confirm-card">
            <div class="logout-confirm-icon">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <h3 class="logout-confirm-title">退出登录</h3>
            <p class="logout-confirm-desc">确认要退出当前账号吗？退出后需重新登录才能同步云端数据。</p>
            <div class="logout-confirm-actions">
              <button
                type="button"
                class="logout-btn logout-btn--ghost"
                @click="showLogoutConfirm = false"
              >
                取消
              </button>
              <button
                type="button"
                class="logout-btn logout-btn--danger"
                @click="confirmLogout"
              >
                确认退出
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.upload-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.upload-item:hover {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(236, 65, 65, 0.18);
}

:global(.dark) .upload-item {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .upload-item:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(236, 65, 65, 0.3);
}

.upload-copy {
  min-width: 0;
}

.upload-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  margin-bottom: 2px;
}

:global(.dark) .upload-label {
  color: rgba(255, 255, 255, 0.92);
}

.upload-desc {
  font-size: 0.72rem;
  color: var(--text-secondary, #6b7280);
  line-height: 1.4;
}

:global(.dark) .upload-desc {
  color: rgba(255, 255, 255, 0.5);
}

.upload-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.25);
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: background 0.25s ease;
}

:global(.dark) .upload-switch {
  background: rgba(255, 255, 255, 0.18);
}

.upload-switch.is-on {
  background: #EC4141;
}

.upload-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.upload-switch.is-on .upload-switch-thumb {
  transform: translateX(18px);
}

/* 退出登录确认弹窗 */
.logout-confirm-card {
  width: min(86vw, 360px);
  background: #ffffff;
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.logout-confirm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #EC4141;
  margin: 0 auto 14px;
}

.logout-confirm-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}

.logout-confirm-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 20px;
}

.logout-confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.logout-btn {
  flex: 1;
  height: 38px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
  border: 1px solid transparent;
}

.logout-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.logout-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31 41 55);
}

.logout-btn--danger {
  background: #EC4141;
  color: #ffffff;
}

.logout-btn--danger:hover {
  background: #d13b3b;
}

/* 弹窗过渡动画 */
.logout-modal-enter-active,
.logout-modal-leave-active {
  transition: opacity 0.2s ease;
}

.logout-modal-enter-active .logout-confirm-card,
.logout-modal-leave-active .logout-confirm-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.logout-modal-enter-from,
.logout-modal-leave-to {
  opacity: 0;
}

.logout-modal-enter-from .logout-confirm-card,
.logout-modal-leave-to .logout-confirm-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

/* 深色模式 */
:global(.dark) .logout-confirm-card {
  background: #1f1f23;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .logout-confirm-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

:global(.dark) .logout-confirm-title {
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .logout-confirm-desc {
  color: rgba(255, 255, 255, 0.6);
}

:global(.dark) .logout-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

:global(.dark) .logout-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}
</style>
