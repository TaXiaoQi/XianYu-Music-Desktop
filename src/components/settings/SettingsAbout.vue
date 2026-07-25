<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import ModernModal from '../common/ModernModal.vue';
import { compareVersions, fetchLatestRelease } from '../../utils/update';

const REPO_OWNER = 'TaXiaoQi';
const REPO_NAME = 'XY-Music-Desktop';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const RELEASES_URL = `${REPO_URL}/releases`;

const appVersion = ref('');
const isCheckingUpdate = ref(false);

const dialogVisible = ref(false);
const dialogTitle = ref('');
const dialogContent = ref('');
const dialogConfirmText = ref('确定');
const dialogCancelText = ref('取消');
const dialogAction = ref<'close' | 'open-release'>('close');
const dialogOpenUrl = ref(RELEASES_URL);

async function loadAppVersion() {
  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('Failed to get version:', error);
    appVersion.value = 'Unknown';
  }
}

function showDialog(options: {
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
  action?: 'close' | 'open-release';
}) {
  dialogTitle.value = options.title;
  dialogContent.value = options.content;
  dialogConfirmText.value = options.confirmText;
  dialogCancelText.value = options.cancelText;
  dialogAction.value = options.action ?? 'close';
  dialogOpenUrl.value = RELEASES_URL;
  dialogVisible.value = true;
}

function formatPublishedDate(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

async function handleCheckUpdate() {
  if (isCheckingUpdate.value) {
    return;
  }

  isCheckingUpdate.value = true;

  try {
    if (!appVersion.value) {
      await loadAppVersion();
    }

    const latestRelease = await fetchLatestRelease(REPO_OWNER, REPO_NAME);

    const comparison = compareVersions(latestRelease.version, appVersion.value);
    const publishedDate = formatPublishedDate(latestRelease.publishedAt);

    if (comparison > 0) {
      const publishedText = publishedDate ? `；发布时间：${publishedDate}` : '';

      showDialog({
        title: '发现新版本',
        content: `当前版本：v${appVersion.value}；GitHub 最新版本：v${latestRelease.version}${publishedText}。是否前往下载页面？`,
        confirmText: '前往下载',
        cancelText: '稍后',
        action: 'open-release'
      });
      dialogOpenUrl.value = latestRelease.url;
      return;
    }

    if (comparison < 0) {
      showDialog({
        title: '当前版本较新',
        content: `当前版本 v${appVersion.value} 高于 GitHub 最新发布版本 v${latestRelease.version}。你现在大概率运行的是测试版或未发布版本。`,
        confirmText: '知道了',
        cancelText: '关闭'
      });
      return;
    }

    showDialog({
      title: '已是最新版本',
      content: `当前版本 v${appVersion.value} 已是 GitHub 最新版本。`,
      confirmText: '知道了',
      cancelText: '关闭'
    });
  } catch (error) {
    console.error('Failed to check updates:', error);
    showDialog({
      title: '检查更新失败',
      content: '无法连接到官网更新接口或 GitHub Releases。请确认网络可用，或稍后再试。',
      confirmText: '知道了',
      cancelText: '关闭'
    });
  } finally {
    isCheckingUpdate.value = false;
  }
}

async function handleDialogConfirm() {
  dialogVisible.value = false;

  if (dialogAction.value === 'open-release') {
    await openUrl(dialogOpenUrl.value);
  }
}

onMounted(() => {
  void loadAppVersion();
});
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center space-y-8 pb-20 animate-in fade-in zoom-in-95 duration-300">
    <div class="flex flex-col items-center space-y-6 text-center">
      <div class="flex items-center justify-center">
        <img
          src="/logo.png"
          alt="Logo"
          class="h-40 w-40 object-contain dark:invert"
        />
      </div>

      <div class="space-y-1">
        <h1 class="text-3xl font-bold tracking-tight text-gray-800 dark:text-white">弦予音乐</h1>
        <p class="text-sm font-medium text-gray-600 dark:text-white/60">v{{ appVersion }}</p>
      </div>

      <p class="max-w-sm text-gray-600 dark:text-gray-300">
        将音乐给予你
      </p>
    </div>

    <div class="flex gap-4">
      <button
        type="button"
        :disabled="isCheckingUpdate"
        @click="handleCheckUpdate"
        class="flex items-center gap-2 rounded-xl bg-[#EC4141] px-5 py-2.5 font-medium text-white shadow-lg shadow-red-500/20 transition active:scale-95 hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-70"
      >
        <svg v-if="isCheckingUpdate" class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 0-2 0v2H7a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V7Z" clip-rule="evenodd" /></svg>
        {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
      </button>

      <a
        :href="REPO_URL"
        target="_blank"
        rel="noreferrer"
        class="flex cursor-pointer items-center gap-2 rounded-xl bg-white/30 backdrop-blur-md border border-white/40 px-5 py-2.5 font-medium text-gray-800 no-underline transition active:scale-95 shadow-sm hover:bg-black/10 hover:border-black/10 dark:bg-black/20 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
        GitHub 仓库
      </a>

      <a
        href="https://github.com/Billy636/LyciaMusic"
        target="_blank"
        rel="noreferrer"
        class="flex cursor-pointer items-center gap-2 rounded-xl bg-white/30 backdrop-blur-md border border-white/40 px-5 py-2.5 font-medium text-gray-800 no-underline transition active:scale-95 shadow-sm hover:bg-black/10 hover:border-black/10 dark:bg-black/20 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
        GitHub 原仓库
      </a>
    </div>

    <div class="mt-8 text-xs text-gray-400 dark:text-gray-600">
      开发者名单（排名不分先后）：<a href="https://github.com/TaXiaoQi" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-gray-400 transition-colors">@TaXiaoQi</a> <a href="https://github.com/ShenYichenCN" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-gray-400 transition-colors">@ShenYichenCN</a> <a href="https://github.com/88541" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-gray-400 transition-colors">@知难辞</a> <a href="https://github.com/kaishui-server" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit hover:text-gray-600 dark:hover:text-gray-400 transition-colors">@绛狐</a>
    </div>

    <div class="-mt-[26px] text-xs text-gray-400 dark:text-gray-600">
      Copyright © 2026 XY-Music-Desktop Developer. Licensed under AGPL-3.0-only.
    </div>

    <ModernModal
      v-model:visible="dialogVisible"
      :title="dialogTitle"
      :content="dialogContent"
      :confirm-text="dialogConfirmText"
      :cancel-text="dialogCancelText"
      @confirm="handleDialogConfirm"
    />
  </div>
</template>
