<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useToast } from '../../composables/toast';
import { fileApi } from '../../services/tauri/fileApi';
import type { Song } from '../../types';
import ToolboxStep1 from './ToolboxStep1.vue';
import ToolboxStep2 from './ToolboxStep2.vue';
import ToolboxStep3 from './ToolboxStep3.vue';
import ToolboxStep4 from './ToolboxStep4.vue';

type ToolboxView = 'setup' | 'preprocess' | 'tagging' | 'rename' | 'refresh';

interface ProgressStep {
  key: ToolboxView;
  label: string;
}

interface PreviewListItem {
  originalName: string;
  newName: string;
}

interface PreprocessDisplayItem {
  originalName: string;
  newName: string;
  changed: boolean;
}

const toast = useToast();

const MUSICTAG_PATH_KEY = 'toolbox_musictag_path';

const currentView = ref<ToolboxView>('setup');
const targetPath = ref('');
const musicTagPath = ref('');

const progressSteps: ProgressStep[] = [
  { key: 'setup', label: '预设' },
  { key: 'preprocess', label: '预处理' },
  { key: 'tagging', label: '编辑标签' },
  { key: 'rename', label: '重命名' },
  { key: 'refresh', label: '完成' },
];

const preprocessPreview = ref({
  targetPath: '',
  isScanning: false,
  hasScanned: false,
  removeTrackPrefix: true,
  items: [] as PreviewListItem[],
});

const taggingPreview = ref({
  targetPath: '',
  musicTagPath: '',
  isLaunching: false,
  hasLaunched: false,
});

const renamePreview = ref({
  targetPath: '',
  template: '{title} - {artist}',
  isScanning: false,
  hasScanned: false,
  items: [] as PreviewListItem[],
  skippedCount: 0,
});

const refreshPreview = ref({
  targetPath: '',
  isRefreshing: false,
  refreshed: false,
});

const targetFolderSongs = ref<Song[]>([]);
const isLoadingSongs = ref(false);

watch(
  () => targetPath.value,
  async (newPath) => {
    if (!newPath) {
      targetFolderSongs.value = [];
      return;
    }

    isLoadingSongs.value = true;
    try {
      targetFolderSongs.value = await fileApi.scanMusicFolder(newPath);
    } catch (error) {
      console.error('Failed to scan songs:', error);
      toast.showToast(`加载歌曲失败: ${error}`, 'error');
      targetFolderSongs.value = [];
    } finally {
      isLoadingSongs.value = false;
    }
  },
);

const canStart = computed(() => Boolean(targetPath.value && musicTagPath.value));
const currentProgressIndex = computed(() =>
  progressSteps.findIndex((step) => step.key === currentView.value),
);
const setupReadyCount = computed(
  () => Number(Boolean(musicTagPath.value)) + Number(Boolean(targetPath.value)),
);

const getPathLeaf = (path: string) => {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '未选择';
};

const preprocessDisplayItems = computed<PreprocessDisplayItem[]>(() => {
  const changedMap = new Map(
    preprocessPreview.value.items.map((item) => [item.originalName, item.newName]),
  );

  if (targetFolderSongs.value.length > 0) {
    return targetFolderSongs.value.map((song) => {
      const originalName = getPathLeaf(song.path);
      const changedName = changedMap.get(originalName);

      return {
        originalName,
        newName: changedName ?? originalName,
        changed: Boolean(changedName && changedName !== originalName),
      };
    });
  }

  return preprocessPreview.value.items.map((item) => ({
    originalName: item.originalName,
    newName: item.newName,
    changed: item.originalName !== item.newName,
  }));
});

const preprocessChangedCount = computed(
  () => preprocessDisplayItems.value.filter((item) => item.changed).length,
);

onMounted(() => {
  const savedMusicTagPath = localStorage.getItem(MUSICTAG_PATH_KEY);

  if (savedMusicTagPath) {
    musicTagPath.value = savedMusicTagPath;
  }
});

const selectExecutable = async () => {
  try {
    const selected = await open({
      multiple: false,
      title: '选择 MusicTag 可执行文件',
      filters: [{ name: '可执行文件', extensions: ['exe'] }],
    });

    if (!selected || typeof selected !== 'string') {
      return;
    }

    musicTagPath.value = selected;
    localStorage.setItem(MUSICTAG_PATH_KEY, selected);
    toast.showToast('MusicTag 路径已保存', 'success');
  } catch (error) {
    console.error(error);
    toast.showToast(`选择路径失败: ${error}`, 'error');
  }
};

