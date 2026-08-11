<script setup lang="ts">
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useOnboarding } from '../../composables/useOnboarding';
import { showSettingsConflict } from '../../composables/useSettingsConflict';
import { useAnnouncement } from '../../composables/useAnnouncement';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { showProfileLimitDialog } from '../../composables/useProfileLimitDialog';

const { disableDeveloperMode } = useDeveloperMode();
const { triggerOnboarding } = useOnboarding();
const { simulateAnnouncement } = useAnnouncement();
const { simulateUpdate } = useUpdateCheck();

/** 测试设置同步冲突弹窗 */
function testConflictDialog() {
  void showSettingsConflict(new Date().toISOString());
}

function testNicknameLimitDialog() {
  void showProfileLimitDialog('nickname');
}

function testAvatarLimitDialog() {
  void showProfileLimitDialog('avatar');
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
  </div>
</template>
