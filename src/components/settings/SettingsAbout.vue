<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_VERSION } from '../../../version';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { useToast } from '../../composables/toast';
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useI18n } from '../../features/i18n';
import { aboutConfig, startAboutConfigPolling, stopAboutConfigPolling } from '../../utils/aboutConfig';
import AcknowledgementsModal from '../common/AcknowledgementsModal.vue';

const appVersion = APP_VERSION;
const ackModalOpen = ref(false);
function openAcknowledgements() {
  ackModalOpen.value = true;
}
const DEVELOPER_MODE_CLICK_COUNT = 10;
const DEVELOPER_MODE_CLICK_HINT_START = 7;
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
  acknowledgements: 'Acknowledgements',
  version: 'Version',
  license: 'License',
  tech: 'Tech Stack',
} : {
  update: '检查更新',
  checking: '检查中...',
  officialSite: '前往官网',
  joinGroup: '加入群组',
  project: '开源地址',
  referenceProject: '参考项目',
  acknowledgements: '致谢名单',
  version: '版本',
  license: '许可证',
  tech: '技术栈',
});

function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function openExternal(url: string) {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return;
  try {
    await openUrl(normalized);
  } catch (error) {
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
    return;
  }
  if (developerModeClickCount.value >= DEVELOPER_MODE_CLICK_HINT_START) {
    const remaining = DEVELOPER_MODE_CLICK_COUNT - developerModeClickCount.value;
    showToast(isEnglish.value ? `Tap ${remaining} more times to enable developer mode` : `再点击 ${remaining} 次即可进入开发者模式`);
  }
}

const { isCheckingUpdate, checkUpdateManual } = useUpdateCheck();

onMounted(() => {
  startAboutConfigPolling();
});

onUnmounted(() => {
  stopAboutConfigPolling();
});
</script>

