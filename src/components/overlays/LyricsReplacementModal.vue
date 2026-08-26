<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { LoaderCircle, X } from 'lucide-vue-next';

import type { Song } from '../../types';
import { useToast } from '../../composables/toast';
import { lyricsApi } from '../../services/tauri/lyricsApi';
import {
  applyLyricsReplacement,
  createDefaultLyricsSearchQuery,
  getLyricsForCandidate,
  searchLyricsFromAllPlugins,
  type LyricsSearchCandidate,
  type LyricsPluginGroup,
  type LyricsSearchSourceStatus,
} from '../../services/domain/lyricsReplacement';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const { showToast } = useToast();
const activeMethod = ref<'local' | 'plugin'>('local');
const searchQuery = ref('');
const pluginGroups = ref<LyricsPluginGroup[]>([]);
const activePluginId = ref('');
const isSearching = ref(false);
const searchAttempted = ref(false);
const applyingCandidateId = ref('');
const isUploading = ref(false);
const operationError = ref('');
let searchRequestId = 0;

const activePlugin = computed(() =>
  pluginGroups.value.find(plugin => plugin.pluginId === activePluginId.value)
    ?? pluginGroups.value[0]
    ?? null,
);

const resultCount = computed(() =>
  pluginGroups.value.reduce(
    (total, plugin) => total + plugin.sources.reduce(
      (sourceTotal, source) => sourceTotal + source.candidates.length,
      0,
    ),
    0,
  ),
);

const activePluginResultCount = computed(() =>
  activePlugin.value?.sources.reduce((total, source) => total + source.candidates.length, 0) ?? 0,
);

const sourceStatusLabel = (status: LyricsSearchSourceStatus) => ({
  success: '已返回结果',
  empty: '结果为空',
  error: '调用失败',
  unsupported: '不支持',
})[status];

const formatDuration = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const resetModal = () => {
  searchRequestId += 1;
  // 默认进入"从插件获取"标签页，方便直接搜索
  activeMethod.value = 'plugin';
  searchQuery.value = props.song ? createDefaultLyricsSearchQuery(props.song) : '';
  pluginGroups.value = [];
  activePluginId.value = '';
  isSearching.value = false;
  searchAttempted.value = false;
  applyingCandidateId.value = '';
  isUploading.value = false;
  operationError.value = '';
};

watch(
  () => [props.visible, props.song?.path] as const,
  ([visible]) => {
    if (visible) {
      resetModal();
      // 打开弹窗时若已有默认搜索内容，自动触发搜索显示结果
      if (searchQuery.value.trim()) {
        void handleSearch();
      }
    } else {
      searchRequestId += 1;
    }
  },
);

const close = () => {
  if (isUploading.value || applyingCandidateId.value) return;
  emit('close');
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.visible) close();
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  // 组件通过 v-if 挂载时 visible 已为 true，watch 不会触发首次回调，需在此初始化
  if (props.visible) {
    resetModal();
    if (searchQuery.value.trim()) {
      void handleSearch();
    }
  }
});
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

const handleUpload = async () => {
  if (!props.song || isUploading.value) return;
  operationError.value = '';

  const selected = await open({
    multiple: false,
    directory: false,
    title: '选择 LRC 歌词文件',
    filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }],
  });
  if (!selected || Array.isArray(selected)) return;

  isUploading.value = true;
  try {
    const lyrics = await lyricsApi.readLyricsFile(selected);
    await applyLyricsReplacement(props.song, lyrics);
    showToast('歌词已更改', 'success');
    emit('close');
  } catch (error) {
    operationError.value = String(error);
  } finally {
    isUploading.value = false;
  }
};

const handleSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query || isSearching.value) return;

  const requestId = ++searchRequestId;
  isSearching.value = true;
  searchAttempted.value = true;
  operationError.value = '';
  pluginGroups.value = [];
  activePluginId.value = '';

  try {
    const groups = await searchLyricsFromAllPlugins(query);
    if (requestId !== searchRequestId || !props.visible) return;
    pluginGroups.value = groups;
    activePluginId.value = groups[0]?.pluginId ?? '';
  } catch (error) {
    if (requestId === searchRequestId) operationError.value = String(error);
  } finally {
    if (requestId === searchRequestId) isSearching.value = false;
  }
};

