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
import SettingHint from './SettingHint.vue';

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { showToast } = useToast();
const router = useRouter();
const playlistSync = usePlaylistSync();

/** 两位数字补零 */
const pad = (n: number) => n.toString().padStart(2, '0');

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

function updateAutoSyncIntervalSeconds(event: Event) {
  const target = event.target as HTMLInputElement;
  // 输入单位为小时，存储为秒。范围 1-168 小时（7 天），默认最小 1 小时。
  const hours = Math.max(0, Math.min(168, Math.round(parseFloat(target.value) || 0)));
  if (hours === 0) {
    showToast('同步间隔不能为 0，已自动设为 1 小时', 'info');
    playlistSync.patchAutoSyncConfig({ syncIntervalSeconds: 3600 });
    target.value = '1';
    return;
  }
  target.value = String(hours);
  playlistSync.patchAutoSyncConfig({ syncIntervalSeconds: hours * 3600 });
}

function updateAutoSyncMaxDelay(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = Math.max(1, Math.min(720, Math.round(parseFloat(target.value) || 1)));
  target.value = String(value);
  playlistSync.patchAutoSyncConfig({ maxDelayMinutes: value });
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
            class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer"
            @click="handleLogout"
          >
            退出登录
          </button>
          <button
            type="button"
            class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer flex items-center gap-1.5"
            @click="handleOpenAccount"
          >
            {{ authStore.isLoggedIn ? '前往个人中心' : '前往登录' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 后端地址 -->
    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          后端地址
        </span>
        <SettingHint severity="warning" :text="`登录、注册、找回密码等接口的根地址。默认指向弦予音乐官方服务端；如自建后端可在此覆盖。默认地址：${DEFAULT_AUTH_BASE_URL}`" />
      </h2>
      <div class="flex items-stretch gap-2 flex-wrap">
        <input
          v-model="draftBaseUrl"
          type="text"
          placeholder="https://example.com/api"
          spellcheck="false"
          class="flex-1 min-w-[240px] h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
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
    </section>

    <!-- 上传选项 -->
    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          上传
        </span>
        <SettingHint text="选择需要同步到云端的数据类型，关闭后该项数据将仅保留在本地。" />
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div
          v-for="item in uploadItems"
          :key="item.key"
          class="flex items-center justify-between gap-4 p-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
        >
          <div class="upload-copy">
            <div class="upload-label text-gray-900 dark:text-white/90">{{ item.label }}</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint :text="item.desc" />
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
      </div>
    </section>

    <!-- 手动同步 -->
    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          手动同步
        </span>
        <SettingHint text="手动将本地歌单、插件、设置同步到云端，或从云端拉取到本地。支持多设备间数据共享。" />
      </h2>

      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 歌单同步项 -->
        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="manual-sync-head">
            <div class="upload-copy min-w-0">
              <div class="upload-label text-gray-900 dark:text-white/90">歌单</div>
              <div class="manual-sync-sub text-gray-500 dark:text-white/50 truncate">
                <span v-if="playlistSync.syncing.value">{{ playlistSync.syncProgress.value || '正在同步...' }}</span>
                <span v-else-if="syncSummary">上次：{{ syncSummary }}<template v-if="formattedLastSync"> · {{ formattedLastSync }}</template></span>
                <span v-else>未同步</span>
              </div>
              <!-- 错误详情列表 -->
              <div v-if="syncErrors.length > 0 && !playlistSync.syncing.value" class="sync-error-list">
                <div v-for="(err, idx) in syncErrors" :key="idx" class="sync-error-item">
                  {{ err }}
                </div>
              </div>
              <div v-if="!playlistSync.isUploadEnabled()" class="manual-sync-tip">上传已关闭，仅下载云端歌单</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.syncing.value"
                @click="playlistSync.uploadOnly()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                同步至服务器
              </button>
              <button
                type="button"
                class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-3 h-8 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.syncing.value"
                @click="playlistSync.downloadOnly()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                更新至本地
              </button>
            </div>
          </div>
        </div>

        <!-- 插件同步项 -->
        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="manual-sync-head">
            <div class="upload-copy min-w-0">
              <div class="upload-label text-gray-900 dark:text-white/90">插件</div>
              <div class="manual-sync-sub text-gray-500 dark:text-white/50 truncate">
                <span v-if="playlistSync.pluginSyncing.value">{{ playlistSync.pluginSyncProgress.value || '正在同步...' }}</span>
                <span v-else-if="pluginSyncSummary">上次：{{ pluginSyncSummary }}<template v-if="formattedLastPluginSync"> · {{ formattedLastPluginSync }}</template></span>
                <span v-else>未同步</span>
              </div>
              <div v-if="pluginSyncErrors.length > 0 && !playlistSync.pluginSyncing.value" class="sync-error-list">
                <div v-for="(err, idx) in pluginSyncErrors" :key="idx" class="sync-error-item">
                  {{ err }}
                </div>
              </div>
              <div v-if="!playlistSync.isPluginUploadEnabled()" class="manual-sync-tip">上传已关闭，仅下载云端插件</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.pluginSyncing.value"
                @click="playlistSync.uploadPluginsOnly()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                同步至服务器
              </button>
              <button
                type="button"
                class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-3 h-8 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.pluginSyncing.value"
                @click="playlistSync.downloadPluginsOnly()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                更新至本地
              </button>
            </div>
          </div>
        </div>

        <!-- 设置同步项 -->
        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="manual-sync-head">
            <div class="upload-copy min-w-0">
              <div class="upload-label text-gray-900 dark:text-white/90">设置</div>
              <div class="manual-sync-sub text-gray-500 dark:text-white/50 truncate">
                <span v-if="playlistSync.settingsSyncing.value">{{ playlistSync.settingsSyncProgress.value || '正在同步...' }}</span>
                <span v-else-if="settingsSyncSummary">上次：{{ settingsSyncSummary }}<template v-if="formattedLastSettingsSync"> · {{ formattedLastSettingsSync }}</template></span>
                <span v-else>未同步</span>
              </div>
              <div v-if="settingsSyncErrors.length > 0 && !playlistSync.settingsSyncing.value" class="sync-error-list">
                <div v-for="(err, idx) in settingsSyncErrors" :key="idx" class="sync-error-item">
                  {{ err }}
                </div>
              </div>
              <div v-if="!playlistSync.isSettingsUploadEnabled()" class="manual-sync-tip">上传已关闭，仅下载云端设置</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.settingsSyncing.value"
                @click="playlistSync.uploadSettingsOnly()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                同步至服务器
              </button>
              <button
                type="button"
                class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-3 h-8 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.settingsSyncing.value"
                @click="playlistSync.downloadSettingsOnly()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                更新至本地
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 自动同步 -->
    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          自动同步
        </span>
        <SettingHint text="按设定的时间自动同步数据到云端。当服务器繁忙时会自动延后并提示，避免带宽拥塞。" />
      </h2>

      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 启用自动同步开关行 -->
        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="upload-label text-gray-900 dark:text-white/90">启用自动同步</div>
          <div class="flex items-center gap-3">
            <SettingHint text="开启后在指定时间自动执行同步" />
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
        </div>

        <!-- 自动同步配置（启用后展开） -->
        <template v-if="settingsStore.settings.autoSync.enabled">
          <!-- 同步间隔 -->
          <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
            <div class="text-sm font-medium text-gray-900 dark:text-white/90">同步间隔</div>
            <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/50">
              <input
                :value="Math.round(settingsStore.settings.autoSync.syncIntervalSeconds / 3600)"
                class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                type="number"
                min="1"
                max="168"
                step="1"
                inputmode="numeric"
                @change="updateAutoSyncIntervalSeconds($event)"
              />
              <span>小时</span>
            </div>
          </div>

          <!-- 最大延迟 -->
          <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
            <div class="text-sm font-medium text-gray-900 dark:text-white/90">最大延迟</div>
            <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/50">
              <input
                :value="settingsStore.settings.autoSync.maxDelayMinutes"
                class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                type="number"
                min="1"
                max="720"
                step="1"
                inputmode="numeric"
                @change="updateAutoSyncMaxDelay($event)"
              />
              <span>分钟</span>
            </div>
          </div>

          <!-- 同步内容提示 -->
          <div class="sync-notice p-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>自动同步将按上方「上传」设置中开启的项目执行（歌单、插件、本地设置）。</span>
          </div>

          <!-- 自动同步状态 -->
          <div v-if="playlistSync.autoSyncStatus.value" class="sync-status p-4" :class="{ 'sync-status--active': playlistSync.autoSyncStatus.value.includes('正在'), 'sync-status--error': playlistSync.autoSyncDelayed.value }">
            <div v-if="playlistSync.autoSyncStatus.value.includes('正在')" class="sync-spinner"></div>
            <svg v-else-if="playlistSync.autoSyncDelayed.value" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="sync-status-text text-gray-900 dark:text-white/85">{{ playlistSync.autoSyncStatus.value }}</span>
          </div>

          <!-- 下次同步时间 -->
          <div v-if="nextSyncTimeDisplay" class="p-4 text-xs text-gray-500 dark:text-white/50">
            下次同步：{{ nextSyncTimeDisplay }}
          </div>
        </template>
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
.manual-sync-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}

.manual-sync-sub {
  font-size: 0.72rem;
  line-height: 1.4;
  margin-top: 2px;
}

.manual-sync-tip {
  font-size: 0.7rem;
  color: rgba(236, 65, 65, 0.7);
  margin-top: 4px;
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
  width: 44px;
  height: 24px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.25);
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: background 0.25s ease;
}

.upload-switch.is-on {
  background: #EC4141;
}

.upload-switch-thumb {
  position: absolute;
  top: 4px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.upload-switch.is-on .upload-switch-thumb {
  transform: translateX(24px);
}

/* 歌单同步 */
.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sync-status--active {
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
  color: #92400e;
  font-size: 0.72rem;
  line-height: 1.5;
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

/* 自动同步配置 */
</style>

<!-- 深色模式使用非 scoped style 块 -->
<!-- 原因：Vue scoped 的 :global(.dark) .xxx 复合选择器在构建时会被错误编译，
     .xxx 部分被丢弃，导致深色样式直接应用到 html.dark 元素而非目标元素。
     改用非 scoped 块 + html.dark .xxx 选择器可正确适配深色模式。 -->
<style>
/* ==================== 深色模式 ==================== */
html.dark .manual-sync-tip {
  color: rgba(248, 139, 139, 0.8);
}

html.dark .upload-switch {
  background: rgba(255, 255, 255, 0.18);
}

html.dark .sync-error-item {
  color: rgba(248, 113, 113, 0.9);
}

html.dark .sync-notice {
  color: rgba(252, 211, 77, 0.9);
}

html.dark .logout-confirm-card {
  background: #1f1f23;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .logout-confirm-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

html.dark .logout-confirm-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .logout-confirm-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .logout-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .logout-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}
</style>