<template>
  <div class="relative flex min-h-full min-w-0 flex-col items-center pb-8">
    <!-- 环境光晕：径向渐变，每条渐变在面板四边都恰好淡到全透明，
         因此无论容器多大都不会出现可见边界或被裁出的硬边。
         负 inset 抵消上层容器的内边距，让光晕铺满整个设置面板。 -->
    <div
      class="pointer-events-none absolute -inset-x-4 -top-6 -bottom-16 overflow-hidden sm:-inset-x-6 md:-inset-x-8 xl:-inset-x-12"
      aria-hidden="true"
    >
      <div class="xy-flow xy-flow-a absolute inset-0" />
      <div class="xy-flow xy-flow-b absolute inset-0" />
    </div>

    <div class="relative z-10 flex w-full flex-1 items-center justify-center px-6 py-10">
      <!-- Hero 卡片 -->
      <div class="xy-enter relative w-full max-w-md rounded-3xl border border-black/5 bg-white/60 px-8 pb-8 pt-10 text-center shadow-2xl shadow-black/10 backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.05] dark:shadow-black/40">
        <!-- 顶部品牌高光 -->
        <div class="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#EC4141]/60 to-transparent" />

        <!-- Logo：光环 + 呼吸 -->
        <div class="xy-enter mx-auto mb-6 w-fit" style="animation-delay: 60ms">
          <div class="xy-breathe rounded-full bg-gradient-to-br from-[#EC4141] to-[#ff9d9d] p-[3px] shadow-xl shadow-[#EC4141]/30">
            <div class="rounded-full bg-white p-1.5 dark:bg-[#181818]">
              <img src="/logo.png" alt="Logo" class="h-20 w-20 object-contain dark:invert" />
            </div>
          </div>
        </div>

        <!-- 名称 + 版本 -->
        <div class="xy-enter space-y-2.5" style="animation-delay: 140ms">
          <h1 class="bg-gradient-to-r from-[#EC4141] via-[#ff7b7b] to-[#ffb199] bg-clip-text text-[26px] font-bold tracking-tight text-transparent">
            弦予音乐
          </h1>
          <button
            type="button"
            class="cursor-pointer select-none rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs font-medium text-gray-600 transition-all duration-200 active:scale-90 active:border-[#EC4141]/40 active:bg-[#EC4141]/10 active:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-white/60 dark:active:text-[#EC4141]"
            @click="handleDeveloperModeClick"
          >
            v{{ appVersion }}
          </button>
          <p class="select-none text-sm text-gray-500 dark:text-white/45">
            将音乐给予你
          </p>
        </div>

        <!-- 主操作 -->
        <div class="xy-enter mt-7 flex flex-wrap items-center justify-center gap-2.5" style="animation-delay: 220ms">
          <button
            v-if="aboutConfig.updateEnabled"
            type="button"
            :disabled="isCheckingUpdate"
            @click="checkUpdateManual"
            class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-br from-[#EC4141] to-[#d13a3a] px-4 py-2 text-sm font-medium text-white shadow-lg shadow-red-500/25 transition active:scale-95 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
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
            class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-br from-[#EC4141] to-[#d13a3a] px-4 py-2 text-sm font-medium text-white no-underline shadow-lg shadow-red-500/25 transition active:scale-95 hover:brightness-110"
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
            class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-br from-[#EC4141] to-[#d13a3a] px-4 py-2 text-sm font-medium text-white no-underline shadow-lg shadow-red-500/25 transition active:scale-95 hover:brightness-110"
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

        <!-- 分隔线 -->
        <div class="xy-enter mx-auto mt-7 h-px w-4/5 bg-gradient-to-r from-transparent via-black/10 to-transparent dark:via-white/10" style="animation-delay: 300ms" />

        <!-- 次操作 -->
        <div class="xy-enter mt-6 flex flex-wrap items-center justify-center gap-2.5" style="animation-delay: 360ms">
          <button
            v-if="aboutConfig.projectUrl"
            type="button"
            @click="openExternal(aboutConfig.projectUrl)"
            class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-black/10 bg-black/[0.03] px-3.5 py-2 text-xs font-medium text-gray-700 no-underline transition active:scale-95 hover:border-[#EC4141]/40 hover:bg-[#EC4141]/5 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:text-[#EC4141]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
            {{ buttonText.project }}
          </button>

          <button
            v-if="aboutConfig.referenceProjectUrl"
            type="button"
            @click="openExternal(aboutConfig.referenceProjectUrl)"
            class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-black/10 bg-black/[0.03] px-3.5 py-2 text-xs font-medium text-gray-700 no-underline transition active:scale-95 hover:border-[#EC4141]/40 hover:bg-[#EC4141]/5 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:text-[#EC4141]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
            {{ buttonText.referenceProject }}
          </button>

          <button
            v-if="aboutConfig.acknowledgements.length"
            type="button"
            @click="openAcknowledgements"
            class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-black/10 bg-black/[0.03] px-3.5 py-2 text-xs font-medium text-gray-700 no-underline transition active:scale-95 hover:border-[#EC4141]/40 hover:bg-[#EC4141]/5 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:text-[#EC4141]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z" /></svg>
            {{ buttonText.acknowledgements }}
          </button>
        </div>

        <!-- 信息条 -->
        <div class="xy-enter mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[11px] text-gray-400 dark:text-white/35" style="animation-delay: 440ms">
          <span class="flex items-center gap-1">
            <span class="text-gray-300 dark:text-white/25">{{ buttonText.version }}</span>v{{ appVersion }}
          </span>
          <span class="h-1 w-1 rounded-full bg-current opacity-30" />
          <span class="flex items-center gap-1">
            <span class="text-gray-300 dark:text-white/25">{{ buttonText.license }}</span>AGPL-3.0
          </span>
          <span class="h-1 w-1 rounded-full bg-current opacity-30" />
          <span class="flex items-center gap-1">
            <span class="text-gray-300 dark:text-white/25">{{ buttonText.tech }}</span>Vue 3 · Tauri 2 · TS
          </span>
        </div>
      </div>
    </div>

    <!-- 页脚 -->
    <div class="relative z-10 mt-auto max-w-full shrink-0 space-y-1.5 px-6 pt-2 text-center text-xs leading-relaxed text-gray-400 dark:text-white/40">
      <div class="flex flex-wrap items-center justify-center gap-x-1">
        <span>开发者名单（排名不分先后）：</span><a href="https://github.com/ShenYichenCN" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit transition-colors hover:text-[#EC4141] dark:hover:text-[#EC4141]">@ShenYichenCN</a> <a href="https://github.com/TaXiaoQi" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit transition-colors hover:text-[#EC4141] dark:hover:text-[#EC4141]">@TaXiaoQi</a> <a href="https://github.com/88541" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit transition-colors hover:text-[#EC4141] dark:hover:text-[#EC4141]">@知难辞</a> <a href="https://github.com/kaishui-server" target="_blank" rel="noreferrer" class="cursor-pointer no-underline text-inherit transition-colors hover:text-[#EC4141] dark:hover:text-[#EC4141]">@绛狐</a>
      </div>
      <div>
        Copyright © 2026 XY-Music-Desktop Developer. Licensed under AGPL-3.0-only.
      </div>
    </div>
  </div>

  <AcknowledgementsModal
    :visible="ackModalOpen"
    :items="aboutConfig.acknowledgements"
    @close="ackModalOpen = false"
  />
</template>

<style scoped>
/* 入场动画：整体上浮淡入 */
.xy-enter {
  opacity: 0;
  animation: xy-fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes xy-fade-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Logo 呼吸 */
.xy-breathe {
  animation: xy-breathe 4.5s ease-in-out infinite;
}

@keyframes xy-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.045);
  }
}

/* 环境光晕：用 radial-gradient 的 closest-side 尺寸关键字，
   让椭圆半径自动等于「圆心到最近边的距离」，并把最后一个色标放在 100% 且为全透明。
   这样四条边上的 alpha 都恰好为 0，容器再大也不会露出边界。
   动效只用 opacity 交叉脉动（不位移、不缩放），避免把非透明区域推出裁剪范围。 */
.xy-flow {
  background-repeat: no-repeat;
}

.xy-flow-a {
  background-image:
    radial-gradient(ellipse closest-side at 50% 50%, rgba(236, 65, 65, 0.06), rgba(236, 65, 65, 0) 100%),
    radial-gradient(ellipse closest-side at 50% 34%, rgba(236, 65, 65, 0.2), rgba(236, 65, 65, 0.07) 55%, rgba(236, 65, 65, 0) 100%),
    radial-gradient(ellipse closest-side at 78% 70%, rgba(255, 139, 139, 0.12), rgba(255, 139, 139, 0) 100%);
  animation: xy-flow-pulse-a 18s ease-in-out infinite;
}

.xy-flow-b {
  background-image:
    radial-gradient(ellipse closest-side at 20% 72%, rgba(185, 28, 28, 0.14), rgba(185, 28, 28, 0) 100%);
  animation: xy-flow-pulse-b 18s ease-in-out infinite;
}

/* 暗色模式下更浓一点，氛围更足 */
.dark .xy-flow-a {
  background-image:
    radial-gradient(ellipse closest-side at 50% 50%, rgba(236, 65, 65, 0.1), rgba(236, 65, 65, 0) 100%),
    radial-gradient(ellipse closest-side at 50% 34%, rgba(236, 65, 65, 0.3), rgba(236, 65, 65, 0.1) 55%, rgba(236, 65, 65, 0) 100%),
    radial-gradient(ellipse closest-side at 78% 70%, rgba(255, 139, 139, 0.17), rgba(255, 139, 139, 0) 100%);
}

.dark .xy-flow-b {
  background-image:
    radial-gradient(ellipse closest-side at 20% 72%, rgba(185, 28, 28, 0.22), rgba(185, 28, 28, 0) 100%);
}

/* 两层反相脉动，形成缓慢的流光错动感 */
@keyframes xy-flow-pulse-a {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

@keyframes xy-flow-pulse-b {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .xy-enter,
  .xy-breathe,
  .xy-flow-a,
  .xy-flow-b {
    animation: none;
  }

  .xy-enter {
    opacity: 1;
  }
}
</style>
