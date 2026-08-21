<script setup lang="ts">
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useOnboarding } from '../../composables/useOnboarding';
import { showSettingsConflict } from '../../composables/useSettingsConflict';
import { useAnnouncement } from '../../composables/useAnnouncement';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { showProfileLimitDialog } from '../../composables/useProfileLimitDialog';
import { showBanDialog, showSessionExpiredDialog } from '../../composables/useBanDialog';
import { showCiyuanxiDialog } from '../../composables/useCiyuanxiDialog';
import { showChangePasswordDialog } from '../../composables/useChangePasswordDialog';
import { showDeleteAccountDialog } from '../../composables/useDeleteAccountDialog';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { useDownloadDialog } from '../../composables/useDownloadDialog';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { useToast } from '../../composables/toast';
import { useCollectionsStore } from '../../features/collections/store';
import { useAuthStore } from '../../features/auth/store';
import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { resolveOnlineQualityUrl, isDownloadableOnlineSong } from '../../services/downloadService';
import type { QualityKey, Song, OnlineQualityFallbackBehavior } from '../../types';
import { ref } from 'vue';
import ModernModal from '../common/ModernModal.vue';
import ModernInputModal from '../common/ModernInputModal.vue';
import HumanCaptchaModal from '../common/HumanCaptchaModal.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import ExportBackupDialog from '../settings/ExportBackupDialog.vue';
import MoveToFolderModal from '../overlays/MoveToFolderModal.vue';
import LyricsReplacementModal from '../overlays/LyricsReplacementModal.vue';
import PlaylistModal from '../overlays/PlaylistModal.vue';
import PlaylistEditInfoModal from '../overlays/PlaylistEditInfoModal.vue';
import AppBackupResultModal from '../settings/AppBackupResultModal.vue';
import BackupImportResultModal from '../settings/BackupImportResultModal.vue';
import type { AppBackupImportResult } from '../../services/appBackup';
import type { PreparedPluginBackupImport } from '../../services/pluginBackupImport';

const authStore = useAuthStore();
const playbackStore = usePlaybackStore();
const settingsStore = useSettingsStore();
const collectionsStore = useCollectionsStore();
const { showToast } = useToast();
const { openSongInfo } = useSongInfoDialog();
const { openDownloadDialog } = useDownloadDialog();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

/** 构造一个假的在线歌曲，用于触发需要 song 参数的弹窗调试 */
function makeFakeOnlineSong(): Song {
  return {
    name: '测试歌曲',
    title: '测试歌曲',
    path: 'plugin://demo/测试歌曲',
    artist: '测试歌手',
    artist_names: ['测试歌手'],
    effective_artist_names: ['测试歌手'],
    album: '测试专辑',
    album_artist: '测试歌手',
    album_key: 'demo-album',
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: 240,
    source_type: 'plugin',
    plugin_id: 'mf_demo',
  };
}
const fakeSong = makeFakeOnlineSong();

/** 组件式弹窗（普通弹窗组件）：本地可见性状态 */
const showModernModal = ref(false);
const showModernInputModal = ref(false);
const showCaptchaModal = ref(false);
const showConfirmModal = ref(false);
const showExportDialog = ref(false);
const showMoveToFolderModal = ref(false);
const showLyricsReplacementModal = ref(false);
const showPlaylistModal = ref(false);
const showPlaylistEditModal = ref(false);
const showAppBackupResultModal = ref(false);
const showBackupImportResultModal = ref(false);

/** 应用备份导入结果（假数据，供调试展示） */
const fakeAppBackupResult: AppBackupImportResult = {
  summary: {
    playlistCount: 2,
    localPlaylistCount: 1,
    onlinePlaylistCount: 1,
    mixedPlaylistCount: 0,
    totalSongs: 26,
    localSongs: 12,
    onlineSongs: 14,
    favoriteCount: 5,
    pluginCount: 3,
    hasSettings: true,
  },
  importedPlaylists: 2,
  importedFavorites: 5,
  importedPlugins: 3,
  skippedPlugins: 1,
  settingsApplied: true,
  errors: [],
};

