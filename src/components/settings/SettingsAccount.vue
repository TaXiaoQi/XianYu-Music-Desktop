<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';

import { useAuthStore } from '../../features/auth/store';
import { useSettingsStore } from '../../features/settings/store';
import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { usePlaylistSync } from '../../composables/usePlaylistSync';
import { showChangePasswordDialog } from '../../composables/useChangePasswordDialog';
import { showDeleteAccountDialog } from '../../composables/useDeleteAccountDialog';
import { logout } from '../../services/auth/authService';
import {
  DEFAULT_AUTH_BASE_URL,
  getAuthApiSecret,
  getAuthBaseUrl,
  setAuthApiSecret,
  setAuthBaseUrl,
} from '../../services/auth/authService';
import SettingHint from './SettingHint.vue';
import SettingsCloud from './SettingsCloud.vue';
import PluginConfirmDialog from './plugins/PluginConfirmDialog.vue';

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();
const { showToast } = useToast();
const playlistSync = usePlaylistSync();

const pad = (n: number) => n.toString().padStart(2, '0');

const draftBaseUrl = ref(getAuthBaseUrl());
const draftApiSecret = ref(getAuthApiSecret() ?? '');
const pwdVisible = reactive<Record<string, boolean>>({});

const pwdFocused = reactive<Record<string, boolean>>({});
const isDirty = computed(() =>
  draftBaseUrl.value.trim() !== getAuthBaseUrl()
  || draftApiSecret.value.trim() !== (getAuthApiSecret() ?? '')
);

watch(
  () => authStore.baseUrl,
  (value) => {
    draftBaseUrl.value = value;
  },
);

watch(
  () => authStore.apiSecret,
  (value) => {
    draftApiSecret.value = value ?? '';
  },
);

onMounted(() => {
  playlistSync.initAutoSync();
});
watch(
  () => authStore.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      playlistSync.checkAutoSync();
    }
  },
);
async function handleSaveBaseUrl() {
  const next = draftBaseUrl.value.trim();
  const nextSecret = draftApiSecret.value.trim();
  try {
    await setAuthBaseUrl(next);
    await setAuthApiSecret(nextSecret);
    showToast('后端连接配置已更新', 'success');
  } catch {
    showToast('后端连接配置保存失败，请重试', 'error');
  }
}

async function handleResetBaseUrl() {
  draftBaseUrl.value = DEFAULT_AUTH_BASE_URL;
  draftApiSecret.value = '';
  try {
    await setAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
    await setAuthApiSecret('');
    showToast('已恢复默认后端连接配置', 'info');
  } catch {
    showToast('默认后端连接配置保存失败，请重试', 'error');
  }
}

const showLogoutConfirm = ref(false);

function handleLogout() {
  showLogoutConfirm.value = true;
}

async function confirmLogout() {
  showLogoutConfirm.value = false;
  try {
    await logout();
  } catch {
    // 忽略登出接口异常，本地登出照常执行
  }
  authStore.reset();
  showToast('已退出登录', 'info');
}

function handleChangePassword() {
  void showChangePasswordDialog();
}

function handleDeleteAccount() {
  void showDeleteAccountDialog();
}

const uploadItems: Array<{ key: keyof typeof settingsStore.settings.upload; label: string; desc: string }> = [
  { key: 'playlists', label: '歌单', desc: '自动同步本地创建与编辑的歌单' },
  { key: 'favorites', label: '收藏', desc: '自动同步我的收藏歌曲' },
  { key: 'plugins', label: '插件', desc: '自动同步已安装的插件配置' },
  { key: 'settings', label: '本地设置', desc: '自动同步播放设置、歌词设置、快捷键等偏好配置' },
];

