<script setup lang="ts">
import { ref } from 'vue';
import { Trash2 } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import { useApplicationLogs } from '../../services/applicationLogger';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import LogExportActions from './LogExportActions.vue';

const { showToast } = useToast();
const { settings, patchSettings } = useSettings();
const { entries, clearLogs } = useApplicationLogs();
const showDeleteConfirmation = ref(false);
const retentionOptions = [1, 3, 7, 14, 30, 90];

const confirmDeleteLogs = () => {
  clearLogs();
  showDeleteConfirmation.value = false;
  showToast('日志已全部删除', 'success');
};
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">高级设置</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-white/45">面向问题排查与数据管理的高级功能。</p>
    </div>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">日志保留</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">超过保留时长的日志会自动清理。</p>
      </div>
      <label class="block max-w-sm">
        <span class="text-xs text-gray-500 dark:text-white/45">日志保留时长</span>
        <select
          :value="settings.logging.retentionDays"
          class="mt-2 h-9 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-sm text-gray-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-gray-100"
          @change="patchSettings({ logging: { retentionDays: Number(($event.target as HTMLSelectElement).value) } })"
        >
          <option v-for="days in retentionOptions" :key="days" :value="days">{{ days }} 天</option>
        </select>
      </label>
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">导出日志</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">导出本机保留的应用日志，便于反馈问题或自行排查。</p>
      </div>
      <LogExportActions />
    </section>

    <section class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">日志管理</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">删除后无法恢复，建议先导出需要保留的日志。</p>
      </div>
      <button
        type="button"
        :disabled="entries.length === 0"
        class="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/[0.09] disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
        @click="showDeleteConfirmation = true"
      >
        <Trash2 class="h-4 w-4" />
        删除全部日志
      </button>
    </section>

    <ConfirmModal
      :visible="showDeleteConfirmation"
      title="确认删除全部日志"
      content="此操作会永久删除当前设备上保存的全部应用日志，且无法恢复。确定继续吗？"
      @confirm="confirmDeleteLogs"
      @cancel="showDeleteConfirmation = false"
    />
  </div>
</template>
