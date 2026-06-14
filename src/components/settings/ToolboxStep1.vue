<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../composables/toast';

interface CleanPreview {
  original_path: string;
  original_name: string;
  new_name: string;
  status: string;
  error?: string;
}

const toast = useToast();

const props = defineProps<{
  targetPath: string;
}>();

const emit = defineEmits<{
  (e: 'next'): void;
  (e: 'skip'): void;
  (e: 'preview-change', payload: {
    targetPath: string;
    isScanning: boolean;
    hasScanned: boolean;
    removeTrackPrefix: boolean;
    items: Array<{
      originalName: string;
      newName: string;
    }>;
  }): void;
}>();

const isScanning = ref(false);
const isApplying = ref(false);
const hasScanned = ref(false);
const removeTrackPrefix = ref(true);
const previewItems = ref<CleanPreview[]>([]);
let latestScanId = 0;

const validItems = computed(() =>
  previewItems.value.filter((item) => item.status !== 'skipped' && !item.error),
);

const emitPreview = () => {
  emit('preview-change', {
    targetPath: props.targetPath,
    isScanning: isScanning.value,
    hasScanned: hasScanned.value,
    removeTrackPrefix: removeTrackPrefix.value,
    items: validItems.value.map((item) => ({
      originalName: item.original_name,
      newName: item.new_name,
    })),
  });
};

watch(
  [() => props.targetPath, isScanning, hasScanned, removeTrackPrefix, validItems],
  emitPreview,
  { immediate: true, deep: true },
);

const scanPreview = async () => {
  if (!props.targetPath) {
    previewItems.value = [];
    hasScanned.value = false;
    isScanning.value = false;
    return;
  }

  const scanId = ++latestScanId;
  isScanning.value = true;

  try {
    const config = {
      mode: 'rules',
      template: '',
      remove_track_prefix: removeTrackPrefix.value,
      remove_source_prefix: false,
    };

    const result = await invoke<CleanPreview[]>('preview_rename', {
      rootPath: props.targetPath,
      config,
    });

    if (scanId !== latestScanId) {
      return;
    }

    previewItems.value = result;
    hasScanned.value = true;
  } catch (error) {
    if (scanId !== latestScanId) {
      return;
    }

    console.error(error);
    previewItems.value = [];
    hasScanned.value = false;
    toast.showToast(`扫描失败: ${error}`, 'error');
  } finally {
    if (scanId === latestScanId) {
      isScanning.value = false;
    }
  }
};

watch(
  [() => props.targetPath, removeTrackPrefix],
  ([targetPath]) => {
    if (!targetPath) {
      previewItems.value = [];
      hasScanned.value = false;
      isScanning.value = false;
      return;
    }

    void scanPreview();
  },
  { immediate: true },
);

const handleApply = async () => {
  if (validItems.value.length === 0) {
    emit('next');
    return;
  }

  isApplying.value = true;

  try {
    const operations = validItems.value.map((item) => ({
      original_path: item.original_path,
      new_name: item.new_name,
    }));

    const count = await invoke<number>('apply_rename', { operations });
    toast.showToast(`成功处理 ${count} 个文件名`, 'success');
    emit('next');
  } catch (error) {
    console.error(error);
    toast.showToast(`应用修改失败: ${error}`, 'error');
  } finally {
    isApplying.value = false;
  }
};
</script>

<template>
  <div class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-4">
      <h3 class="text-2xl font-semibold text-slate-900 dark:text-white">预处理选项</h3>

      <label class="flex cursor-pointer items-start gap-4 rounded-[28px] border border-slate-200/80 bg-white/70 px-5 py-5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm transition hover:border-sky-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-sky-400/40">
        <input
          v-model="removeTrackPrefix"
          type="checkbox"
          class="mt-1 h-5 w-5 rounded border-slate-300 text-[#EC4141] focus:ring-[#EC4141]"
        />
        <div class="min-w-0">
          <div class="text-lg font-semibold text-slate-900 dark:text-white">去除序号前缀</div>
          <p class="mt-2 text-sm leading-7 text-slate-600 dark:text-white/60">
            <span class="font-medium text-sky-700 dark:text-sky-300">01.song.flac → song.flac</span>
          </p>
        </div>
      </label>


    </section>

    <div class="flex gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
      <button
        @click="emit('skip')"
        class="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
      >
        跳过此步骤
      </button>
      <button
        @click="handleApply"
        :disabled="isApplying || isScanning"
        class="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#EC4141] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg v-if="isApplying" class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{
          isScanning
            ? '正在扫描...'
            : validItems.length > 0
            ? `应用预处理并继续 (${validItems.length})`
            : '继续下一步'
        }}
      </button>
    </div>
  </div>
</template>