function toggleUpload(key: keyof typeof settingsStore.settings.upload) {
  settingsStore.patchSettings({
    upload: {
      ...settingsStore.settings.upload,
      [key]: !settingsStore.settings.upload[key],
    },
  });
}
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
const formattedLastFavoritesSync = computed(() => {
  if (!playlistSync.lastFavoritesSyncTime.value) return null;
  const date = new Date(playlistSync.lastFavoritesSyncTime.value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});

const favoritesSyncSummary = computed(() => {
  const r = playlistSync.lastFavoritesSyncResult.value;
  if (!r) return null;
  const parts: string[] = [];
  if (r.uploadedSongs > 0) parts.push(`上传 ${r.uploadedSongs} 首`);
  if (r.downloadedSongs > 0) parts.push(`下载 ${r.downloadedSongs} 首`);
  if (r.errors.length > 0) parts.push(`${r.errors.length} 个错误`);
  return parts.length > 0 ? parts.join('，') : '无变更';
});

const favoritesSyncErrors = computed(() => {
  const r = playlistSync.lastFavoritesSyncResult.value;
  if (!r || r.errors.length === 0) return [];
  return r.errors;
});

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

// ==================== 手动覆盖同步：确认弹窗 ====================
// 手动按钮=强制覆盖（上传覆盖云端/下载覆盖本地），自动同步仍走对比合并。
type OverwriteAction =
  | 'playlist-upload' | 'playlist-download'
  | 'plugin-upload' | 'plugin-download'
  | 'settings-upload' | 'settings-download'
  | 'favorites-upload' | 'favorites-download';

const OVERWRITE_CONFIRM_TEXT: Record<OverwriteAction, { title: string; message: string }> = {
  'playlist-upload': { title: '覆盖上传歌单', message: '将用本地歌单全量覆盖云端，云端多出的歌单会被移除；本地歌单为空时云端歌单将被全部清空。确定继续吗？' },
  'playlist-download': { title: '覆盖下载歌单', message: '将用云端歌单全量覆盖本地，本地多出的歌单会被移除。确定继续吗？' },
  'plugin-upload': { title: '覆盖上传插件', message: '将用本地插件全量覆盖云端，云端多出的插件与订阅会被移除。确定继续吗？' },
  'plugin-download': { title: '覆盖下载插件', message: '将清空本地插件与订阅，并按云端内容重新安装。确定继续吗？' },
  'settings-upload': { title: '覆盖上传设置', message: '将用本地设置覆盖云端设置。确定继续吗？' },
  'settings-download': { title: '覆盖下载设置', message: '将用云端设置覆盖本地设置。确定继续吗？' },
  'favorites-upload': { title: '覆盖上传收藏', message: '将用本地收藏全量覆盖云端，云端多出的收藏会被移除。确定继续吗？' },
  'favorites-download': { title: '覆盖下载收藏', message: '将用云端收藏全量覆盖本地，本地多出的收藏会被移除。确定继续吗？' },
};

const showOverwriteConfirm = ref(false);
const pendingOverwriteAction = ref<OverwriteAction | null>(null);

function requestOverwrite(action: OverwriteAction) {
  pendingOverwriteAction.value = action;
  showOverwriteConfirm.value = true;
}

function confirmOverwrite() {
  const action = pendingOverwriteAction.value;
  showOverwriteConfirm.value = false;
  pendingOverwriteAction.value = null;
  if (!action) return;
  switch (action) {
    case 'playlist-upload':
      void playlistSync.uploadOnly({ overwrite: true });
      break;
    case 'playlist-download':
      void playlistSync.downloadOnly({ overwrite: true });
      break;
    case 'plugin-upload':
      void playlistSync.uploadPluginsOnly({ overwrite: true });
      break;
    case 'plugin-download':
      void playlistSync.downloadPluginsOnly({ overwrite: true });
      break;
    case 'settings-upload':
      void playlistSync.uploadSettingsOnly();
      break;
    case 'settings-download':
      void playlistSync.downloadSettingsOnly();
      break;
    case 'favorites-upload':
      void playlistSync.uploadFavoritesOnly({ overwrite: true });
      break;
    case 'favorites-download':
      void playlistSync.downloadFavoritesOnly({ overwrite: true });
      break;
  }
}
</script>

<template>
  <div class="w-full space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300"> 
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
                {{ authStore.user?.ciyuanxi_id ? `弦予号：${authStore.user.ciyuanxi_id}` : authStore.user?.email || '未设置' }}
              </template>
              <template v-else>登录后可同步个人资料到云端服务器</template> 
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            v-if="authStore.isLoggedIn" 
            type="button" 
            class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer"
            @click="handleChangePassword"
          >
            修改密码
          </button>
          <button
            v-if="authStore.isLoggedIn" 
            type="button" 
            class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer"
            @click="handleLogout" 
          >
            退出登录
          </button>
          <button
            v-if="authStore.isLoggedIn" 
            type="button" 
            class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer"
            @click="handleDeleteAccount"
          >
            注销账号
          </button>
        </div>
      </div>
    </section>

    <!-- 网盘绑定：从独立设置分类并入账号页（对齐移动端账号页布局） -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        {{ t('cloud.sectionTitle') }}
      </h2>
      <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.sectionDesc') }}</p>
      <SettingsCloud />
    </section>

    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          手动同步
        </span>
        <SettingHint text="手动将本地歌单、收藏、插件、设置同步到云端，或从云端拉取到本地。支持多设备间数据共享。" />
      </h2> 
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="manual-sync-head">
            <div class="upload-copy min-w-0">
              <div class="upload-label text-gray-900 dark:text-white/90">歌单</div>
              <div class="manual-sync-sub text-gray-500 dark:text-white/50 truncate">
                <span v-if="playlistSync.syncing.value">{{ playlistSync.syncProgress.value || '正在同步...' }}</span>
                <span v-else-if="syncSummary">上次：{{ syncSummary }}<template v-if="formattedLastSync"> · {{ formattedLastSync }}</template></span>
                <span v-else>未同步</span>
              </div>
              <div v-if="syncErrors.length > 0 && !playlistSync.syncing.value" class="sync-error-list">
                <div v-for="(err, idx) in syncErrors" :key="idx" class="sync-error-item">
                  {{ err }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button" 
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.syncing.value"
                @click="requestOverwrite('playlist-upload')"
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
                @click="requestOverwrite('playlist-download')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                更新至本地
              </button>
            </div> 
          </div> 
        </div> 
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
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button" 
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.pluginSyncing.value"
                @click="requestOverwrite('plugin-upload')"
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
                @click="requestOverwrite('plugin-download')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                更新至本地
              </button>
            </div> 
          </div> 
        </div> 
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
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button" 
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.settingsSyncing.value"
                @click="requestOverwrite('settings-upload')"
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
                @click="requestOverwrite('settings-download')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                更新至本地
              </button>
            </div>
          </div> 
        </div> 

        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="manual-sync-head">
            <div class="upload-copy min-w-0">
              <div class="upload-label text-gray-900 dark:text-white/90">收藏</div>
              <div class="manual-sync-sub text-gray-500 dark:text-white/50 truncate">
                <span v-if="playlistSync.favoritesSyncing.value">{{ playlistSync.favoritesSyncProgress.value || '正在同步...' }}</span>
                <span v-else-if="favoritesSyncSummary">上次：{{ favoritesSyncSummary }}<template v-if="formattedLastFavoritesSync"> · {{ formattedLastFavoritesSync }}</template></span>
                <span v-else>未同步</span>
              </div>
              <div v-if="favoritesSyncErrors.length > 0 && !playlistSync.favoritesSyncing.value" class="sync-error-list">
                <div v-for="(err, idx) in favoritesSyncErrors" :key="idx" class="sync-error-item">
                  {{ err }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button" 
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-3 h-8 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.favoritesSyncing.value"
                @click="requestOverwrite('favorites-upload')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                同步至服务器
              </button>
              <button
                type="button" 
                class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-3 h-8 rounded-full text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                :disabled="playlistSync.favoritesSyncing.value"
                @click="requestOverwrite('favorites-download')"
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

    <section v-if="authStore.isLoggedIn" class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          自动同步
        </span>
        <SettingHint text="按设定的时间自动同步数据到云端。当服务器繁忙时会自动延后并提示，避免带宽拥塞。" />
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="upload-label text-gray-900 dark:text-white/90">启用自动同步</div>
          <div class="flex items-center gap-3">
            <SettingHint text="开启后在指定时间自动执行同步" />
            <button
              type="button"
              class="glass-switch"
              :class="{ 'is-checked': settingsStore.settings.autoSync.enabled }"
              @click="toggleAutoSync()"
            ></button>
          </div>
        </div>
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
              class="glass-switch"
              :class="{ 'is-checked': settingsStore.settings.upload[item.key] }"
              @click="toggleUpload(item.key)"
            ></button>
          </div>
        </div>
        <template v-if="settingsStore.settings.autoSync.enabled">
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
          <div class="sync-notice p-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>自动同步将仅上传上方开启的同步内容；手动同步不受此限制。</span>
          </div>
          <div v-if="playlistSync.autoSyncStatus.value" class="sync-status p-4" :class="{ 'sync-status--active': playlistSync.autoSyncStatus.value.includes('正在'), 'sync-status--error': playlistSync.autoSyncDelayed.value }">
            <div v-if="playlistSync.autoSyncStatus.value.includes('正在')" class="sync-spinner"></div>
            <svg v-else-if="playlistSync.autoSyncDelayed.value" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="sync-status-text text-gray-900 dark:text-white/85">{{ playlistSync.autoSyncStatus.value }}</span>
          </div>
          <div v-if="nextSyncTimeDisplay" class="p-4 text-xs text-gray-500 dark:text-white/50">
            下次同步：{{ nextSyncTimeDisplay }}
          </div>
        </template>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          服务端设置
        </span>
        <SettingHint severity="warning" :text="`登录、注册、找回密码等接口的根地址和签名密钥。自建后端时，请在服务端后台仪表盘复制服务器 API 与 API 签名密钥后填入。默认地址：${DEFAULT_AUTH_BASE_URL}`" />
      </h2>
      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-gray-500 dark:text-white/50">服务器 API</span>
          <input
            v-model="draftBaseUrl"
            type="text"
            placeholder="https://example.com/api"
            spellcheck="false"
            class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-gray-500 dark:text-white/50">服务器密钥</span>
          <div class="relative" @focusin="pwdFocused.apiSecret = true" @focusout="pwdFocused.apiSecret = false; pwdVisible.apiSecret = false">
            <input
              v-model="draftApiSecret"
              :type="pwdVisible.apiSecret ? 'text' : 'password'"
              placeholder="API 签名密钥"
              spellcheck="false"
              autocomplete="off"
              class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 pr-9 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
            />
            <button
              type="button"
              v-show="pwdFocused.apiSecret && draftApiSecret.length > 0"
              class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
              :aria-label="pwdVisible.apiSecret ? '隐藏密码' : '查看密码'"
              @mousedown.prevent
              @click="pwdVisible.apiSecret = !pwdVisible.apiSecret"
            >
              <EyeOff v-if="pwdVisible.apiSecret" class="h-4 w-4" />
              <Eye v-else class="h-4 w-4" />
            </button>
          </div>
        </label>
      </div>
      <div class="flex items-stretch gap-2 flex-wrap">
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

    <!-- 手动覆盖同步确认弹窗（复用插件三合一弹窗壳） -->
    <PluginConfirmDialog
      :visible="showOverwriteConfirm"
      :title="pendingOverwriteAction ? OVERWRITE_CONFIRM_TEXT[pendingOverwriteAction].title : ''"
      confirm-text="确认覆盖"
      overlay-z-class="z-[200]"
      @cancel="showOverwriteConfirm = false"
      @confirm="confirmOverwrite"
    >
      {{ pendingOverwriteAction ? OVERWRITE_CONFIRM_TEXT[pendingOverwriteAction].message : '' }}
    </PluginConfirmDialog>
  </div>
</template>

<style scoped> /* 样式 */
.manual-sync-head {
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.manual-sync-head > .upload-copy {
  flex: 1 1 0%;
  min-width: 0; /* 样式 */
}

.manual-sync-sub {
  font-size: 0.72rem; /* 样式 */
  line-height: 1.4; /* 样式 */
  margin-top: 2px;
}

.manual-sync-tip {
  font-size: 0.7rem;
  color: rgba(236, 65, 65, 0.7);
  margin-top: 4px;
}

.upload-copy { /* 样式 */
  min-width: 0; /* 样式 */
}

.upload-label { /* 样式 */
  font-size: 0.875rem; /* 样式 */
  font-weight: 600; /* 样式 */
  margin-bottom: 2px; /* 样式 */
}

.upload-desc { /* 样式 */
  font-size: 0.72rem; /* 样式 */
  line-height: 1.4; /* 样式 */
}

.upload-switch { /* 样式 */
  position: relative; /* 样式 */
  width: 44px;
  height: 24px;
  border-radius: 9999px; /* 样式 */
  background: rgba(0, 0, 0, 0.25); /* 样式 */
  border: none; /* 样式 */
  cursor: pointer; /* 样式 */
  flex-shrink: 0; /* 样式 */
  padding: 0;
  transition: background 0.25s ease; /* 样式 */
}

.upload-switch.is-on { /* 样式 */
  background: #EC4141; /* 样式 */
}

.upload-switch-thumb { /* 样式 */
  position: absolute; /* 样式 */
  top: 4px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 9999px; /* 样式 */
  background: #ffffff; /* 样式 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); /* 样式 */
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); /* 样式 */
}

.upload-switch.is-on .upload-switch-thumb { /* 样式 */
  transform: translateX(24px);
}

.sync-status { /* 样式 */
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 8px; /* 样式 */
} /* 样式 */
.sync-status--active { /* 样式 */
} /* 样式 */
.sync-status-text { /* 样式 */
  font-size: 0.78rem; /* 样式 */
  line-height: 1.4; /* 样式 */
} /* 样式 */
.sync-status-time { /* 样式 */
  font-size: 0.68rem; /* 样式 */
  margin-top: 2px; /* 样式 */
} /* 样式 */
.sync-status--error { /* 样式 */
} /* 样式 */
.sync-error-list { /* 样式 */
  margin-top: 6px; /* 样式 */
  display: flex; /* 样式 */
  flex-direction: column; /* 样式 */
  gap: 3px; /* 样式 */
} /* 样式 */
.sync-error-item { /* 样式 */
  font-size: 0.68rem; /* 样式 */
  color: #dc2626; /* 样式 */
  line-height: 1.4; /* 样式 */
  word-break: break-all; /* 样式 */
} /* 样式 */
.sync-spinner { /* 样式 */
  width: 14px; /* 样式 */
  height: 14px; /* 样式 */
  border: 2px solid rgba(236, 65, 65, 0.2); /* 样式 */
  border-top-color: #EC4141; /* 样式 */
  border-radius: 50%; /* 样式 */
  animation: sync-spin 0.6s linear infinite; /* 样式 */
  flex-shrink: 0; /* 样式 */
} /* 样式 */
@keyframes sync-spin { /* 样式 */
  to { transform: rotate(360deg); } /* 样式 */
} /* 样式 */
.sync-notice { /* 样式 */
  display: flex; /* 样式 */
  align-items: flex-start; /* 样式 */
  gap: 8px; /* 样式 */
  color: #92400e; /* 样式 */
  font-size: 0.72rem; /* 样式 */
  line-height: 1.5; /* 样式 */
} /* 样式 */
.logout-confirm-card { /* 样式 */
  width: min(86vw, 360px); /* 样式 */
  background: rgba(255, 255, 255, 0.8);
  color: #1f2937; /* 样式 */
  border-radius: 16px; /* 样式 */
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08); /* 样式 */
  padding: 24px 22px 20px; /* 样式 */
  text-align: center; /* 样式 */
  border: 1px solid rgba(0, 0, 0, 0.06); /* 样式 */
}

.logout-confirm-icon { /* 样式 */
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: center; /* 样式 */
  width: 48px; /* 样式 */
  height: 48px; /* 样式 */
  border-radius: 999px; /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
  color: #EC4141; /* 样式 */
  margin: 0 auto 14px; /* 样式 */
}

.logout-confirm-title { /* 样式 */
  font-size: 1.05rem; /* 样式 */
  font-weight: 700; /* 样式 */
  color: #1f2937; /* 样式 */
  margin: 0 0 8px; /* 样式 */
}

.logout-confirm-desc { /* 样式 */
  font-size: 0.85rem; /* 样式 */
  line-height: 1.55; /* 样式 */
  color: rgba(75, 85, 99, 0.9); /* 样式 */
  margin: 0 0 20px; /* 样式 */
}

.logout-confirm-actions { /* 样式 */
  display: flex; /* 样式 */
  gap: 10px;
  justify-content: center; /* 样式 */
}

.logout-btn { /* 样式 */
  flex: 1;
  height: 38px; /* 样式 */
  border-radius: 999px; /* 样式 */
  font-size: 0.85rem; /* 样式 */
  font-weight: 600; /* 样式 */
  cursor: pointer; /* 样式 */
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease; /* 样式 */
  border: 1px solid transparent; /* 样式 */
}

.logout-btn--ghost { /* 样式 */
  border-color: rgba(148, 163, 184, 0.24); /* 样式 */
  background: transparent; /* 样式 */
  color: rgba(100, 116, 139, 0.9); /* 样式 */
}

.logout-btn--ghost:hover { /* 样式 */
  background: rgba(15, 23, 42, 0.04); /* 样式 */
  color: rgb(31 41 55); /* 样式 */
}

.logout-btn--danger { /* 样式 */
  background: #EC4141; /* 样式 */
  color: #ffffff; /* 样式 */
}

.logout-btn--danger:hover { /* 样式 */
  background: #d13b3b; /* 样式 */
}

.logout-modal-enter-active, /* 样式 */
.logout-modal-leave-active { /* 样式 */
  transition: opacity 0.2s ease; /* 样式 */
}

.logout-modal-enter-active .logout-confirm-card, /* 样式 */
.logout-modal-leave-active .logout-confirm-card { /* 样式 */
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); /* 样式 */
}

.logout-modal-enter-from, /* 样式 */
.logout-modal-leave-to { /* 样式 */
  opacity: 0;
}

.logout-modal-enter-from .logout-confirm-card, /* 样式 */
.logout-modal-leave-to .logout-confirm-card { /* 样式 */
  opacity: 0;
  transform: scale(0.92) translateY(8px); /* 样式 */
}

</style>

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
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92); /* 样式 */
  border-color: rgba(255, 255, 255, 0.08); /* 样式 */
}

html.dark .logout-confirm-icon {
  background: rgba(236, 65, 65, 0.18); /* 样式 */
  color: #ff8b8b; /* 样式 */
}

html.dark .logout-confirm-title {
  color: rgba(255, 255, 255, 0.96); /* 样式 */
}

html.dark .logout-confirm-desc {
  color: rgba(255, 255, 255, 0.6); /* 样式 */
}

html.dark .logout-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12); /* 样式 */
  color: rgba(255, 255, 255, 0.7); /* 样式 */
}

html.dark .logout-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06); /* 样式 */
  color: rgba(255, 255, 255, 0.96); /* 样式 */
}
</style>