/** 插件备份导入结果（假数据，供调试展示） */
const fakePluginBackupResult: PreparedPluginBackupImport = {
  format: 'lxmusic',
  sourcePlaylistCount: 2,
  totalSongCount: 12,
  importedSongCount: 9,
  playlists: [],
  failures: [
    {
      playlist: '收藏',
      title: '无法导入的歌曲',
      artist: '测试歌手',
      platform: 'QQ音乐',
      reason: '缺少对应插件',
      reasonCode: 'missing-plugin',
    },
  ],
  associations: [
    {
      pluginId: 'mf_demo',
      pluginName: '测试插件',
      pluginFormat: 'lx',
      enabled: true,
      platform: 'QQ音乐',
      songCount: 8,
    },
  ],
  missingPlugins: [
    { platform: '网易云', songCount: 2 },
  ],
  backupVersion: null,
  migratedTrackIds: false,
  migratedTrackIdCount: 0,
};

const qualityProbe = ref('');
const qualityProbing = ref(false);

const LOSSESS_QUALITIES: ReadonlySet<string> = new Set([
  'flac', 'flac24bit', 'hires', 'vinyl', 'master',
]);

function detectContainer(buf: Uint8Array): string {
  const head = new TextDecoder().decode(buf.slice(0, 12));
  if (head.startsWith('fLaC')) return 'FLAC';
  if (head.startsWith('OggS')) return 'Ogg/Opus';
  if (head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2))) return 'MP3';
  if (head.startsWith('RIFF')) return (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WAVE') ? 'WAV' : 'RIFF(WAV/AVI)';
  if (head.startsWith('FORM')) return 'AIFF';
  if (head.slice(4, 8) === 'ftyp') {
    return head.slice(8, 12).includes('M4A') ? 'M4A' : 'MP4/MOV';
  }
  if (head.startsWith('DSD ')) return 'DSF';
  return `未知(前12字节 ${Array.from(buf.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')})`;
}

async function probeContainer(url: string, headers: Record<string, string> | null | undefined): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-262143', ...(headers ?? {}) },
    });
    if (!res.ok && res.status !== 206) {
      return `探测请求失败(HTTP ${res.status})`;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    return `${detectContainer(buf)}${ct ? ` (Content-Type: ${ct})` : ''}`;
  } catch (err) {
    return `探测请求被拦截(${err instanceof Error ? err.message : String(err)})`;
  }
}

