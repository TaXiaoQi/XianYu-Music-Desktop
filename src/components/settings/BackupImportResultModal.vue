<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2, PlugZap, X } from 'lucide-vue-next';

import type {
  PluginBackupFailedSong,
  PreparedPluginBackupImport,
} from '../../services/pluginBackupImport';

const props = defineProps<{
  visible: boolean;
  result: PreparedPluginBackupImport | null;
  createdPlaylistCount: number;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

interface FailureGroup {
  key: string;
  platform: string;
  reason: string;
  songs: PluginBackupFailedSong[];
}

const failureGroups = computed<FailureGroup[]>(() => {
  const groups = new Map<string, FailureGroup>();
  for (const failure of props.result?.failures ?? []) {
    const key = `${failure.platform}\u0000${failure.reason}`;
    const current = groups.get(key);
    if (current) current.songs.push(failure);
    else {
      groups.set(key, {
        key,
        platform: failure.platform,
        reason: failure.reason,
        songs: [failure],
      });
    }
  }
  return [...groups.values()];
});

const formatName = computed(() => props.result?.format === 'bakamusic' ? 'BakaMusic' : 'MusicFree');
</script>

<template>
  <Teleport to="body">
    <Transition name="backup-result">
      <div
        v-if="visible && result"
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[3px]"
        @click.self="emit('close')"
      >
        <div class="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/80 shadow-2xl dark:border-white/10 dark:bg-gray-900/90">
          <header class="flex shrink-0 items-start justify-between border-b border-black/8 px-6 py-5 dark:border-white/8">
            <div>
              <div class="flex items-center gap-2">
                <CheckCircle2 v-if="result.importedSongCount > 0" class="h-5 w-5 text-emerald-500" />
                <AlertTriangle v-else class="h-5 w-5 text-amber-500" />
                <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">备份导入结果</h3>
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-white/45">
                已识别 {{ formatName }} 备份，并完成插件匹配与歌单导入。
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
            <div class="grid grid-cols-3 gap-3">
              <div class="rounded-xl bg-emerald-500/8 px-4 py-3">
                <div class="text-xl font-semibold text-emerald-600 dark:text-emerald-300">{{ result.importedSongCount }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">成功导入歌曲</div>
              </div>
              <div class="rounded-xl bg-amber-500/8 px-4 py-3">
                <div class="text-xl font-semibold text-amber-600 dark:text-amber-300">{{ result.failures.length }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">未能导入歌曲</div>
              </div>
              <div class="rounded-xl bg-sky-500/8 px-4 py-3">
                <div class="text-xl font-semibold text-sky-600 dark:text-sky-300">{{ createdPlaylistCount }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-white/45">已创建歌单</div>
              </div>
            </div>

            <section v-if="result.associations.length" class="space-y-2">
              <div class="flex items-center gap-2">
                <PlugZap class="h-4 w-4 text-emerald-500" />
                <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">已关联插件</h4>
              </div>
              <div class="space-y-2">
                <div
                  v-for="association in result.associations"
                  :key="`${association.pluginId}-${association.platform}`"
                  class="flex items-center justify-between gap-4 rounded-xl border border-black/7 bg-black/[0.018] px-4 py-3 text-sm dark:border-white/8 dark:bg-white/[0.025]"
                >
                  <div class="min-w-0">
                    <div class="truncate font-medium text-gray-800 dark:text-gray-200">{{ association.pluginName }}</div>
                    <div class="mt-0.5 text-xs text-gray-500 dark:text-white/40">
                      {{ association.platform }} · {{ association.pluginFormat === 'lx' ? 'LX' : 'MusicFree' }}
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ association.songCount }} 首</div>
                    <div v-if="!association.enabled" class="mt-0.5 text-[11px] text-amber-600 dark:text-amber-300">插件未启用</div>
                  </div>
                </div>
              </div>
              <p
                v-if="result.associations.some(item => !item.enabled)"
                class="rounded-lg bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-200"
              >
                部分歌曲已关联到当前停用的插件；歌曲和歌单已经导入，启用对应插件后即可解析播放。
              </p>
            </section>

            <section v-if="result.missingPlugins.length" class="space-y-2">
              <div class="flex items-center gap-2 text-amber-600 dark:text-amber-300">
                <AlertTriangle class="h-4 w-4" />
                <h4 class="text-sm font-semibold">缺失插件</h4>
              </div>
              <div class="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                <div
                  v-for="missing in result.missingPlugins"
                  :key="missing.platform"
                  class="flex items-center justify-between gap-3 py-1 text-sm text-gray-700 dark:text-gray-200"
                >
                  <span>需要可处理“{{ missing.platform }}”的插件</span>
                  <span class="shrink-0 text-xs text-amber-700 dark:text-amber-200">影响 {{ missing.songCount }} 首</span>
                </div>
              </div>
            </section>

            <section v-if="failureGroups.length" class="space-y-2">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">未导入歌曲明细</h4>
              <div class="space-y-2">
                <details
                  v-for="group in failureGroups"
                  :key="group.key"
                  class="rounded-xl border border-black/8 bg-black/[0.018] px-4 py-3 open:bg-black/[0.028] dark:border-white/8 dark:bg-white/[0.025] dark:open:bg-white/[0.04]"
                >
                  <summary class="cursor-pointer select-none text-sm font-medium text-gray-800 dark:text-gray-200">
                    {{ group.platform }} · {{ group.songs.length }} 首
                    <span class="ml-2 text-xs font-normal text-gray-500 dark:text-white/40">{{ group.reason }}</span>
                  </summary>
                  <p class="mt-3 break-words text-xs leading-6 text-gray-600 dark:text-white/55">
                    {{ group.songs.map(song => `${song.title} — ${song.artist}（${song.playlist}）`).join('、') }}
                  </p>
                </details>
              </div>
            </section>

            <div
              v-if="result.failures.length === 0"
              class="rounded-xl bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
            >
              全部 {{ result.totalSongCount }} 首歌曲均已成功导入并关联到已安装插件。
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
.backup-result-enter-active,
.backup-result-leave-active {
  transition: opacity 180ms ease;
}

.backup-result-enter-from,
.backup-result-leave-to {
  opacity: 0;
}
</style>
