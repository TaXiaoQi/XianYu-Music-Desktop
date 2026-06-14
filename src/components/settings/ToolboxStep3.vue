<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../composables/toast';

interface RenamePreview {
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
  (e: 'back'): void;
  (e: 'preview-change', payload: {
    targetPath: string;
    template: string;
    isScanning: boolean;
    hasScanned: boolean;
    items: Array<{
      originalName: string;
      newName: string;
    }>;
    skippedCount: number;
  }): void;
}>();

const TOOLBOX_TEMPLATE_KEY = 'toolbox_default_template';
const customTemplate = ref('{title} - {artist}');
const isScanning = ref(false);
const isApplying = ref(false);
const previewItems = ref<RenamePreview[]>([]);
const hasScanned = ref(false);

const presets = [
  { label: '歌名 - 歌手', example: '七里香 - 周杰伦', value: '{title} - {artist}' },
  { label: '歌手 - 歌名', example: '周杰伦 - 七里香', value: '{artist} - {title}' },
  { label: '轨道. 歌名', example: '01. 七里香', value: '{track}. {title}' },
];

const variables = [
  { code: '{title}', name: '标题' },
  { code: '{artist}', name: '歌手' },
  { code: '{album}', name: '专辑' },
  { code: '{year}', name: '年份' },
  { code: '{track}', name: '轨道号' },
];

onMounted(() => {
  const saved = localStorage.getItem(TOOLBOX_TEMPLATE_KEY);
  if (saved) {
    customTemplate.value = saved;
  }
});

const setAsDefault = () => {
  localStorage.setItem(TOOLBOX_TEMPLATE_KEY, customTemplate.value);
  toast.showToast('已设为默认模板', 'success');
};

const insertVariable = (variable: string) => {
  customTemplate.value += variable;
};

const validItems = computed(() =>
  previewItems.value.filter((item) => item.status === 'tags' && !item.error),
);

const skippedItems = computed(() =>
  previewItems.value.filter((item) => item.status === 'skipped'),
);

const emitPreview = () => {
  emit('preview-change', {
    targetPath: props.targetPath,
    template: customTemplate.value,
    isScanning: isScanning.value,
    hasScanned: hasScanned.value,
    items: validItems.value.map((item) => ({
      originalName: item.original_name,
      newName: item.new_name,
    })),
    skippedCount: skippedItems.value.length,
  });
};

watch(
  [() => props.targetPath, customTemplate, isScanning, hasScanned, validItems, skippedItems],
  emitPreview,
  { immediate: true, deep: true },
);

const handleScan = async () => {
  if (!props.targetPath) {
    return;
  }

  isScanning.value = true;

  try {
    const config = {
      mode: 'tags',
      template: customTemplate.value,
      remove_track_prefix: false,
      remove_source_prefix: false,
    };

    const result = await invoke<RenamePreview[]>('preview_rename', {
      rootPath: props.targetPath,
      config,
    });

    previewItems.value = result;
    hasScanned.value = true;
  } catch (error) {
    console.error(error);
    toast.showToast(`扫描失败: ${error}`, 'error');
  } finally {
    isScanning.value = false;
  }
};

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
    toast.showToast(`成功重命名 ${count} 个文件`, 'success');
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


    <section class="space-y-4 rounded-3xl border border-slate-200/70 bg-slate-50/75 p-5 dark:border-white/10 dark:bg-white/5">
      <label class="text-sm font-semibold text-slate-900 dark:text-white">命名模板</label>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="preset in presets"
          :key="preset.value"
          @click="customTemplate = preset.value"
          class="rounded-xl border px-3 py-2 text-xs font-medium transition"
          :class="
            customTemplate === preset.value
              ? 'border-[#EC4141] bg-[#EC4141] text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
          "
        >
          {{ preset.label }}
          <span class="ml-1 opacity-60">({{ preset.example }})</span>
        </button>
      </div>

      <div class="flex gap-3">
        <input
          v-model="customTemplate"
          type="text"
          placeholder="输入自定义模板..."
          class="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#EC4141] dark:border-white/10 dark:bg-black/20 dark:text-slate-100"
        />
        <button
          @click="setAsDefault"
          :disabled="!customTemplate"
          class="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-40 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20"
        >
          设为默认
        </button>
      </div>

      <div class="space-y-2">
        <div class="text-xs font-medium text-slate-600 dark:text-white/60">点击变量插入到模板末尾</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="variable in variables"
            :key="variable.code"
            @click="insertVariable(variable.code)"
            class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs transition hover:border-[#EC4141] dark:border-white/10 dark:bg-white/5"
          >
            <span class="font-mono font-bold text-slate-700 dark:text-slate-300">{{ variable.code }}</span>
            <span class="ml-1 text-slate-400">{{ variable.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <button
      @click="handleScan"
      :disabled="!props.targetPath || isScanning"
      class="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/20"
    >
      <svg v-if="isScanning" class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {{ isScanning ? '扫描中...' : hasScanned ? '重新扫描' : '扫描并预览' }}
    </button>

    <div class="flex gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
      <button
        @click="emit('back')"
        class="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
      >
        返回上一步
      </button>
      <button
        @click="handleApply"
        :disabled="isApplying || !hasScanned"
        class="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#EC4141] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg v-if="isApplying" class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ validItems.length > 0 ? `应用重命名 (${validItems.length})` : '继续下一步' }}
      </button>
    </div>
  </div>
</template>
