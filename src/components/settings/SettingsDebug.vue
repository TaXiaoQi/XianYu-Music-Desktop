<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Trash2 } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useOnboarding } from '../../composables/useOnboarding';
import { useApplicationLogs } from '../../services/applicationLogger';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import LogExportActions from './LogExportActions.vue';

const { disableDeveloperMode } = useDeveloperMode();
const { triggerOnboarding } = useOnboarding();
const { showToast } = useToast();
const { entries, clearLogs } = useApplicationLogs();
const showClearConfirmation = ref(false);
const logEntryTick = ref(0);
const entryCount = computed(() => {
  logEntryTick.value;
  return entries.value.length;
});

watch(
  () => entries.value.length,
  () => { logEntryTick.value += 1; },
  { flush: 'post' },
);

const confirmClearLogs = () => {
  clearLogs();
  showClearConfirmation.value = false;
  showToast('日志已全部删除', 'success');
};
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">调试</h2>
    </div>

    <section class="overflow-hidden rounded-xl border border-black/10 bg-white/35 dark:border-white/10 dark:bg-white/[0.03]">
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
          class="shrink-0 rounded-lg border border-black/10 bg-white/60 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="triggerOnboarding"
        >
          播放
        </button>
      </div>
    </section>

    <section class="space-y-3 rounded-xl border border-black/10 bg-white/35 p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">导出日志</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">导出本机保留的应用日志，便于反馈问题或自行排查。</p>
      </div>
      <LogExportActions />
    </section>

    <section class="space-y-3 rounded-xl border border-black/10 bg-white/35 p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">日志管理</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">当前共有 {{ entryCount }} 条日志，删除后无法恢复。</p>
      </div>
      <button
        type="button"
        :disabled="entryCount === 0"
        class="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/[0.09] disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
        @click="showClearConfirmation = true"
      >
        <Trash2 class="h-4 w-4" />
        删除全部日志
      </button>
    </section>

    <ConfirmModal
      :visible="showClearConfirmation"
      title="确认清空全部日志"
      content="此操作会永久删除当前设备上保存的全部应用日志，且无法恢复。确定继续吗？"
      @confirm="confirmClearLogs"
      @cancel="showClearConfirmation = false"
    />
  </div>
</template>
