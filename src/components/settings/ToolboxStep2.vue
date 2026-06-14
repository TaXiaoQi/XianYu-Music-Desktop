<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '../../composables/toast';
import { appApi } from '../../services/tauri/appApi';

const toast = useToast();

const props = defineProps<{
  targetPath: string;
  musicTagPath: string;
}>();

const emit = defineEmits<{
  (e: 'next'): void;
  (e: 'back'): void;
  (
    e: 'preview-change',
    payload: {
      targetPath: string;
      musicTagPath: string;
      isLaunching: boolean;
      hasLaunched: boolean;
    },
  ): void;
}>();

const isLaunching = ref(false);
const hasLaunched = ref(false);

const emitPreview = () => {
  emit('preview-change', {
    targetPath: props.targetPath,
    musicTagPath: props.musicTagPath,
    isLaunching: isLaunching.value,
    hasLaunched: hasLaunched.value,
  });
};

watch([() => props.targetPath, () => props.musicTagPath, isLaunching, hasLaunched], emitPreview, {
  immediate: true,
});

const launchMusicTag = async () => {
  if (!props.musicTagPath) {
    toast.showToast('请先返回预设页面配置 MusicTag 路径', 'error');
    return;
  }

  isLaunching.value = true;

  try {
    await appApi.openExternalProgram(props.musicTagPath, props.targetPath ? [props.targetPath] : []);
    hasLaunched.value = true;
    toast.showToast('MusicTag 已启动', 'success');
  } catch (error) {
    console.error(error);
    toast.showToast(`启动失败: ${error}`, 'error');
  } finally {
    isLaunching.value = false;
  }
};
</script>

<template>
  <div class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <button
      @click="launchMusicTag"
      :disabled="!props.musicTagPath || isLaunching"
      class="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-900 px-6 py-4 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
    >
      <svg v-if="isLaunching" class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3h7m0 0v7m0-7L10 14m-4-4H5a2 2 0 00-2 2v7a2 2 0 002 2h7a2 2 0 002-2v-1" />
      </svg>
      {{ isLaunching ? '正在启动...' : '启动 MusicTag' }}
    </button>

    <div class="flex gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
      <button
        @click="emit('back')"
        class="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
      >
        返回上一步
      </button>
      <button
        @click="emit('next')"
        class="flex-1 rounded-2xl bg-[#EC4141] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#d63a3a]"
      >
        标签编辑完成，继续下一步
      </button>
    </div>
  </div>
</template>
