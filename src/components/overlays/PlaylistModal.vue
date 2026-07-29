<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { Loader2 } from 'lucide-vue-next';
import type { Playlist } from '../../types';
import { PLAYLIST_SOURCES, importPlaylist } from '../../services/playlistImport';
import type { PlaylistImportResult } from '../../services/playlistImport';
import { useToast } from '../../composables/toast';

type TabType = 'create' | 'import';

const props = defineProps<{
  visible: boolean;
  playlists: Playlist[];
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'create', name: string): void;
  (
    event: 'import',
    payload: { result: PlaylistImportResult; rename?: string },
  ): void;
}>();

const { showToast } = useToast();

const activeTab = ref<TabType>('create');
const isClosing = ref(false);

// 新建歌单
const createName = ref('');
const createInputRef = ref<HTMLInputElement | null>(null);

// 导入歌单
const importInput = ref('');
const importInputRef = ref<HTMLInputElement | null>(null);
const selectedSource = ref<string>('auto');
const sourceDropdownOpen = ref(false);
const importRename = ref('');
const importRenameRef = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importError = ref('');

const tabs: { type: TabType; label: string }[] = [
  { type: 'create', label: '新建歌单' },
  { type: 'import', label: '导入歌单' },
];

// 弹窗打开时重置状态
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      createName.value = '';
      importInput.value = '';
      importRename.value = '';
      importError.value = '';
      importing.value = false;
      selectedSource.value = 'auto';
      sourceDropdownOpen.value = false;
      await nextTick();
      focusCurrentTab();
    } else {
      isClosing.value = false;
    }
  },
);

// 切换 tab 时聚焦对应输入框
watch(activeTab, async () => {
  await nextTick();
  focusCurrentTab();
});

const focusCurrentTab = () => {
  if (activeTab.value === 'create' && createInputRef.value) {
    createInputRef.value.focus();
  } else if (activeTab.value === 'import' && importInputRef.value) {
    importInputRef.value.focus();
  }
};

const handleSelectSource = (key: string) => {
  selectedSource.value = key;
  sourceDropdownOpen.value = false;
  importError.value = '';
};

const handleClose = () => {
  if (importing.value) return; // 导入中不允许关闭
  isClosing.value = true;
  setTimeout(() => {
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleConfirm = async () => {
  if (activeTab.value === 'create') {
    if (!createName.value.trim()) return;
    isClosing.value = true;
    setTimeout(() => {
      emit('create', createName.value.trim());
      emit('update:visible', false);
      isClosing.value = false;
    }, 200);
  } else if (activeTab.value === 'import') {
    if (!importInput.value.trim() || importing.value) return;
    importError.value = '';
    importing.value = true;

    try {
      const result = await importPlaylist(selectedSource.value, importInput.value.trim());
      if (result.songs.length === 0) {
        importError.value = '导入失败或歌单为空，请检查链接是否正确';
        showToast('导入失败或歌单为空', 'error');
      } else {
        const rename = importRename.value.trim();
        showToast(`成功导入 ${result.songs.length} 首歌曲`, 'success');
        isClosing.value = true;
        setTimeout(() => {
          emit('import', {
            result,
            rename: rename.length > 0 ? rename : undefined,
          });
          emit('update:visible', false);
          isClosing.value = false;
        }, 200);
      }
    } catch (e: any) {
      importError.value = `导入失败: ${e?.message || e}`;
      showToast(`导入失败: ${e?.message || e}`, 'error');
    } finally {
      importing.value = false;
    }
  }
};

const canConfirm = computed(() => {
  if (activeTab.value === 'create') return createName.value.trim().length > 0;
  if (activeTab.value === 'import') return importInput.value.trim().length > 0 && !importing.value;
  return false;
});

const confirmText = computed(() => {
  if (activeTab.value === 'create') return '创建';
  if (importing.value) return '导入中…';
  return '导入';
});

const handleKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  if (e.key === 'Escape' && !importing.value) {
    handleClose();
  } else if (e.key === 'Enter' && !sourceDropdownOpen.value && !importing.value) {
    handleConfirm();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{ 'pointer-events-none': isClosing }"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- Modal Card -->
      <div
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-300"
        style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Tab 头部 -->
        <div class="relative px-6 pt-5 pb-0 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-6">
            <button
              v-for="tab in tabs"
              :key="tab.type"
              type="button"
              class="relative pb-3 text-sm font-medium transition-colors"
              :class="activeTab === tab.type
                ? 'text-[#EC4141]'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
              @click="activeTab = tab.type"
            >
              {{ tab.label }}
              <span
                class="absolute left-0 right-0 -bottom-px h-[2px] bg-[#EC4141] rounded-full transition-all duration-300 ease-out"
                :class="activeTab === tab.type ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
              ></span>
            </button>
          </div>
        </div>

        <!-- 内容区域（带过渡动画） -->
        <div class="relative px-6 py-5 min-h-[140px]">
          <Transition name="tab-fade" mode="out-in">
            <!-- 新建歌单 -->
            <div v-if="activeTab === 'create'" key="create" class="space-y-2">
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单名称</label>
              <input
                ref="createInputRef"
                v-model="createName"
                type="text"
                placeholder="请输入歌单名称"
                class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm"
              />
            </div>

            <!-- 导入歌单 -->
            <div v-else-if="activeTab === 'import'" key="import" class="space-y-3">
              <!-- 音源选择 -->
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">选择音源</label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="src in PLAYLIST_SOURCES"
                    :key="src.key"
                    type="button"
                    class="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    :class="selectedSource === src.key
                      ? 'bg-[#EC4141] text-white'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                    @click="handleSelectSource(src.key)"
                  >
                    {{ src.name }}
                  </button>
                </div>
              </div>

              <!-- 歌单链接 -->
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单链接或 ID</label>
                <input
                  ref="importInputRef"
                  v-model="importInput"
                  type="text"
                  :disabled="importing"
                  placeholder="粘贴歌单分享链接或输入歌单 ID"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <!-- 重命名 -->
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                  歌单重命名 <span class="text-gray-400 dark:text-gray-500 font-normal">（可选）</span>
                </label>
                <input
                  ref="importRenameRef"
                  v-model="importRename"
                  type="text"
                  :disabled="importing"
                  placeholder="导入后给歌单起个新名字"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <!-- 提示文本 -->
              <div class="text-xs text-gray-400 dark:text-white/40 leading-relaxed">
                打开对应平台 App，找到想导入的歌单，点击分享并复制链接，粘贴到上方输入框即可一键导入。仅支持公开歌单。
              </div>

              <!-- 错误提示 -->
              <div
                v-if="importError"
                class="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs"
              >
                <span>{{ importError }}</span>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button
            @click="handleConfirm"
            :disabled="!canConfirm"
            class="w-full inline-flex justify-center items-center gap-2 rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Loader2 v-if="importing" class="h-4 w-4 animate-spin" />
            {{ confirmText }}
          </button>
          <button
            @click="handleClose"
            :disabled="importing"
            class="w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm transition-all duration-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Tab 内容切换动画 */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.tab-fade-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.tab-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
