<script setup lang="ts">
import { inject, type Ref } from 'vue';
import TopBarControlIcon from './TopBarControlIcon.vue';
import type { TopBarItemKey } from '../../types';
import { useI18n } from '../../features/i18n';

/**
 * 顶部栏可配置控件渲染组件。
 * 根据传入的 itemKey 渲染对应的控件（后退/听歌识曲/主题/公告/设置/账号/配色方案）。
 * 每个控件均可放入任意容器（左/右），行为一致。
 *
 * 上下文通过 provide/inject 从 TitleBar 共享：
 * - 响应式状态（isDarkTheme、isSettingsRoute、isAuthRoute 等）
 * - 事件处理函数（goBack、toggleThemeMode、toggleSettingsPage 等）
 */
defineProps<{
  itemKey: TopBarItemKey;
}>();
const { t } = useI18n();

const ctx = inject<{
  // 通用
  isDarkTheme: Ref<boolean>;
  // 后退
  goBack: () => void;
  // 听歌识曲
  toggleRecognition: () => void;
  // 主题
  themeToggleTitle: Ref<string>;
  toggleThemeMode: () => void;
  // 公告
  isFetchingAnnouncement: Ref<boolean>;
  manualCheckAnnouncement: () => void;
  // 设置
  isSettingsRoute: Ref<boolean>;
  settingsRotation: Ref<number>;
  toggleSettingsPage: () => void;
  // 账号
  isAuthRoute: Ref<boolean>;
  isLoggedIn: Ref<boolean>;
  accountTitle: Ref<string>;
  accountAvatar: Ref<string | null>;
  accountInitial: Ref<string>;
  openAccountPage: () => void;
  // 配色方案
  openColorScheme: () => void;
}>('topBarContext')!;
</script>

<template>
  <!-- 后退 -->
  <button
    v-if="itemKey === 'back'"
    @click.stop="ctx.goBack"
    class="w-8 h-8 rounded-full bg-white/5 dark:bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 flex items-center justify-center text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white transition-colors focus:outline-none cursor-pointer border border-black/10 dark:border-white/10"
    :title="t('topbar.back')"
  >
    <TopBarControlIcon item-key="back" class="h-5 w-5 -ml-0.5" />
  </button>

  <!-- 听歌识曲 -->
  <button
    v-else-if="itemKey === 'recognize'"
    type="button"
    class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
    :title="t('topbar.recognize')"
    :aria-label="t('topbar.recognize')"
    @click.stop="ctx.toggleRecognition"
  >
    <TopBarControlIcon item-key="recognize" class="h-5 w-5" />
  </button>

  <!-- 主题切换 -->
  <button
    v-else-if="itemKey === 'theme'"
    type="button"
    class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
    :title="ctx.themeToggleTitle.value"
    :aria-label="ctx.themeToggleTitle.value"
    @click.stop="ctx.toggleThemeMode"
  >
    <TopBarControlIcon item-key="theme" :is-dark="ctx.isDarkTheme.value" class="h-5 w-5" />
  </button>

  <!-- 公告 -->
  <button
    v-else-if="itemKey === 'announcement'"
    type="button"
    class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
    :class="{ 'opacity-50': ctx.isFetchingAnnouncement.value }"
    :title="t('topbar.announcement')"
    :aria-label="t('topbar.viewAnnouncement')"
    @click.stop="ctx.manualCheckAnnouncement"
  >
    <TopBarControlIcon item-key="announcement" class="h-5 w-5" />
  </button>

  <!-- 设置 -->
  <button
    v-else-if="itemKey === 'settings'"
    type="button"
    class="rounded-md p-2 transition-all duration-300 ease-out cursor-pointer"
    :class="ctx.isSettingsRoute.value
      ? 'text-[#EC4141] dark:text-[#ff8b8b]'
      : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'"
    :aria-pressed="ctx.isSettingsRoute.value"
    @click.stop="ctx.toggleSettingsPage"
    :title="t('topbar.settings')"
  >
    <TopBarControlIcon
      item-key="settings"
      class="h-[22px] w-[22px] transition-transform duration-300 ease-out"
      :style="{ transform: `rotate(${ctx.settingsRotation.value}deg)` }"
    />
  </button>

  <!-- 账号 -->
  <button
    v-else-if="itemKey === 'account'"
    type="button"
    class="p-1 rounded-md transition-colors cursor-pointer relative"
    :class="ctx.isAuthRoute.value
      ? 'text-[#EC4141] dark:text-[#ff8b8b]'
      : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'"
    :title="ctx.accountTitle.value"
    :aria-label="ctx.isLoggedIn.value ? t('topbar.profile') : t('topbar.login')"
    @click.stop="ctx.openAccountPage"
  >
    <img
      v-if="ctx.isLoggedIn.value && ctx.accountAvatar.value"
      :src="ctx.accountAvatar.value"
      alt=""
      class="h-6 w-6 rounded-full object-cover"
    />
    <span
      v-else-if="ctx.isLoggedIn.value"
      class="grid h-6 w-6 place-items-center rounded-full bg-[#EC4141] text-white text-[11px] font-bold"
    >
      {{ ctx.accountInitial.value }}
    </span>
    <TopBarControlIcon v-else item-key="account" class="h-5 w-5" />
  </button>

  <!-- 配色方案 -->
  <button
    v-else-if="itemKey === 'colorScheme'"
    type="button"
    class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
    :title="t('topbar.skin')"
    :aria-label="t('topbar.skin')"
    @click.stop="ctx.openColorScheme"
  >
    <TopBarControlIcon item-key="colorScheme" class="h-5 w-5" />
  </button>
</template>
