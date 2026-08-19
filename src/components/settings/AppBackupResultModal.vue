<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2, ListMusic, PlugZap, Settings2, X } from 'lucide-vue-next';

import type { AppBackupImportResult } from '../../services/appBackup';

const props = defineProps<{
  visible: boolean;
  result: AppBackupImportResult | null;
}>();

const emit = defineEmits<{ (event: 'close'): void }>();

const summary = computed(() => props.result?.summary);
const hasErrors = computed(() => (props.result?.errors.length ?? 0) > 0);
const allSuccess = computed(() =>
  props.result && !hasErrors.value && (props.result.importedPlaylists > 0 || props.result.importedFavorites > 0),
);
</script>

<template>
  <Teleport to="body">
    <Transition name="app-backup-result">
      <div
        v-if="visible && result"
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[3px]"
        @click.self="emit('close')"
      >
        <div class="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/80 shadow-2xl dark:border-white/10 dark:bg-gray-900/90">
          <header class="flex shrink-0 items-start justify-between border-b border-black/8 px-6 py-5 dark:border-white/8">
            <div>
              <div class="flex items-center gap-2">
                <CheckCircle2 v-if="allSuccess" class="h-5 w-5 text-emerald-500" />
                <AlertTriangle v-else class="h-5 w-5 text-amber-500" />
                <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">应用备份导入结果</h3>
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-white/45">
                已完成歌单、收藏、插件和设置的导入恢复。
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg p-2 text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/8 dark:hover:text-white"
              aria-label="关闭导入结果"
              @click="emit('close')"
            >
              <X class="h-4 w-4" />
            </button>
          </header>

          <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 custom-scrollbar">
            <!-- 概览统计 -->
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="rounded-xl bg-emerald-500/8 px-4 py-3">
                <div class="text-xl font-semibold text-emerald-600 dark:text-emerald-300">{{ result.importedPlaylists }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">已导入歌单</div>
              </div>
              <div class="rounded-xl bg-sky-500/8 px-4 py-3">
                <div class="text-xl font-semibold text-sky-600 dark:text-sky-300">{{ result.importedPlugins }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">已导入插件</div>
              </div>
              <div class="rounded-xl bg-amber-500/8 px-4 py-3">
                <div class="text-xl font-semibold text-amber-600 dark:text-amber-300">{{ result.skippedPlugins }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">跳过插件</div>
              </div>
              <div class="rounded-xl px-4 py-3"
                :class="result.settingsApplied ? 'bg-violet-500/8' : 'bg-gray-500/8'"
              >
                <div
                  class="text-xl font-semibold"
                  :class="result.settingsApplied ? 'text-violet-600 dark:text-violet-300' : 'text-gray-400 dark:text-white/30'"
                >{{ result.settingsApplied ? '是' : '否' }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">设置已应用</div>
              </div>
            </div>

            <!-- 歌单分类 -->
            <section v-if="summary" class="space-y-2">
              <div class="flex items-center gap-2">
                <ListMusic class="h-4 w-4 text-[#EC4141]" />
                <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">歌单分类</h4>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <div class="rounded-xl border border-black/7 bg-black/[0.018] px-4 py-3 text-center dark:border-white/8 dark:bg-white/[0.025]">
                  <div class="text-lg font-semibold text-gray-800 dark:text-gray-200">{{ summary.localPlaylistCount }}</div>
                  <div class="mt-0.5 text-xs text-gray-500 dark:text-white/40">本地歌单</div>
                </div>
                <div class="rounded-xl border border-black/7 bg-black/[0.018] px-4 py-3 text-center dark:border-white/8 dark:bg-white/[0.025]">
                  <div class="text-lg font-semibold text-gray-800 dark:text-gray-200">{{ summary.onlinePlaylistCount }}</div>
                  <div class="mt-0.5 text-xs text-gray-500 dark:text-white/40">在线歌单</div>
                </div>
                <div class="rounded-xl border border-black/7 bg-black/[0.018] px-4 py-3 text-center dark:border-white/8 dark:bg-white/[0.025]">
                  <div class="text-lg font-semibold text-gray-800 dark:text-gray-200">{{ summary.mixedPlaylistCount }}</div>
                  <div class="mt-0.5 text-xs text-gray-500 dark:text-white/40">混合歌单</div>
                </div>
              </div>
              <div class="flex items-center gap-4 rounded-xl bg-black/[0.018] px-4 py-2 text-xs text-gray-500 dark:bg-white/[0.025] dark:text-white/40">
                <span>共 {{ summary.totalSongs }} 首歌曲</span>
                <span>本地 {{ summary.localSongs }} 首</span>
                <span>在线 {{ summary.onlineSongs }} 首</span>
                <span>收藏 {{ summary.favoriteCount }} 首</span>
              </div>
            </section>

            <!-- 插件信息 -->
            <section v-if="summary && summary.pluginCount > 0" class="space-y-2">
              <div class="flex items-center gap-2">
                <PlugZap class="h-4 w-4 text-emerald-500" />
                <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">插件</h4>
              </div>
              <p class="rounded-lg bg-emerald-500/8 px-3 py-2 text-xs leading-5 text-emerald-700 dark:text-emerald-200">
                备份包含 {{ summary.pluginCount }} 个插件，成功导入 {{ result.importedPlugins }} 个，跳过 {{ result.skippedPlugins }} 个（已存在或加载失败）。
              </p>
            </section>

            <!-- 设置信息 -->
            <section v-if="result.settingsApplied" class="space-y-2">
              <div class="flex items-center gap-2">
                <Settings2 class="h-4 w-4 text-violet-500" />
                <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">设置</h4>
              </div>
              <p class="rounded-lg bg-violet-500/8 px-3 py-2 text-xs leading-5 text-violet-700 dark:text-violet-200">
                已恢复全部应用设置（主题、播放、歌词等），部分设置可能需要重启应用后生效。
              </p>
            </section>

            <!-- 错误列表 -->
            <section v-if="hasErrors" class="space-y-2">
              <div class="flex items-center gap-2 text-amber-600 dark:text-amber-300">
                <AlertTriangle class="h-4 w-4" />
                <h4 class="text-sm font-semibold">导入错误</h4>
              </div>
              <div class="space-y-1.5">
                <div
                  v-for="(error, index) in result.errors"
                  :key="index"
                  class="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-200"
                >
                  {{ error }}
                </div>
              </div>
            </section>

            <!-- 全部成功提示 -->
            <div
              v-if="!hasErrors && (result.importedPlaylists > 0 || result.importedFavorites > 0)"
              class="rounded-xl bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
            >
              全部歌单、收藏和插件均已成功导入。
            </div>
          </div>

          <footer class="flex shrink-0 justify-end border-t border-black/8 px-6 py-4 dark:border-white/8">
            <button
              type="button"
              class="rounded-xl bg-[#EC4141] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#d93636] active:scale-[0.98]"
              @click="emit('close')"
            >
              完成
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-backup-result-enter-active,
.app-backup-result-leave-active {
  transition: opacity 180ms ease;
}

.app-backup-result-enter-from,
.app-backup-result-leave-to {
  opacity: 0;
}
</style>