const selectTargetFolder = async () => {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择要整理的目标文件夹',
    });

    if (selected && typeof selected === 'string') {
      targetPath.value = selected;
    }
  } catch (error) {
    console.error(error);
    toast.showToast(`选择文件夹失败: ${error}`, 'error');
  }
};

const resetPreviewState = () => {
  preprocessPreview.value = {
    targetPath: '',
    isScanning: false,
    hasScanned: false,
    removeTrackPrefix: true,
    items: [],
  };
  taggingPreview.value = {
    targetPath: '',
    musicTagPath: '',
    isLaunching: false,
    hasLaunched: false,
  };
  renamePreview.value = {
    targetPath: '',
    template: '{title} - {artist}',
    isScanning: false,
    hasScanned: false,
    items: [],
    skippedCount: 0,
  };
  refreshPreview.value = {
    targetPath: '',
    isRefreshing: false,
    refreshed: false,
  };
};

const startFlow = () => {
  if (!canStart.value) {
    toast.showToast('请先选择 MusicTag 和目标文件夹', 'error');
    return;
  }

  currentView.value = 'preprocess';
};

const nextStep = () => {
  if (currentView.value === 'preprocess') {
    currentView.value = 'tagging';
    return;
  }

  if (currentView.value === 'tagging') {
    currentView.value = 'rename';
    return;
  }

  if (currentView.value === 'rename') {
    currentView.value = 'refresh';
  }
};

const prevStep = () => {
  if (currentView.value === 'tagging') {
    currentView.value = 'preprocess';
    return;
  }

  if (currentView.value === 'rename') {
    currentView.value = 'tagging';
    return;
  }

  if (currentView.value === 'refresh') {
    currentView.value = 'rename';
  }
};

const restart = () => {
  currentView.value = 'setup';
  targetPath.value = '';
  resetPreviewState();
};
</script>

