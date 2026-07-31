<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../../features/auth/store';
import { useSettingsStore } from '../../features/settings/store';
import { useToast } from '../../composables/toast';
import { usePlaylistSync } from '../../composables/usePlaylistSync';
import {
  DEFAULT_AUTH_BASE_URL,
  getAuthBaseUrl,
  setAuthBaseUrl,
} from '../../services/auth/authService';

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { showToast } = useToast();
const router = useRouter();
const playlistSync = usePlaylistSync();

const draftBaseUrl = ref(getAuthBaseUrl());
const isDirty = computed(() => draftBaseUrl.value.trim() !== getAuthBaseUrl());

watch(
  () => authStore.baseUrl,
  (value) => {
    draftBaseUrl.value = value;
  },
);

// 组件挂载时初始化自动同步调度器
onMounted(() => {
  playlistSync.initAutoSync();
});

// 登录状态变化时检查自动同步
watch(
  () => authStore.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      playlistSync.checkAutoSync();
    }
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
  { key: 'plugins', label: '插件', desc: '同步已安装的插件配置' },
  { key: 'settings', label: '本地设置', desc: '同步播放设置、歌词设置、快捷键等偏好配置' },
];

function toggleUpload(key: keyof typeof settingsStore.settings.upload) {
  settingsStore.patchSettings({
    upload: {
      ...settingsStore.settings.upload,
      [key]: !settingsStore.settings.upload[key],
    },
  });
}

// 歌单同步
const formattedLastSync = computed(() => {
  if (!playlistSync.lastSyncTime.value) return null;
  const date = new Date(playlistSync.lastSyncTime.value);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});

const syncSummary = computed(() => {
  const r = playlistSync.lastSyncResult.value;
  if (!r) return null;
  const parts: string[] = [];
  if (r.uploadedPlaylists > 0) parts.push(`上传 ${r.uploadedPlaylists} 个歌单`);
  if (r.downloadedPlaylists > 0) parts.push(`下载 ${r.downloadedPlaylists} 个歌单`);
  if (r.uploadedSongs > 0) parts.push(`${r.uploadedSongs} 首歌曲`);
  if (r.downloadedSongs > 0) parts.push(`${r.downloadedSongs} 首歌曲`);
  if (r.errors.length > 0) parts.push(`${r.errors.length} 个错误`);
  return parts.length > 0 ? parts.join('，') : '无变更';
});

const syncErrors = computed(() => {
  const r = playlistSync.lastSyncResult.value;
  if (!r || r.errors.length === 0) return [];
  return r.errors;
});

// 插件同步
const formattedLastPluginSync = computed(() => {
  if (!playlistSync.lastPluginSyncTime.value) return null;
  const date = new Date(playlistSync.lastPluginSyncTime.value);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});

const pluginSyncSummary = computed(() => {
  const r = playlistSync.lastPluginSyncResult.value;
  if (!r) return null;
  const parts: string[] = [];
  if (r.uploadedPlugins > 0) parts.push(`上传 ${r.uploadedPlugins} 个插件`);
  if (r.downloadedPlugins > 0) parts.push(`恢复 ${r.downloadedPlugins} 个插件`);
  if (r.errors.length > 0) parts.push(`${r.errors.length} 个错误`);
  return parts.length > 0 ? parts.join('，') : '无变更';
});

const pluginSyncErrors = computed(() => {
  const r = playlistSync.lastPluginSyncResult.value;
  if (!r || r.errors.length === 0) return [];
  return r.errors;
});

// 设置同步
const formattedLastSettingsSync = computed(() => {
  if (!playlistSync.lastSettingsSyncTime.value) return null;
  const date = new Date(playlistSync.lastSettingsSyncTime.value);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});

const settingsSyncSummary = computed(() => {
  const r = playlistSync.lastSettingsSyncResult.value;
  if (!r) return null;
  const parts: string[] = [];
  if (r.uploaded) parts.push('已上传');
  if (r.downloaded) parts.push('已下载');
  if (r.errors.length > 0) parts.push(`${r.errors.length} 个错误`);
  return parts.length > 0 ? parts.join('，') : '无变更';
});

const settingsSyncErrors = computed(() => {
  const r = playlistSync.lastSettingsSyncResult.value;
  if (!r || r.errors.length === 0) return [];
  return r.errors;
});

// 自动同步
const nextSyncTimeDisplay = computed(() => {
  const nextSyncAt = settingsStore.settings.autoSync.nextSyncAt;
  if (!nextSyncAt || nextSyncAt <= 0) return null;
  const date = new Date(nextSyncAt);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
});

function toggleAutoSync() {
  const enabled = !settingsStore.settings.autoSync.enabled;
  playlistSync.patchAutoSyncConfig({ enabled });
  if (enabled) {
    showToast('自动同步已开启', 'success');
  } else {
    showToast('自动同步已关闭', 'info');
  }
}

