<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePluginsStore } from '../../features/plugins/store';
import type { Playlist } from '../../types';

type TabType = 'create' | 'import';

const props = defineProps<{
  visible: boolean;
  playlists: Playlist[];
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'create', name: string): void;
  (event: 'import', payload: { pluginId: string; playlistInput: string; rename?: string }): void;
}>();

const pluginsStore = usePluginsStore();
const { enabledPlugins, activePluginId } = storeToRefs(pluginsStore);

const activeTab = ref<TabType>('create');
const isClosing = ref(false);

// 新建歌单
const createName = ref('');
const createInputRef = ref<HTMLInputElement | null>(null);

// 导入歌单
const importInput = ref('');
const importInputRef = ref<HTMLInputElement | null>(null);
const pluginDropdownOpen = ref(false);
const importRename = ref('');
const importRenameRef = ref<HTMLInputElement | null>(null);

const tabs: { type: TabType; label: string }[] = [
  { type: 'create', label: '新建歌单' },
  { type: 'import', label: '导入歌单' },
];

const currentPluginName = computed(() => {
  const plugin = enabledPlugins.value.find(p => p.id === activePluginId.value);
  return plugin?.name ?? '请选择插件';
});

// 弹窗打开时重置状态
watch(() => props.visible, async (val) => {
  if (val) {
    createName.value = '';
    importInput.value = '';
    importRename.value = '';
    pluginDropdownOpen.value = false;
    await pluginsStore.loadPlugins();
    await nextTick();
    focusCurrentTab();
  } else {
    isClosing.value = false;
  }
});

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

const handleSelectPlugin = (id: string) => {
  pluginsStore.setActivePlugin(id);
  pluginDropdownOpen.value = false;
};

const handleClose = () => {
  isClosing.value = true;
  setTimeout(() => {
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleConfirm = () => {
  if (activeTab.value === 'create') {
    if (!createName.value.trim()) return;
    isClosing.value = true;
    setTimeout(() => {
      emit('create', createName.value.trim());
      emit('update:visible', false);
      isClosing.value = false;
    }, 200);
  } else if (activeTab.value === 'import') {
    const pluginId = activePluginId.value;
    if (!importInput.value.trim() || !pluginId) return;
    const rename = importRename.value.trim();
    isClosing.value = true;
    setTimeout(() => {
      emit('import', {
        pluginId,
        playlistInput: importInput.value.trim(),
        rename: rename.length > 0 ? rename : undefined,
      });
      emit('update:visible', false);
      isClosing.value = false;
    }, 200);
  }
};

const canConfirm = computed(() => {
  if (activeTab.value === 'create') return createName.value.trim().length > 0;
  if (activeTab.value === 'import') return importInput.value.trim().length > 0 && !!activePluginId.value;
  return false;
});

const confirmText = computed(() => {
  if (activeTab.value === 'create') return '创建';
  return '导入';
});

const handleKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  if (e.key === 'Escape') {
    handleClose();
  } else if (e.key === 'Enter' && !pluginDropdownOpen.value) {
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
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)"
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
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">来源插件</label>
                <div class="relative">
                  <button
                    type="button"
                    class="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:border-[#EC4141]/40 focus:outline-none focus:ring-2 focus:ring-[#EC4141]/30 transition-all"
                    @click="pluginDropdownOpen = !pluginDropdownOpen"
                  >
                    <span class="text-sm font-medium">{{ currentPluginName }}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 transition-transform" :class="{ 'rotate-180': pluginDropdownOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <Transition name="dropdown">
                    <div
                      v-if="pluginDropdownOpen"
                      class="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto"
                    >
                      <button
                        v-for="plugin in enabledPlugins"
                        :key="plugin.id"
                        type="button"
                        class="block w-full text-left px-4 py-2.5 text-sm transition-colors"
                        :class="activePluginId === plugin.id
                          ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10 font-medium'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5'"
                        @click="handleSelectPlugin(plugin.id)"
                      >
                        {{ plugin.name }}
                      </button>
                    </div>
                  </Transition>
                </div>
              </div>
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单 ID 或链接</label>
                <input
                  ref="importInputRef"
                  v-model="importInput"
                  type="text"
                  placeholder="粘贴歌单链接或输入 ID"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm"
                />
              </div>
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单重命名 <span class="text-gray-400 dark:text-gray-500 font-normal">（可选）</span></label>
                <input
                  ref="importRenameRef"
                  v-model="importRename"
                  type="text"
                  placeholder="导入后给歌单起个新名字"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm"
                />
              </div>
            </div>
          </Transition>
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button
            @click="handleConfirm"
            :disabled="!canConfirm"
            class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ confirmText }}
          </button>
          <button
            @click="handleClose"
            class="w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm transition-all duration-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}

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

/* 下拉菜单动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
