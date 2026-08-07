<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '../../composables/toast';
import { useSettingsStore } from '../../features/settings/store';
import { libraryApi } from '../../services/tauri/libraryApi';

const toast = useToast();
const settingsStore = useSettingsStore();

const props = defineProps<{
  targetPath: string;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'restart'): void;
  (e: 'close'): void;
  (e: 'preview-change', payload: {
    targetPath: string;
    isRefreshing: boolean;
    refreshed: boolean;
  }): void;
}>();

const isRefreshing = ref(false);
const refreshed = ref(false);

watch(
  [() => props.targetPath, isRefreshing, refreshed],
  () => {
    emit('preview-change', {
      targetPath: props.targetPath,
      isRefreshing: isRefreshing.value,
      refreshed: refreshed.value,
    });
  },
  { immediate: true },
);

const handleRefresh = async () => {
  if (!props.targetPath) {
    toast.showToast('没有目标文件夹', 'error');
    return;
  }

  isRefreshing.value = true;

  try {
    await libraryApi.refreshFolderSongs(
      props.targetPath,
      settingsStore.settings.libraryMinDurationSeconds,
    );
    toast.showToast('歌曲信息已刷新', 'success');
    refreshed.value = true;
  } catch (error) {
    console.error(error);
    toast.showToast(`刷新失败: ${error}`, 'error');
  } finally {
    isRefreshing.value = false;
  }
};
</script>

<template>
  <div class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div v-if="refreshed" class="space-y-6">
      <div class="text-center py-6">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-4xl text-emerald-400">
          ✓
        </div>
        <h3 class="text-xl font-bold text-gray-800 dark:text-white">流程已完成</h3>
        <p class="mt-2 text-sm text-gray-500 dark:text-white/50">当前目标文件夹已经完成刷新，可以直接开始下一轮整理。</p>
      </div>

      <div class="flex gap-3 border-t border-white/6 pt-4">
        <button
          type="button"
          class="flex-1 rounded-xl border border-white/10 bg-transparent px-6 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5"
          @click="emit('restart')"
        >
          处理另一个文件夹
        </button>
        <button
          type="button"
          class="flex-1 rounded-xl bg-[#EC4141] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#d63a3a]"
          @click="emit('close')"
        >
          完成
        </button>
      </div>
    </div>

    <div v-else class="space-y-6">
      <section class="toolbox-notice-card toolbox-notice-card--amber">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-base font-bold text-white">4</div>
          <div>
            <h3 class="text-sm font-semibold text-amber-200">完成前刷新音乐库</h3>
            <p class="mt-1 text-xs leading-5 text-amber-300/80">
              这一步会重新扫描目标文件夹，让工具箱刚刚处理过的结果立即反映到软件音乐库中。
            </p>
          </div>
        </div>
      </section>

      <section class="toolbox-field-card">
        <div class="text-sm font-semibold text-gray-800 dark:text-white">当前目标文件夹</div>
        <div class="mt-3 rounded-lg border border-dashed border-white/12 bg-black/15 px-4 py-3 text-sm text-gray-300">
          <span class="break-all">{{ targetPath }}</span>
        </div>
      </section>

      <button
        type="button"
        class="flex w-full items-center justify-center gap-3 rounded-xl bg-white/6 border border-white/8 px-6 py-4 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!targetPath || isRefreshing"
        @click="handleRefresh"
      >
        <svg v-if="isRefreshing" class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ isRefreshing ? '刷新中...' : '刷新歌曲信息' }}
      </button>

      <div class="flex gap-3 border-t border-white/6 pt-4">
        <button
          type="button"
          class="flex-1 rounded-xl border border-white/10 bg-transparent px-6 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5"
          @click="emit('back')"
        >
          返回上一步
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbox-notice-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.toolbox-notice-card--amber {
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.08);
}

.toolbox-field-card {
  padding: 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
