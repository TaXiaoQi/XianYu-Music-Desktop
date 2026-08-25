<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_VERSION } from '../../../version';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { useToast } from '../../composables/toast';
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useI18n } from '../../features/i18n';
import { aboutConfig, startAboutConfigPolling, stopAboutConfigPolling } from '../../utils/aboutConfig';

const appVersion = APP_VERSION;
const DEVELOPER_MODE_CLICK_COUNT = 5;
const DEVELOPER_MODE_CLICK_INTERVAL = 1500;
const developerModeClickCount = ref(0);
let lastDeveloperModeClickAt = 0;

const { isDeveloperMode, enableDeveloperMode } = useDeveloperMode();
const { showToast } = useToast();
const { isEnglish } = useI18n();
const buttonText = computed(() => isEnglish.value ? {
  update: 'Check for Updates',
  checking: 'Checking...',
  officialSite: 'Official Website',
  joinGroup: 'Join Community',
  project: 'Source Code',
  referenceProject: 'Reference Project',
} : {
  update: aboutConfig.value.updateText,
  checking: '检查中...',
  officialSite: aboutConfig.value.officialSiteText,
  joinGroup: aboutConfig.value.joinGroupText,
  project: aboutConfig.value.projectText,
  referenceProject: aboutConfig.value.referenceProjectText,
});

/** 兼容缺少协议头的链接（如 "xianyumusic.cn"），自动补全为 https://，确保能正常在外部浏览器打开 */
function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** 在系统默认外部浏览器中打开链接，避免 Tauri webview 内 target=_blank 导航导致 Vue 崩溃 */
async function openExternal(url: string) {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return;
  try {
    await openUrl(normalized);
  } catch (error) {
    // 记录真实错误，便于排查 command 未注册 / 权限不足等问题
    console.error('[openExternal] openUrl 失败，尝试 fallback', normalized, error);
    window.open(normalized, '_blank', 'noopener,noreferrer');
  }
}

function handleDeveloperModeClick() {
  if (isDeveloperMode.value) return;

  const now = Date.now();
  if (now - lastDeveloperModeClickAt > DEVELOPER_MODE_CLICK_INTERVAL) {
    developerModeClickCount.value = 0;
  }
  lastDeveloperModeClickAt = now;
  developerModeClickCount.value += 1;

  if (developerModeClickCount.value >= DEVELOPER_MODE_CLICK_COUNT) {
    developerModeClickCount.value = 0;
    enableDeveloperMode();
    showToast(isEnglish.value ? 'Developer mode enabled' : '已进入开发者模式', 'success');
  }
}

// 检查更新走 Rust 服务端统一 API，由全局 useUpdateCheck 单例管理弹窗
const { isCheckingUpdate, checkUpdateManual } = useUpdateCheck();

onMounted(() => {
  // 启动关于页配置轮询，服务器下发新网址后客户端即时更新
  startAboutConfigPolling();
});

onUnmounted(() => {
  stopAboutConfigPolling();
});
</script>

<template>
  <div class="flex min-h-full min-w-0 flex-col items-center pb-8">
    <div class="flex w-full flex-1 flex-col items-center justify-center gap-7 py-5">
      <div class="flex min-w-0 flex-col items-center gap-4 text-center">
      <div class="flex items-center justify-center">
        <img
          src="/logo.png"
          alt="Logo"
          class="h-32 w-32 object-contain dark:invert"
        />
      </div>

      <div class="space-y-1">
        <h1 class="text-2xl font-bold tracking-tight text-gray-800 dark:text-white">弦予音乐</h1>
        <p class="text-sm font-medium text-gray-600 dark:text-white/60">v{{ appVersion }}</p>
      </div>

      <p
        class="max-w-sm select-none text-sm text-gray-600 dark:text-gray-300"
        @click="handleDeveloperModeClick"
      >
        将音乐给予你
      </p>
    </div>

    <div class="flex max-w-full flex-col items-center gap-2.5">
      <div class="flex max-w-full flex-wrap items-center justify-center gap-2.5">
      <button
        v-if="aboutConfig.updateEnabled"
        type="button"
        :disabled="isCheckingUpdate"
        @click="checkUpdateManual"
        class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#EC4141] px-4 py-2 text-sm font-medium text-white shadow-lg shadow-red-500/20 transition active:scale-95 hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-70"
      >
        <svg v-if="isCheckingUpdate" class="h-3.5 w-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 0-2 0v2H7a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V7Z" clip-rule="evenodd" /></svg>
        {{ isCheckingUpdate ? buttonText.checking : buttonText.update }}
      </button>

      <button
        v-if="aboutConfig.officialSiteUrl"
        type="button"
        @click="openExternal(aboutConfig.officialSiteUrl)"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border-0 bg-[#EC4141] px-4 py-2 text-sm font-medium text-white no-underline shadow-lg shadow-red-500/20 transition active:scale-95 hover:bg-[#d13a3a]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
        </svg>
        {{ buttonText.officialSite }}
      </button>

      <button
        v-if="aboutConfig.joinGroupUrl"
        type="button"
        @click="openExternal(aboutConfig.joinGroupUrl)"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border-0 bg-[#EC4141] px-4 py-2 text-sm font-medium text-white no-underline shadow-lg shadow-red-500/20 transition active:scale-95 hover:bg-[#d13a3a]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {{ buttonText.joinGroup }}
      </button>
      </div>

      <div class="flex max-w-full flex-wrap items-center justify-center gap-2.5">
      <button
        v-if="aboutConfig.projectUrl"
        type="button"
        @click="openExternal(aboutConfig.projectUrl)"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200/40 bg-white/20 backdrop-blur-md px-4 py-2 text-sm font-medium text-gray-800 no-underline transition active:scale-95 shadow-sm hover:bg-white/30 hover:border-[#EC4141]/35 dark:bg-black/10 dark:border-gray-800/40 dark:text-white dark:hover:bg-white/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
        {{ buttonText.project }}
      </button>

      <button
        v-if="aboutConfig.referenceProjectUrl"
        type="button"
        @click="openExternal(aboutConfig.referenceProjectUrl)"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200/40 bg-white/20 backdrop-blur-md px-4 py-2 text-sm font-medium text-gray-800 no-underline transition active:scale-95 shadow-sm hover:bg-white/30 hover:border-[#EC4141]/35 dark:bg-black/10 dark:border-gray-800/40 dark:text-white dark:hover:bg-white/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
        {{ buttonText.referenceProject }}
      </button>
      </div>
    </div>
    </div>

    <div class="mt-auto max-w-full shrink-0 space-y-1.5 pt-5 text-center text-xs leading-relaxed text-gray-400 dark:text-white/40">
      <div class="flex flex-wrap items-center justify-center gap-x-1">
        <span>开发者名单（排名不分先后）：</span><a href="https://github.com/ShenYichenCN" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-white/60 transition-colors">@ShenYichenCN</a> <a href="https://github.com/TaXiaoQi" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-white/60 transition-colors">@TaXiaoQi</a> <a href="https://github.com/88541" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-white/60 transition-colors">@知难辞</a> <a href="https://github.com/kaishui-server" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-white/60 transition-colors">@绛狐</a>
      </div>
      <div>
        Copyright © 2026 XY-Music-Desktop Developer. Licensed under AGPL-3.0-only.
      </div>
    </div>
  </div>
</template>
