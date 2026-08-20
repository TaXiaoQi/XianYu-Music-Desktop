<script setup lang="ts">
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useOnboarding } from '../../composables/useOnboarding';
import { showSettingsConflict } from '../../composables/useSettingsConflict';
import { useAnnouncement } from '../../composables/useAnnouncement';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { showProfileLimitDialog } from '../../composables/useProfileLimitDialog';
import { showBanDialog, showSessionExpiredDialog } from '../../composables/useBanDialog';
import { showCiyuanxiDialog } from '../../composables/useCiyuanxiDialog';
import { useAuthStore } from '../../features/auth/store';
import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { resolveOnlineQualityUrl, isDownloadableOnlineSong } from '../../services/downloadService';
import type { QualityKey, Song, OnlineQualityFallbackBehavior } from '../../types';
import { ref } from 'vue';

const authStore = useAuthStore();
const playbackStore = usePlaybackStore();
const settingsStore = useSettingsStore();

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
  </div>
</template>