async function verifyCurrentSongQuality() {
  const song = playbackStore.currentSong as Song | null;
  if (!song) {
    qualityProbe.value = '没有正在播放的歌曲。';
    return;
  }
  if (!isDownloadableOnlineSong(song)) {
    qualityProbe.value = `当前歌曲不是在线歌曲：${song.title || song.path}`;
    return;
  }

  qualityProbing.value = true;
  qualityProbe.value = '';
  try {
    const requested = (playbackStore.sessionQualityOverride
      || settingsStore.settings.audio.onlineDefaultQuality || '320k') as QualityKey;
    const fallback = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';
    const lines: string[] = [`歌曲: ${song.title || song.name}`, `请求档位: ${requested}`, `回退行为: ${fallback}`, ''];

    const resolved = await resolveOnlineQualityUrl(
      song,
      requested,
      fallback as OnlineQualityFallbackBehavior,
      null,
    );
    if (!resolved) {
      lines.push('解析失败：未拿到任何可播放直链。');
      qualityProbe.value = lines.join('\n');
      return;
    }

    lines.push(`解析命中档位: ${resolved.quality}`);
    lines.push(`直链: ${resolved.url}`);
    const sniff = await probeContainer(resolved.url, resolved.headers);
    lines.push(`实际编码探测: ${sniff}`);

    const promisedLossless = LOSSESS_QUALITIES.has(resolved.quality);
    const sniffedLossy = /MP3|M4A|\/MP4|\/Ogg|\/AA?C/i.test(sniff);
    if (promisedLossless && sniffedLossy) {
      lines.push('⚠ 无损档位实际返回了有损编码 → 存在静默降级。');
    } else if (promisedLossless && /FLAC|WAV|AIFF|DSF/.test(sniff)) {
      lines.push('✓ 无损档位，实测为无损编码，正常。');
    } else {
      lines.push(`（档位=${resolved.quality}，期望与实测编码一致，无降级）`);
    }
    qualityProbe.value = lines.join('\n');
  } catch (err) {
    qualityProbe.value = `探测出错：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    qualityProbing.value = false;
  }
}

const { disableDeveloperMode } = useDeveloperMode();
const { triggerOnboarding } = useOnboarding();
const { simulateAnnouncement } = useAnnouncement();
const { simulateUpdate } = useUpdateCheck();

function testConflictDialog() {
  void showSettingsConflict(new Date().toISOString());
}

function testNicknameLimitDialog() {
  void showProfileLimitDialog('nickname');
}

function testAvatarLimitDialog() {
  void showProfileLimitDialog('avatar');
}

function testBanAccountDialog() {
  void showBanDialog('account', '涉嫌违规使用，已被管理员封禁。如有疑问请联系管理员。');
}

function testBanDeviceDialog() {
  void showBanDialog('device', '该设备已被封禁，不支持在该设备上继续使用。如有疑问请联系管理员。');
}

function testSessionExpiredDialog() {
  void showSessionExpiredDialog('登录状态已失效，请重新登录账号以继续使用。');
}

function testAppealDialog() {
  // 调试模式：仅测试申诉页面与流程，不发送服务器
  void showBanDialog(
    'account',
    '涉嫌违规使用，已被管理员封禁。如有疑问请联系管理员。',
    { ciyuanxiId: 'CN00000001', nickname: '测试用户' },
    { debug: true },
  );
}

function testCiyuanxiDialog() {
  // 调试模式：仅测试修改弦予号弹窗与流程，不发送服务器
  void showCiyuanxiDialog(
    authStore.user?.ciyuanxi_id || authStore.user?.username || 'CN00000001',
    { debug: true },
  );
}

function testToastSuccess() {
  showToast('这是一条成功的提示消息', 'success');
}
function testToastError() {
  showToast('这是一条失败的提示消息', 'error');
}
function testToastInfo() {
  showToast('这是一条普通提示消息', 'info');
}

function testChangePasswordDialog() {
  void showChangePasswordDialog();
}

function testDeleteAccountDialog() {
  void showDeleteAccountDialog();
}

function testSongInfoDialog() {
  openSongInfo(fakeSong, 'default');
}

function testDownloadDialog() {
  openDownloadDialog(fakeSong);
}

function testAddToPlaylistDialog() {
  openAddToPlaylistDialog(fakeSong.path);
}

function testPlaylistEditDialog() {
  showPlaylistEditModal.value = true;
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        调试
      </h2>
    </div>

    <section class="overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">开发者模式</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-[#EC4141] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#d83b3b] active:scale-95"
          @click="disableDeveloperMode"
        >
          退出开发者模式
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">播放初始化动画</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="triggerOnboarding"
        >
          播放
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">设置同步冲突弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试云端设置冲突时的选择弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testConflictDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">改名提示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试昵称每日修改限制和审核提示弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testNicknameLimitDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">头像提示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试头像每日修改限制和审核提示弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testAvatarLimitDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">账号封禁提示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试账号被封禁时的踢下线提示弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testBanAccountDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">设备封禁提示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试设备被封禁时的踢下线提示弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testBanDeviceDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">登录过期提示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试登录态失效时的重新登录提示弹窗（确认/去登录）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testSessionExpiredDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">申诉页面模拟</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试封禁申诉流程与页面，提交申诉不会发送到服务器</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testAppealDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">修改弦予号弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试修改弦予号弹窗与流程，确认修改不会发送到服务器</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testCiyuanxiDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">公告展示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试公告弹窗显示</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="simulateAnnouncement"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">更新提示框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试更新弹窗显示，点击「立即更新」可模拟下载进度动画</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="simulateUpdate"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">全局消息提示</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试成功 / 失败 / 普通三种类型的底部消息提示</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-3 py-2 text-xs font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
            @click="testToastSuccess"
          >
            成功
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-3 py-2 text-xs font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
            @click="testToastError"
          >
            失败
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-3 py-2 text-xs font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
            @click="testToastInfo"
          >
            普通
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">修改密码弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试统一样式的修改密码弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testChangePasswordDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">注销账号弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试统一样式的注销账号确认弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testDeleteAccountDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">歌曲信息弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试歌曲信息/歌词/封面查看弹窗（假歌曲数据）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testSongInfoDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">下载弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试下载歌曲的音质与内容选择弹窗（假歌曲数据）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testDownloadDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">添加到歌单弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试选择歌单并添加歌曲的弹窗（假歌曲路径）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testAddToPlaylistDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">通用确认弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试 ModernModal 通用确认弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showModernModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">通用输入弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试 ModernInputModal 通用输入弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showModernInputModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">人机验证弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试登录相关的人机验证弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showCaptchaModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">简单确认框</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试 ConfirmModal 简单确认框</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showConfirmModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">导出备份选择弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试选择导出内容（设置/歌单/插件/收藏）的弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showExportDialog = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">移动到文件夹弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试批量移动歌曲到文件夹的弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showMoveToFolderModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词替换弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试从插件/本地替换歌词的弹窗（假歌曲数据）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showLyricsReplacementModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">新建/导入歌单弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试新建与从云端/本地导入歌单的弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showPlaylistModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">编辑歌单信息弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试编辑歌单名称与封面的弹窗</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="testPlaylistEditDialog"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">备份导入结果弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试应用备份导入结果展示（假数据）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showAppBackupResultModal = true"
        >
          弹出
        </button>
      </div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">插件备份导入结果弹窗</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">测试插件备份（BakaMusic/MusicFree）导入结果展示（假数据）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white/30 active:scale-95 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="showBackupImportResultModal = true"
        >
          弹出
        </button>
      </div>
    </section>

    <section class="overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">验证当前歌曲实际音质</p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-white/45">与播放走同一链路解析在线直链，并下载前256KB探测真实编码</p>
        </div>
        <button
          type="button"
          :disabled="qualityProbing"
          class="shrink-0 rounded-lg bg-[#EC4141] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#d83b3b] active:scale-95 disabled:opacity-50"
          @click="verifyCurrentSongQuality"
        >
          {{ qualityProbing ? '解析中…' : '验证' }}
        </button>
      </div>
      <pre
        v-if="qualityProbe"
        class="mx-5 mb-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed text-gray-700 dark:bg-white/5 dark:text-gray-200"
      >{{ qualityProbe }}</pre>
    </section>

    <!-- 弹窗组件挂载（仅用于调试触发） -->
    <ModernModal
      :visible="showModernModal"
      title="通用确认弹窗"
      content="这是 ModernModal 通用确认弹窗的调试内容，用于验证弹窗样式与交互。"
      confirm-text="确认"
      cancel-text="取消"
      @update:visible="showModernModal = $event"
    />
    <ModernInputModal
      :visible="showModernInputModal"
      title="通用输入弹窗"
      placeholder="请输入内容"
      initial-value="调试初始值"
      confirm-text="确定"
      cancel-text="取消"
      @update:visible="showModernInputModal = $event"
    />
    <HumanCaptchaModal
      :open="showCaptchaModal"
      @cancel="showCaptchaModal = false"
      @verified="showCaptchaModal = false"
    />
    <ConfirmModal
      :visible="showConfirmModal"
      title="确认操作"
      content="确定要执行这个调试操作吗？此弹窗仅用于验证确认框样式。"
      @confirm="showConfirmModal = false"
      @cancel="showConfirmModal = false"
    />
    <ExportBackupDialog
      :visible="showExportDialog"
      @close="showExportDialog = false"
      @confirm="showExportDialog = false"
    />
    <MoveToFolderModal
      :visible="showMoveToFolderModal"
      :selected-count="3"
      @close="showMoveToFolderModal = false"
      @confirm="showMoveToFolderModal = false"
    />
    <LyricsReplacementModal
      :visible="showLyricsReplacementModal"
      :song="fakeSong"
      @close="showLyricsReplacementModal = false"
    />
    <PlaylistModal
      :visible="showPlaylistModal"
      :playlists="collectionsStore.playlists"
      @update:visible="showPlaylistModal = $event"
    />
    <PlaylistEditInfoModal
      :visible="showPlaylistEditModal"
      playlist-id="demo-playlist-id"
      initial-name="测试歌单"
      @update:visible="showPlaylistEditModal = $event"
    />
    <AppBackupResultModal
      :visible="showAppBackupResultModal"
      :result="fakeAppBackupResult"
      @close="showAppBackupResultModal = false"
    />
    <BackupImportResultModal
      :visible="showBackupImportResultModal"
      :result="fakePluginBackupResult"
      :created-playlist-count="2"
      @close="showBackupImportResultModal = false"
    />
  </div>
</template>