const handleApplyCandidate = async (candidate: LyricsSearchCandidate) => {
  if (!props.song || applyingCandidateId.value) return;
  applyingCandidateId.value = candidate.id;
  operationError.value = '';

  try {
    const lyrics = await getLyricsForCandidate(candidate);
    await applyLyricsReplacement(props.song, lyrics);
    showToast(`已应用“${candidate.title}”的歌词`, 'success');
    emit('close');
  } catch (error) {
    operationError.value = String(error);
  } finally {
    applyingCandidateId.value = '';
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="lyrics-modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm"
        @mousedown.self="close"
        @contextmenu.prevent
      >
        <section class="lyrics-replacement-card flex max-h-[min(760px,calc(100vh-40px))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white/80 text-gray-900 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:bg-gray-900/90 dark:text-gray-100 dark:ring-white/10">
          <header class="flex items-start justify-between border-b border-black/5 px-6 py-4 dark:border-white/5">
            <div class="min-w-0">
              <h2 class="text-base font-semibold">更改歌词 (LRC)</h2>
              <p class="mt-1 max-w-xl truncate text-xs text-gray-400 dark:text-gray-500">
                {{ song?.title || song?.name }} · {{ song?.artist }}
              </p>
            </div>
            <button class="rounded-lg p-1.5 text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200" title="关闭" @click="close">
              <X :size="18" />
            </button>
          </header>

          <div class="flex gap-7 px-6 pt-3">
            <button
              class="method-tab"
              :class="activeMethod === 'local' ? 'method-tab--active' : ''"
              @click="activeMethod = 'local'; operationError = ''"
            >
              从本地上传
            </button>
            <button
              class="method-tab"
              :class="activeMethod === 'plugin' ? 'method-tab--active' : ''"
              @click="activeMethod = 'plugin'; operationError = ''"
            >
              从插件获取
            </button>
          </div>

          <main class="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
            <Transition name="lyrics-method" mode="out-in">
            <div v-if="activeMethod === 'local'" key="local" class="flex min-h-[330px] flex-col items-center justify-center rounded-xl bg-black/[0.025] px-8 text-center dark:bg-white/[0.025]">
              <h3 class="text-base font-medium">选择本地 LRC 文件</h3>
              <p class="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                支持标准 LRC、增强逐字 LRC，以及 UTF-8、UTF-16 或 GBK 编码。应用后会立即刷新当前歌词。
              </p>
              <button class="primary-button mt-7 min-w-40" :disabled="isUploading" @click="handleUpload">
                <LoaderCircle v-if="isUploading" class="animate-spin" :size="17" />
                {{ isUploading ? '正在应用…' : '选择并应用' }}
              </button>
            </div>

            <div v-else key="plugin" class="min-h-[420px]">
              <label class="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">搜索内容</label>
              <div class="flex gap-2">
                <div class="min-w-0 flex-1">
                  <input
                    v-model="searchQuery"
                    class="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-black/20 dark:text-gray-100 dark:placeholder:text-gray-600"
                    placeholder="输入歌名、歌手或你想搜索的内容"
                    @keydown.enter="handleSearch"
                  />
                </div>
                <button class="primary-button h-10 px-5" :disabled="isSearching || !searchQuery.trim()" @click="handleSearch">
                  <LoaderCircle v-if="isSearching" class="animate-spin" :size="17" />
                  {{ isSearching ? '搜索中' : '搜索' }}
                </button>
              </div>
              <p class="mt-2 text-xs leading-5 text-gray-400 dark:text-gray-500">将同时检查全部已启用插件，支持歌词的插件会显示在下方标签栏中。</p>

              <div v-if="isSearching" class="flex min-h-[270px] flex-col items-center justify-center text-gray-400">
                <LoaderCircle class="mb-3 animate-spin text-[#EC4141]" :size="24" />
                <span class="text-sm">正在汇总所有插件的结果…</span>
              </div>

              <div v-else-if="pluginGroups.length" class="mt-5">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <span>{{ pluginGroups.length }} 个歌词插件</span>
                  <span>共 {{ resultCount }} 个候选歌词</span>
                </div>

                <div
                  class="plugin-tab-bar flex gap-6 overflow-x-auto border-b border-black/5 dark:border-white/5"
                  role="tablist"
                  aria-label="歌词插件"
                >
                  <button
                    v-for="plugin in pluginGroups"
                    :key="plugin.pluginId"
                    class="plugin-tab"
                    :class="activePlugin?.pluginId === plugin.pluginId ? 'plugin-tab--active' : ''"
                    type="button"
                    role="tab"
                    :aria-selected="activePlugin?.pluginId === plugin.pluginId"
                    @click="activePluginId = plugin.pluginId"
                  >
                    <span class="max-w-40 truncate">{{ plugin.pluginName }}</span>
                    <span class="plugin-tab__count">
                      {{ plugin.sources.reduce((total, source) => total + source.candidates.length, 0) }}
                    </span>
                  </button>
                </div>

                <section
                  v-if="activePlugin"
                  :key="activePlugin.pluginId"
                  class="mt-4"
                  role="tabpanel"
                >
                  <div class="mb-4 flex items-center justify-between px-1">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{{ activePlugin.pluginName }}</div>
                      <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{{ activePlugin.formatLabel }} · {{ activePlugin.sources.length }} 个音源</div>
                    </div>
                    <span class="text-xs text-gray-400 dark:text-gray-500">
                      {{ activePluginResultCount }} 个候选
                    </span>
                  </div>

                  <div v-for="source in activePlugin.sources" :key="source.id" class="mb-5 last:mb-0">
                    <div class="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate text-xs font-medium text-gray-600 dark:text-gray-300">{{ source.sourceName }}</span>
                        <span class="text-[10px] text-gray-400 dark:text-gray-600">
                          {{ source.searchProvider === 'plugin' ? '插件搜索' : '应用目录搜索' }}
                        </span>
                      </div>
                      <span
                        class="text-[10px]"
                        :class="{
                          'text-emerald-600 dark:text-emerald-400': source.status === 'success',
                          'text-gray-400 dark:text-gray-500': source.status === 'empty',
                          'text-red-500': source.status === 'error',
                          'text-amber-600 dark:text-amber-400': source.status === 'unsupported',
                        }"
                      >
                        {{ sourceStatusLabel(source.status) }}
                      </span>
                    </div>

                    <p
                      v-if="source.status !== 'success'"
                      class="mb-2 px-1 text-xs leading-5"
                      :class="source.status === 'error'
                        ? 'text-red-500/80'
                        : 'text-gray-400 dark:text-gray-500'"
                    >
                      {{ source.reason }}
                    </p>

                    <button
                      v-for="candidate in source.candidates"
                      :key="candidate.id"
                      class="candidate-row group flex w-full items-center gap-4 rounded-lg px-3 py-2.5 text-left"
                      :disabled="Boolean(applyingCandidateId)"
                      @click="handleApplyCandidate(candidate)"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{{ candidate.title }}</div>
                        <div class="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">
                          {{ candidate.artist }}<template v-if="candidate.album"> · {{ candidate.album }}</template>
                        </div>
                      </div>
                      <span class="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-600">{{ formatDuration(candidate.duration) }}</span>
                      <span class="w-10 shrink-0 text-right text-xs text-[#EC4141] opacity-0 transition group-hover:opacity-100">
                        <LoaderCircle v-if="applyingCandidateId === candidate.id" class="ml-auto animate-spin" :size="14" />
                        <template v-else>应用</template>
                      </span>
                    </button>
                  </div>
                </section>
              </div>

              <div v-else-if="searchAttempted" class="flex min-h-[250px] flex-col items-center justify-center text-center">
                <p class="text-sm text-gray-500 dark:text-gray-400">没有支持歌词获取的已启用插件</p>
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-600">不支持歌曲搜索或歌词获取的插件不会显示。</p>
              </div>

              <div v-else class="flex min-h-[250px] flex-col items-center justify-center text-center">
                <p class="text-sm text-gray-400 dark:text-gray-500">输入搜索内容后查看插件结果</p>
              </div>
            </div>
            </Transition>

            <div v-if="operationError" class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">
              {{ operationError }}
            </div>
          </main>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.method-tab {
  position: relative;
  padding: 0.55rem 0 0.65rem;
  color: rgb(156 163 175);
  font-size: 0.8125rem;
  transition: color 160ms ease;
}

.method-tab:hover {
  color: rgb(75 85 99);
}

.method-tab--active {
  color: #ec4141;
  font-weight: 500;
}

.method-tab::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: #ec4141;
  content: '';
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.method-tab--active::after {
  transform: scaleX(1);
}

:global(.dark) .method-tab:hover {
  color: rgb(229 231 235);
}

.plugin-tab-bar {
  scrollbar-width: none;
}

.plugin-tab-bar::-webkit-scrollbar {
  display: none;
}

.plugin-tab {
  position: relative;
  display: inline-flex;
  min-width: max-content;
  align-items: center;
  gap: 0.35rem;
  padding: 0.55rem 0 0.65rem;
  color: rgb(156 163 175);
  font-size: 0.75rem;
  transition: color 160ms ease;
}

.plugin-tab:hover {
  color: rgb(75 85 99);
}

.plugin-tab--active {
  color: #ec4141;
  font-weight: 500;
}

.plugin-tab--active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: #ec4141;
  content: '';
}