function updateAutoSyncIntervalHours(event: Event) {
  const target = event.target as HTMLSelectElement;
  const value = parseInt(target.value, 10);
  const current = settingsStore.settings.autoSync;
  // 如果三个都是 0，强制分钟为 1
  const patch: Partial<{ syncIntervalHours: number; syncIntervalMinutes: number }> = { syncIntervalHours: value };
  if (value === 0 && current.syncIntervalMinutes === 0 && current.syncIntervalSeconds === 0) {
    patch.syncIntervalMinutes = 1;
    showToast('同步间隔不能为 0，已自动设为 1 分钟', 'info');
  }
  playlistSync.patchAutoSyncConfig(patch);
}

function updateAutoSyncIntervalMinutes(event: Event) {
  const target = event.target as HTMLSelectElement;
  const value = parseInt(target.value, 10);
  const current = settingsStore.settings.autoSync;
  const patch: Partial<{ syncIntervalMinutes: number; syncIntervalSeconds: number }> = { syncIntervalMinutes: value };
  if (current.syncIntervalHours === 0 && value === 0 && current.syncIntervalSeconds === 0) {
    patch.syncIntervalSeconds = 1;
    showToast('同步间隔不能为 0，已自动设为 1 秒', 'info');
  }
  playlistSync.patchAutoSyncConfig(patch);
}

function updateAutoSyncIntervalSeconds(event: Event) {
  const target = event.target as HTMLSelectElement;
  const value = parseInt(target.value, 10);
  const current = settingsStore.settings.autoSync;
  const patch: Partial<{ syncIntervalSeconds: number; syncIntervalMinutes: number }> = { syncIntervalSeconds: value };
  if (current.syncIntervalHours === 0 && current.syncIntervalMinutes === 0 && value === 0) {
    patch.syncIntervalMinutes = 1;
    showToast('同步间隔不能为 0，已自动设为 1 分钟', 'info');
  }
  playlistSync.patchAutoSyncConfig(patch);
}

