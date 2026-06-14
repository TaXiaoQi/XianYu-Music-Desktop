<script setup lang="ts">
import type { StatisticsImportPreview } from '../../services/tauri/contracts';
import type { StatisticsImportMode } from '../../services/tauri/statisticsApi';

defineProps<{
  visible: boolean;
  preview: StatisticsImportPreview | null;
  mode: StatisticsImportMode;
  importing: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'update:mode': [value: StatisticsImportMode];
  confirm: [];
}>();

const close = () => emit('update:visible', false);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && preview" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm" @click.self="close">
      <div class="w-full max-w-xl overflow-hidden rounded-3xl border border-white/15 bg-white/88 shadow-2xl dark:border-white/10 dark:bg-[#11131a]/92">
        <div class="border-b border-black/5 px-6 py-5 dark:border-white/10">
          <div class="text-lg font-semibold text-gray-900 dark:text-gray-100">检测到统计备份文件</div>
        </div>

        <div class="space-y-5 px-6 py-5">
          <div v-if="preview.duplicateImportDetected" class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
            这份统计备份似乎已经导入过，再次导入可能导致统计翻倍。
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">导出时间</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ new Date(preview.exportedAt).toLocaleString() }}</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">统计版本</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">v{{ preview.version }}</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">应用版本</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ preview.appVersion }}</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">歌曲统计</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ preview.songStatsCount }} 条</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">每日统计</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ preview.dailyStatsCount }} 天</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">最近播放</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ preview.recentPlaysCount }} 条</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">可匹配当前曲库</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ preview.matchedSongCount }} 首</div>
            </div>
            <div class="rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/5">
              <div class="text-xs text-gray-500 dark:text-gray-400">未匹配</div>
              <div class="mt-1 text-gray-900 dark:text-gray-100">{{ preview.unmatchedSongCount }} 首</div>
            </div>
          </div>

          <div class="space-y-3">
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100">导入方式</div>
            <label class="flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors"
              :class="mode === 'merge'
                ? 'border-[#EC4141]/40 bg-[#EC4141]/6'
                : 'border-black/8 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]'">
              <input
                :checked="mode === 'merge'"
                type="radio"
                name="statistics-import-mode"
                class="mt-1 h-4 w-4 accent-[#EC4141]"
                @change="emit('update:mode', 'merge')"
              />
              <div>
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100">合并到当前统计</div>
                <div class="mt-1 text-sm text-gray-600 dark:text-gray-300">推荐默认模式，会把当前统计和备份统计合并。</div>
              </div>
            </label>

            <label class="flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors"
              :class="mode === 'overwrite'
                ? 'border-[#EC4141]/40 bg-[#EC4141]/6'
                : 'border-black/8 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]'">
              <input
                :checked="mode === 'overwrite'"
                type="radio"
                name="statistics-import-mode"
                class="mt-1 h-4 w-4 accent-[#EC4141]"
                @change="emit('update:mode', 'overwrite')"
              />
              <div>
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100">覆盖当前统计</div>
                <div class="mt-1 text-sm text-gray-600 dark:text-gray-300">会清空当前导入导出统计，再用备份内容替换。</div>
              </div>
            </label>
          </div>

          <div class="rounded-2xl bg-black/[0.03] px-4 py-3 text-sm text-gray-600 dark:bg-white/5 dark:text-gray-300">
            导入导出的内容仅包含听歌行为统计，不包含曲库概览。当前版本导入后的合并结果会反映在“全部”统计范围。
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-black/5 px-6 py-4 dark:border-white/10">
          <button
            type="button"
            class="rounded-full border border-black/10 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/8"
            :disabled="importing"
            @click="close"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-full bg-[#EC4141] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d73737] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="importing"
            @click="emit('confirm')"
          >
            {{ importing ? '导入中...' : '开始导入' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