.plugin-tab__count {
  color: rgb(156 163 175);
  font-size: 0.625rem;
}

.plugin-tab--active .plugin-tab__count {
  color: rgb(248 113 113);
}

:global(.dark) .plugin-tab:hover {
  color: rgb(229 231 235);
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 999px;
  background: #ec4141;
  padding: 0.58rem 1.15rem;
  color: white;
  font-size: 0.8125rem;
  font-weight: 500;
  transition: background 160ms ease, transform 160ms ease;
}

.primary-button:hover:not(:disabled) {
  background: #d63a3a;
  transform: translateY(-1px);
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.candidate-row {
  transition: background 160ms ease;
}

.candidate-row:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.035);
}

.candidate-row:disabled {
  cursor: wait;
}

:global(.dark) .candidate-row:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.045);
}

.lyrics-modal-enter-active,
.lyrics-modal-leave-active {
  transition: opacity 200ms ease;
}

.lyrics-modal-enter-active .lyrics-replacement-card,
.lyrics-modal-leave-active .lyrics-replacement-card {
  transition: opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lyrics-modal-enter-from,
.lyrics-modal-leave-to {
  opacity: 0;
}

.lyrics-modal-enter-from .lyrics-replacement-card,
.lyrics-modal-leave-to .lyrics-replacement-card {
  opacity: 0;
  transform: translateY(12px) scale(0.975);
}

.lyrics-method-enter-active,
.lyrics-method-leave-active {
  transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lyrics-method-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.lyrics-method-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