<template>
  <div class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="w-full px-5 py-5">
      <div class="grid items-start gap-y-3 [grid-template-columns:repeat(4,minmax(0,1fr)_88px)_minmax(0,1fr)]">
        <template v-for="(step, index) in progressSteps" :key="step.key">
          <div class="flex flex-col items-center gap-3">
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-sm font-semibold transition"
              :class="
                index < currentProgressIndex
                  ? 'border-[#EC4141] bg-[#EC4141] text-white shadow-[0_10px_24px_-16px_rgba(236,65,65,0.9)]'
                  : index === currentProgressIndex
                  ? 'border-[#EC4141]/30 bg-[#EC4141]/10 text-[#EC4141]'
                  : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-500'
              "
            >
              <span v-if="index < currentProgressIndex">✓</span>
              <span v-else>{{ index + 1 }}</span>
            </div>

            <div
              class="text-center text-xs font-medium transition"
              :class="
                index <= currentProgressIndex
                  ? 'text-slate-800 dark:text-white'
                  : 'text-slate-500 dark:text-white/50'
              "
            >
              {{ step.label }}
            </div>
          </div>

          <div
            v-if="index < progressSteps.length - 1"
            class="mt-5 h-1 rounded-full transition"
            :class="
              index < currentProgressIndex
                ? 'bg-[#EC4141]'
                : 'bg-slate-200 dark:bg-white/10'
            "
          ></div>
        </template>
      </div>
    </section>

    <section
      v-if="currentView !== 'setup' && targetPath"
      class="px-6"
    >
      <div class="rounded-[28px] border border-white/40 bg-white/55 px-6 py-2 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-white/70">
          <span class="text-[15px] font-semibold text-slate-900 dark:text-white">当前文件夹路径</span>
          <span class="break-all">{{ targetPath }}</span>
        </div>
      </div>
    </section>

    <div
      v-if="currentView === 'setup'"
      class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]"
    >
      <section class="space-y-4 p-7">
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          基础配置
        </h2>

        <div class="flex flex-col overflow-hidden rounded-xl border border-white/30 bg-white/40 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
          <div class="border-b border-white/30 p-5 transition-colors dark:border-white/5">
            <div class="mb-3 flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200">MusicTag 路径</div>
                <div class="mt-0.5 text-xs text-gray-600 dark:text-white/60">用于歌曲标签写入和人工校对。</div>
              </div>
              <button
                @click="selectExecutable"
                class="shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
              >
                选择路径
              </button>
            </div>
            <div class="rounded-lg border border-dashed border-gray-300 bg-white/50 px-4 py-3 text-xs text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-white/60">
              <span v-if="musicTagPath" class="break-all text-slate-700 dark:text-slate-200">{{ musicTagPath }}</span>
              <span v-else>请选择 MusicTag.exe</span>
            </div>
          </div>

          <div class="p-5 transition-colors">
            <div class="mb-3 flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200">目标文件夹</div>
                <div class="mt-0.5 text-xs text-gray-600 dark:text-white/60">这里决定本次要处理的整批歌曲文件。</div>
              </div>
              <button
                @click="selectTargetFolder"
                class="shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
              >
                选择文件夹
              </button>
            </div>
            <div class="rounded-lg border border-dashed border-gray-300 bg-white/50 px-4 py-3 text-xs text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-white/60">
              <span v-if="targetPath" class="break-all text-slate-700 dark:text-slate-200">{{ targetPath }}</span>
              <span v-else>请选择要整理的歌曲目录</span>
            </div>
          </div>
        </div>

        <div class="pt-4">
          <button
            @click="startFlow"
            :disabled="!canStart"
            class="rounded-xl bg-[#EC4141] px-8 py-3 text-sm font-medium text-white shadow-[0_12px_24px_-12px_rgba(236,65,65,0.6)] transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            开始流程
          </button>
        </div>
      </section>

      <aside class="xl:sticky xl:top-6 xl:self-start">
        <section class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-slate-900 dark:text-white">实时预览</h3>
            </div>
            <div class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {{ setupReadyCount }}/2
            </div>
          </div>

          <div class="mt-5 space-y-4">
            <div
              v-if="!targetPath"
              class="rounded-2xl border border-white/30 bg-white/40 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
            >
              请先在左侧选择目标文件夹，这里会显示该文件夹下所有支持的音频文件。
            </div>

            <div
              v-else-if="isLoadingSongs"
              class="flex items-center justify-center gap-3 rounded-2xl border border-white/30 bg-white/40 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
            >
              <svg class="h-5 w-5 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>正在扫描文件夹...</span>
            </div>

            <div
              v-else-if="targetFolderSongs.length === 0"
              class="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-6 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            >
              该文件夹下没有找到支持的音频文件。
            </div>

            <div
              v-else
              class="overflow-hidden rounded-2xl border border-white/30 bg-white/40 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-black/20"
            >
              <div class="flex justify-between border-b border-white/30 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-white/5 dark:text-white">
                <span>歌曲预览</span>
                <span class="text-xs font-normal text-slate-500 dark:text-slate-400">共 {{ targetFolderSongs.length }} 首</span>
              </div>
              <div class="max-h-[420px] overflow-y-auto">
                <div
                  v-for="song in targetFolderSongs"
                  :key="song.path"
                  class="flex items-center gap-3 border-b border-slate-100/50 px-4 py-3 text-sm last:border-b-0 dark:border-white/5"
                >
                  <div class="truncate text-slate-700 dark:text-slate-300">{{ getPathLeaf(song.path) }}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <div
      v-else
      :class="
        currentView === 'tagging'
          ? 'px-6'
          : 'grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]'
      "
    >
      <section :class="currentView === 'tagging' ? 'max-w-[520px] p-6' : 'p-6'">
        <ToolboxStep1
          v-if="currentView === 'preprocess'"
          :target-path="targetPath"
          @next="nextStep"
          @skip="nextStep"
          @preview-change="preprocessPreview = $event"
        />

        <ToolboxStep2
          v-else-if="currentView === 'tagging'"
          :target-path="targetPath"
          :music-tag-path="musicTagPath"
          @back="prevStep"
          @next="nextStep"
          @preview-change="taggingPreview = $event"
        />

        <ToolboxStep3
          v-else-if="currentView === 'rename'"
          :target-path="targetPath"
          @back="prevStep"
          @next="nextStep"
          @preview-change="renamePreview = $event"
        />

        <ToolboxStep4
          v-else-if="currentView === 'refresh'"
          :target-path="targetPath"
          @back="prevStep"
          @restart="restart"
          @close="restart"
          @preview-change="refreshPreview = $event"
        />
      </section>

      <aside
        v-if="currentView !== 'tagging'"
        class="xl:sticky xl:top-6 xl:self-start"
      >
        <section class="p-6">
          <template v-if="currentView === 'preprocess'">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white">实时预览</h3>
              </div>
              <div class="text-sm font-medium text-slate-600 dark:text-white/60">
                已扫描 {{ preprocessDisplayItems.length }} 首歌曲，发生变化 {{ preprocessChangedCount }} 首。
              </div>
            </div>

            <div class="mt-5">
              <div class="overflow-hidden rounded-[32px] border border-white/30 bg-white/45 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-black/20">
                <div class="grid grid-cols-[42px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center border-b border-slate-100/80 bg-slate-50/80 px-6 py-4 text-sm font-semibold text-slate-900 dark:border-white/5 dark:bg-white/5 dark:text-white">
                  <span>标记</span>
                  <span>原先的歌曲</span>
                  <span></span>
                  <span>修改后的歌曲</span>
                </div>

                <div
                  v-if="preprocessPreview.isScanning || (!preprocessPreview.hasScanned && isLoadingSongs)"
                  class="flex min-h-[360px] items-center justify-center px-6 py-8 text-sm text-slate-500 dark:text-white/60"
                >
                  正在自动扫描当前文件夹...
                </div>

                <div
                  v-else-if="preprocessDisplayItems.length === 0"
                  class="flex min-h-[360px] items-center justify-center px-6 py-8 text-sm text-slate-500 dark:text-white/60"
                >
                  当前文件夹中没有可显示的歌曲。
                </div>

                <div v-else class="max-h-[520px] overflow-y-auto px-3 py-3">
                  <div
                    v-for="item in preprocessDisplayItems"
                    :key="`${item.originalName}-${item.newName}`"
                    class="grid grid-cols-[42px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 py-4 text-sm transition odd:bg-white/40 dark:odd:bg-white/[0.03]"
                  >
                    <div class="flex items-center justify-center">
                      <span
                        class="text-lg leading-none"
                        :class="item.changed ? 'text-amber-400' : 'text-slate-400 dark:text-slate-500'"
                      >
                        ★
                      </span>
                    </div>
                    <div class="truncate font-medium text-slate-600 dark:text-white/65">{{ item.originalName }}</div>
                    <div class="flex items-center justify-center text-sky-500 dark:text-sky-300">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 12h14m-5-5 5 5-5 5" />
                      </svg>
                    </div>
                    <div class="truncate font-semibold text-slate-900 dark:text-white">{{ item.newName }}</div>
                  </div>
                </div>
              </div>

            </div>
          </template>

          <template v-else-if="currentView === 'rename'">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white">实时预览</h3>
              </div>
              <div class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {{ renamePreview.items.length }} 项
              </div>
            </div>

            <div class="mt-5 space-y-4">
              <div
                v-if="renamePreview.isScanning"
                class="rounded-3xl border border-white/30 bg-white/40 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
              >
                正在生成重命名预览，请稍候...
              </div>

              <div
                v-else-if="renamePreview.items.length === 0"
                class="rounded-3xl border border-white/30 bg-white/40 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
              >
                暂无可显示的重命名结果。
              </div>

              <div
                v-else
                class="overflow-hidden rounded-3xl border border-white/30 bg-white/40 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-black/20"
              >
                <div class="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-white/5 dark:text-white">
                  重命名预览
                </div>
                <div class="max-h-[420px] overflow-y-auto">
                  <div
                    v-for="item in renamePreview.items"
                    :key="`${item.originalName}-${item.newName}`"
                    class="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 dark:border-white/5"
                  >
                    <div class="truncate text-slate-600 dark:text-white/60">{{ item.originalName }}</div>
                    <div class="text-center text-slate-300">→</div>
                    <div class="truncate font-medium text-slate-900 dark:text-white">{{ item.newName }}</div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="currentView === 'refresh'">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white">实时预览</h3>
                <p class="mt-1 text-sm text-slate-600 dark:text-white/60">这里显示刷新进度和最终完成状态。</p>
              </div>
              <div
                class="rounded-full px-3 py-1 text-xs font-medium"
                :class="
                  refreshPreview.refreshed
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
                "
              >
                {{ refreshPreview.refreshed ? '已完成' : '待刷新' }}
              </div>
            </div>

            <div class="mt-5 space-y-4">
              <div class="rounded-3xl border border-white/30 bg-white/40 p-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                <div class="text-xs uppercase tracking-[0.18em] text-slate-400">Folder</div>
                <div class="mt-2 break-all text-sm font-medium text-slate-900 dark:text-white">{{ refreshPreview.targetPath || targetPath }}</div>
              </div>

              <div
                class="rounded-3xl border p-5 text-sm"
                :class="
                  refreshPreview.isRefreshing
                    ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                    : refreshPreview.refreshed
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
                "
              >
                <div class="font-semibold">
                  {{
                    refreshPreview.isRefreshing
                      ? '正在刷新音乐库...'
                      : refreshPreview.refreshed
                      ? '音乐库已经更新'
                      : '等待执行最后一步'
                  }}
                </div>
                <p class="mt-2 leading-7">
                  {{
                    refreshPreview.refreshed
                      ? '当前流程已经完成，你可以直接开始处理下一批文件。'
                      : '点击左侧刷新按钮后，这里会显示最终完成状态。'
                  }}
                </p>
              </div>
            </div>
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>