function updateAutoSyncMaxDelay(event: Event) {
  const target = event.target as HTMLSelectElement;
  const value = parseInt(target.value, 10);
  if (value > 0) {
    playlistSync.patchAutoSyncConfig({ maxDelayMinutes: value });
    showToast('最大延迟已更新', 'success');
  }
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
            <div class="upload-label text-gray-900 dark:text-white/90">{{ item.label }}</div>
            <div class="upload-desc text-gray-500 dark:text-white/50">{{ item.desc }}</div>
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

    <!-- 歌单同步 -->
    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        歌单同步
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        将本地歌单同步到云端，或从云端拉取歌单到本地。支持多设备间歌单共享。
      </p>

      <!-- 同步状态 -->
      <div v-if="playlistSync.syncing.value" class="sync-status sync-status--active">
        <div class="sync-spinner"></div>
        <span class="sync-status-text text-gray-900 dark:text-white/85">{{ playlistSync.syncProgress.value || '正在同步...' }}</span>
      </div>
      <div v-else-if="syncSummary" class="sync-status" :class="{ 'sync-status--error': syncErrors.length > 0 }">
        <svg v-if="syncErrors.length === 0" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="sync-status-text text-gray-900 dark:text-white/85">上次同步：{{ syncSummary }}</div>
          <div v-if="formattedLastSync" class="sync-status-time text-gray-500 dark:text-white/50">{{ formattedLastSync }}</div>
          <!-- 错误详情列表 -->
          <div v-if="syncErrors.length > 0" class="sync-error-list">
            <div v-for="(err, idx) in syncErrors" :key="idx" class="sync-error-item">
              {{ err }}
            </div>
          </div>
        </div>
      </div>

      <!-- 同步按钮 -->
      <div class="flex items-stretch gap-2 flex-wrap">
        <button
          type="button"
          class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.syncing.value"
          @click="playlistSync.syncPlaylists()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
          立即同步
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.syncing.value"
          @click="playlistSync.uploadOnly()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          仅上传
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.syncing.value"
          @click="playlistSync.downloadOnly()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          仅下载
        </button>
      </div>

      <!-- 同步说明 -->
      <div v-if="!playlistSync.isUploadEnabled()" class="sync-notice">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>歌单上传已关闭，同步时仅下载云端歌单。可在上方「上传」设置中开启。</span>
      </div>
    </section>

    <!-- 插件同步 -->
    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        插件同步
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        将已安装的插件同步到云端，或从云端恢复插件到本地。支持多设备间插件共享。
      </p>

      <!-- 同步状态 -->
      <div v-if="playlistSync.pluginSyncing.value" class="sync-status sync-status--active">
        <div class="sync-spinner"></div>
        <span class="sync-status-text text-gray-900 dark:text-white/85">{{ playlistSync.pluginSyncProgress.value || '正在同步...' }}</span>
      </div>
      <div v-else-if="pluginSyncSummary" class="sync-status" :class="{ 'sync-status--error': pluginSyncErrors.length > 0 }">
        <svg v-if="pluginSyncErrors.length === 0" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="sync-status-text text-gray-900 dark:text-white/85">上次同步：{{ pluginSyncSummary }}</div>
          <div v-if="formattedLastPluginSync" class="sync-status-time text-gray-500 dark:text-white/50">{{ formattedLastPluginSync }}</div>
          <!-- 错误详情列表 -->
          <div v-if="pluginSyncErrors.length > 0" class="sync-error-list">
            <div v-for="(err, idx) in pluginSyncErrors" :key="idx" class="sync-error-item">
              {{ err }}
            </div>
          </div>
        </div>
      </div>

      <!-- 同步按钮 -->
      <div class="flex items-stretch gap-2 flex-wrap">
        <button
          type="button"
          class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.pluginSyncing.value"
          @click="playlistSync.syncPlugins()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
          立即同步
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.pluginSyncing.value"
          @click="playlistSync.uploadPluginsOnly()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          仅上传
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.pluginSyncing.value"
          @click="playlistSync.downloadPluginsOnly()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          仅下载
        </button>
      </div>

      <!-- 同步说明 -->
      <div v-if="!playlistSync.isPluginUploadEnabled()" class="sync-notice">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>插件上传已关闭，同步时仅下载云端插件。可在上方「上传」设置中开启。</span>
      </div>
    </section>

    <!-- 设置同步 -->
    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        设置同步
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        将本地设置同步到云端，或从云端恢复设置到本地。支持多设备间设置共享（主题、歌词、快捷键等）。
      </p>

      <!-- 同步状态 -->
      <div v-if="playlistSync.settingsSyncing.value" class="sync-status sync-status--active">
        <div class="sync-spinner"></div>
        <span class="sync-status-text text-gray-900 dark:text-white/85">{{ playlistSync.settingsSyncProgress.value || '正在同步...' }}</span>
      </div>
      <div v-else-if="settingsSyncSummary" class="sync-status" :class="{ 'sync-status--error': settingsSyncErrors.length > 0 }">
        <svg v-if="settingsSyncErrors.length === 0" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="sync-status-text text-gray-900 dark:text-white/85">上次同步：{{ settingsSyncSummary }}</div>
          <div v-if="formattedLastSettingsSync" class="sync-status-time text-gray-500 dark:text-white/50">{{ formattedLastSettingsSync }}</div>
          <!-- 错误详情列表 -->
          <div v-if="settingsSyncErrors.length > 0" class="sync-error-list">
            <div v-for="(err, idx) in settingsSyncErrors" :key="idx" class="sync-error-item">
              {{ err }}
            </div>
          </div>
        </div>
      </div>

      <!-- 同步按钮 -->
      <div class="flex items-stretch gap-2 flex-wrap">
        <button
          type="button"
          class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.settingsSyncing.value"
          @click="playlistSync.syncSettings()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
          立即同步
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.settingsSyncing.value"
          @click="playlistSync.uploadSettingsOnly()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          仅上传
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          :disabled="playlistSync.settingsSyncing.value"
          @click="playlistSync.downloadSettingsOnly()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          仅下载
        </button>
      </div>

      <!-- 同步说明 -->
      <div v-if="!playlistSync.isSettingsUploadEnabled()" class="sync-notice">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>设置上传已关闭，同步时仅下载云端设置。可在上方「上传」设置中开启。</span>
      </div>
    </section>

    <!-- 自动同步 -->
    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        自动同步
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        按设定的时间自动同步数据到云端。当服务器繁忙时会自动延后并提示，避免带宽拥塞。
      </p>

      <!-- 自动同步开关 -->
      <div class="upload-item">
        <div class="upload-copy">
          <div class="upload-label text-gray-900 dark:text-white/90">启用自动同步</div>
          <div class="upload-desc text-gray-500 dark:text-white/50">开启后在指定时间自动执行同步</div>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="settingsStore.settings.autoSync.enabled"
          class="upload-switch"
          :class="{ 'is-on': settingsStore.settings.autoSync.enabled }"
          @click="toggleAutoSync()"
        >
          <span class="upload-switch-thumb"></span>
        </button>
      </div>

      <!-- 自动同步配置 -->
      <div v-if="settingsStore.settings.autoSync.enabled" class="space-y-3">
        <!-- 同步间隔 -->
        <div class="auto-sync-config-row">
          <label class="auto-sync-label text-gray-900 dark:text-white/90">同步间隔</label>
          <div class="flex items-center gap-1.5">
            <select
              :value="settingsStore.settings.autoSync.syncIntervalHours"
              class="auto-sync-input auto-sync-input-sm"
              @change="updateAutoSyncIntervalHours($event)"
            >
              <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ h - 1 }} 时</option>
            </select>
            <select
              :value="settingsStore.settings.autoSync.syncIntervalMinutes"
              class="auto-sync-input auto-sync-input-sm"
              @change="updateAutoSyncIntervalMinutes($event)"
            >
              <option v-for="m in 60" :key="m - 1" :value="m - 1">{{ m - 1 }} 分</option>
            </select>
            <select
              :value="settingsStore.settings.autoSync.syncIntervalSeconds"
              class="auto-sync-input auto-sync-input-sm"
              @change="updateAutoSyncIntervalSeconds($event)"
            >
              <option v-for="s in 60" :key="s - 1" :value="s - 1">{{ s - 1 }} 秒</option>
            </select>
          </div>
        </div>

        <!-- 最大延迟 -->
        <div class="auto-sync-config-row">
          <label class="auto-sync-label text-gray-900 dark:text-white/90">最大延迟</label>
          <select
            :value="settingsStore.settings.autoSync.maxDelayMinutes"
            class="auto-sync-input"
            @change="updateAutoSyncMaxDelay($event)"
          >
            <option :value="10">10 分钟</option>
            <option :value="30">30 分钟</option>
            <option :value="60">1 小时</option>
            <option :value="120">2 小时</option>
          </select>
        </div>

        <!-- 同步内容提示 -->
        <div class="sync-notice">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>自动同步将按上方「上传」设置中开启的项目执行（歌单、插件、本地设置）。</span>
        </div>

        <!-- 自动同步状态 -->
        <div v-if="playlistSync.autoSyncStatus.value" class="sync-status" :class="{ 'sync-status--active': playlistSync.autoSyncStatus.value.includes('正在'), 'sync-status--error': playlistSync.autoSyncDelayed.value }">
          <div v-if="playlistSync.autoSyncStatus.value.includes('正在')" class="sync-spinner"></div>
          <svg v-else-if="playlistSync.autoSyncDelayed.value" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="sync-status-text text-gray-900 dark:text-white/85">{{ playlistSync.autoSyncStatus.value }}</span>
        </div>

        <!-- 下次同步时间 -->
        <div v-if="nextSyncTimeDisplay" class="auto-sync-next-time text-gray-500 dark:text-white/50">
          下次同步：{{ nextSyncTimeDisplay }}
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
  margin-bottom: 2px;
}

