<script setup lang="ts">
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useOnboarding } from '../../composables/useOnboarding';
import { showSettingsConflict } from '../../composables/useSettingsConflict';

const { disableDeveloperMode } = useDeveloperMode();
const { triggerOnboarding } = useOnboarding();

/** 测试设置同步冲突弹窗 */
function testConflictDialog() {
  void showSettingsConflict(new Date().toISOString());
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">调试</h2>
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

      <div class="border-t border-black/5 dark:border-white/5"></div>

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

      <div class="border-t border-black/5 dark:border-white/5"></div>

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
    </section>
  </div>
</template>