.upload-desc {
  font-size: 0.72rem;
  line-height: 1.4;
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

/* 歌单同步 */
.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.sync-status--active {
  background: rgba(236, 65, 65, 0.06);
  border-color: rgba(236, 65, 65, 0.2);
}

:global(.dark) .sync-status {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .sync-status--active {
  background: rgba(236, 65, 65, 0.1);
  border-color: rgba(236, 65, 65, 0.3);
}

.sync-status-text {
  font-size: 0.78rem;
  line-height: 1.4;
}

.sync-status-time {
  font-size: 0.68rem;
  margin-top: 2px;
}

.sync-status--error {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.2);
}

:global(.dark) .sync-status--error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.sync-error-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sync-error-item {
  font-size: 0.68rem;
  color: #dc2626;
  line-height: 1.4;
  word-break: break-all;
}

:global(.dark) .sync-error-item {
  color: rgba(248, 113, 113, 0.9);
}

.sync-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(236, 65, 65, 0.2);
  border-top-color: #EC4141;
  border-radius: 50%;
  animation: sync-spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes sync-spin {
  to { transform: rotate(360deg); }
}

.sync-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  color: #92400e;
  font-size: 0.72rem;
  line-height: 1.5;
}

:global(.dark) .sync-notice {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.25);
  color: rgba(252, 211, 77, 0.9);
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

/* 自动同步配置 */
.auto-sync-config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

:global(.dark) .auto-sync-config-row {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.auto-sync-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.auto-sync-input {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.8);
  color: #1f2937;
  font-size: 0.8rem;
  outline: none;
  transition: border-color 0.2s ease;
  cursor: pointer;
  min-width: 120px;
}

.auto-sync-input:focus {
  border-color: #EC4141;
}

.auto-sync-input-sm {
  height: 28px;
  min-width: auto;
  padding: 0 6px;
  font-size: 0.72rem;
}

:global(.dark) .auto-sync-input {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

:global(.dark) .auto-sync-input:focus {
  border-color: #EC4141;
}

.auto-sync-input option {
  background: #ffffff;
  color: #1f2937;
}

:global(.dark) .auto-sync-input option {
  background: #1f1f23;
  color: rgba(255, 255, 255, 0.9);
}

.auto-sync-next-time {
  font-size: 0.72rem;
  padding: 4px 14px;
  line-height: 1.5;
}
</style>
