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
import SettingsAudioConvert from './SettingsAudioConvert.vue';
import SettingHint from './SettingHint.vue';

type ToolboxView = 'setup' | 'preprocess' | 'tagging' | 'rename' | 'refresh';

interface ProgressStep {
  key: ToolboxView;
  label: string;
}

/** 工具箱功能卡片：后续新增功能只需向对应分区的 tools 数组追加一项 */
interface ToolboxTool {
  id: string;
  name: string;
  desc: string;
  icon: 'tag' | 'convert';
  /** 是否已实现；未实现时点击给出"即将上线"提示，作为占位展示 */
  available: boolean;
}

/** 工具箱分区卡片 */
interface ToolboxCategory {
  id: string;
  title: string;
  subtitle: string;
  tools: ToolboxTool[];
}

/** 分区数据（数据驱动，后续扩展只需改这里） */
const toolboxCategories: ToolboxCategory[] = [
  {
    id: 'organize',
    title: '音乐整理',
    subtitle: '批量处理本地歌曲的标签、文件名与音乐库刷新',
    tools: [
      {
        id: 'music-tag-flow',
        name: '批处理整理',
        desc: '标签编辑 · 重命名 · 刷新音乐库',
        icon: 'tag',
        available: true,
      },
    ],
  },
  {
    id: 'convert',
    title: '文件转换',
    subtitle: '音频格式转换等工具',
    tools: [
      {
        id: 'format-convert',
        name: '格式转换',
        desc: '音频编码格式转换 · mp3 / flac / wav / ogg 等',
        icon: 'convert',
        available: true,
      },
    ],
  },
];

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

/** 选中的功能 id；null 表示停留在"分区网格"主页，非 null 进入对应功能界面 */
const activeToolId = ref<string | null>(null);

/** 当前选中的分区（顶部按钮切换） */
const activeCategoryId = ref<string>(toolboxCategories[0]?.id ?? '');
/** 当前分区对象（tab 切换后用于渲染其下功能列表） */
const currentCategory = computed(
  () => toolboxCategories.find((c) => c.id === activeCategoryId.value) ?? toolboxCategories[0],
);

const openTool = (tool: ToolboxTool) => {
  if (!tool.available) {
    toast.showToast(`${tool.name} 即将上线，敬请期待`, 'info');
    return;
  }
  if (tool.id === 'music-tag-flow' || tool.id === 'format-convert') {
    activeToolId.value = tool.id;
  }
};

const backToGrid = () => {
  activeToolId.value = null;
  restart();
};

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
  <!-- ===== 工具箱主页（分区 Tab 切换） ===== -->
  <div
    v-if="activeToolId === null"
    class="w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <div class="mb-6 space-y-1">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">工具箱</h1>
      <p class="text-sm text-gray-500 dark:text-white/50">按类别整理的音乐实用工具，功能会持续扩充。</p>
    </div>

    <!-- 分区切换按钮 -->
    <div class="mb-6 flex flex-wrap gap-1 border-b border-black/5 pb-px dark:border-white/10">
      <button
        v-for="category in toolboxCategories"
        :key="category.id"
        type="button"
        class="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
        :class="
          category.id === activeCategoryId
            ? 'border-b-2 border-[#EC4141] text-[#EC4141]'
            : 'text-gray-500 hover:text-gray-800 dark:text-white/50 dark:hover:text-white'
        "
        @click="activeCategoryId = category.id"
      >
        {{ category.title }}
      </button>
    </div>

    <!-- 当前分区下的功能列表 -->
    <div v-if="currentCategory" class="space-y-2">
      <div class="px-5 text-[13px] text-gray-500 dark:text-white/50">{{ currentCategory.subtitle }}</div>

      <button
        v-for="tool in currentCategory.tools"
        :key="tool.id"
        type="button"
        class="toolbox-item group flex w-full items-center gap-4 text-left"
        @click="openTool(tool)"
      >
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
          :class="tool.available
            ? 'bg-[#EC4141]/10 text-[#EC4141] group-hover:bg-[#EC4141] group-hover:text-white'
            : 'bg-white/10 text-gray-400 dark:text-white/30'"
        >
          <!-- 标签图标 -->
          <svg v-if="tool.icon === 'tag'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
          </svg>
          <!-- 转换(循环箭头)图标 -->
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8.5 6 5l3 3.5M6.5 6C6.5 10.5 9 14 13 14" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 15.5 18 19l-3-3.5M17.5 18c0-4.5-2.5-8-6.5-8" />
          </svg>
        </div>

        <div class="min-w-0 flex-1">
          <div class="text-[15px] font-semibold text-gray-900 dark:text-white">{{ tool.name }}</div>
          <div class="mt-0.5 truncate text-[13px] text-gray-500 dark:text-white/45">{{ tool.desc }}</div>
        </div>

        <span
          v-if="!tool.available"
          class="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-gray-400 dark:text-white/35"
        >
          即将上线
        </span>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-[#EC4141] dark:text-white/25"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  </div>

  <!-- ===== 功能界面：音乐整理批处理流程 ===== -->
  <div
    v-else-if="activeToolId === 'music-tag-flow'"
    class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <div class="flex items-center gap-2 px-5">
      <button
        type="button"
        class="toolbox-ghost-btn"
        @click="backToGrid"
      >
        ← 返回工具箱
      </button>
      <span class="text-sm text-gray-500 dark:text-white/50">音乐整理 · 批处理流程</span>
    </div>
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
                  : 'border-white/10 bg-white/5 text-gray-500'
              "
            >
              <span v-if="index < currentProgressIndex">✓</span>
              <span v-else>{{ index + 1 }}</span>
            </div>

            <div
              class="text-center text-xs font-medium transition"
              :class="
                index <= currentProgressIndex
                  ? 'text-gray-800 dark:text-white'
                  : 'text-gray-500 dark:text-white/50'
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
                : 'bg-white/10'
            "
          ></div>
        </template>
      </div>
    </section>

    <section
      v-if="currentView !== 'setup' && targetPath"
      class="px-6"
    >
      <div class="toolbox-item px-5 py-3">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-white/70">
          <span class="text-[15px] font-semibold text-gray-900 dark:text-white">当前文件夹路径</span>
          <span class="break-all">{{ targetPath }}</span>
        </div>
      </div>
    </section>

    <div
      v-if="currentView === 'setup'"
      class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]"
    >
      <section class="toolbox-section space-y-3">
        <h2 class="toolbox-section-title">
          <span class="toolbox-section-bar"></span>
          基础配置
        </h2>

        <div class="toolbox-stack">
          <div class="toolbox-item">
            <div class="mb-3 flex items-center justify-between gap-4">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">MusicTag 路径</div>
              <div class="flex items-center gap-3">
                <SettingHint text="用于歌曲标签写入和人工校对。" />
                <button
                  type="button"
                  class="toolbox-ghost-btn"
                  @click="selectExecutable"
                >
                  选择路径
                </button>
              </div>
            </div>
            <div class="toolbox-path-field">
              <span v-if="musicTagPath" class="break-all text-gray-700 dark:text-gray-200">{{ musicTagPath }}</span>
              <span v-else class="text-gray-500 dark:text-white/45">请选择 MusicTag.exe</span>
            </div>
          </div>

          <div class="toolbox-item">
            <div class="mb-3 flex items-center justify-between gap-4">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">目标文件夹</div>
              <div class="flex items-center gap-3">
                <SettingHint severity="warning" text="这里决定本次要处理的整批歌曲文件。" />
                <button
                  type="button"
                  class="toolbox-ghost-btn"
                  @click="selectTargetFolder"
                >
                  选择文件夹
                </button>
              </div>
            </div>
            <div class="toolbox-path-field">
              <span v-if="targetPath" class="break-all text-gray-700 dark:text-gray-200">{{ targetPath }}</span>
              <span v-else class="text-gray-500 dark:text-white/45">请选择要整理的歌曲目录</span>
            </div>
          </div>
        </div>

        <div class="pt-2">
          <button
            type="button"
            class="rounded-xl bg-[#EC4141] px-8 py-3 text-sm font-medium text-white shadow-[0_12px_24px_-12px_rgba(236,65,65,0.6)] transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!canStart"
            @click="startFlow"
          >
            开始流程
          </button>
        </div>
      </section>

      <aside class="xl:sticky xl:top-6 xl:self-start">
        <section class="toolbox-section space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="toolbox-section-title">
              <span class="toolbox-section-bar"></span>
              实时预览
            </h2>
            <div class="toolbox-chip">
              {{ setupReadyCount }}/2
            </div>
          </div>

          <div
            v-if="!targetPath"
            class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45"
          >
            请先在左侧选择目标文件夹，这里会显示该文件夹下所有支持的音频文件。
          </div>

          <div
            v-else-if="isLoadingSongs"
            class="toolbox-panel toolbox-panel--muted flex items-center justify-center gap-3 text-sm text-gray-500 dark:text-white/45"
          >
            <svg class="h-5 w-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>正在扫描文件夹...</span>
          </div>

          <div
            v-else-if="targetFolderSongs.length === 0"
            class="toolbox-panel border border-amber-200/70 bg-amber-50/80 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
          >
            该文件夹下没有找到支持的音频文件。
          </div>

          <div v-else class="toolbox-list">
            <div class="toolbox-list-header">
              <span>歌曲预览</span>
              <span class="text-xs font-normal text-gray-500 dark:text-white/45">共 {{ targetFolderSongs.length }} 首</span>
            </div>
            <div class="max-h-[420px] overflow-y-auto">
              <div
                v-for="song in targetFolderSongs"
                :key="song.path"
                class="toolbox-list-row"
              >
                <div class="truncate text-sm text-gray-700 dark:text-gray-200">{{ getPathLeaf(song.path) }}</div>
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
      <section
        :class="currentView === 'tagging'
          ? 'toolbox-panel max-w-[520px] p-6'
          : 'toolbox-panel p-6'"
      >
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
        <section class="toolbox-section space-y-3">
          <template v-if="currentView === 'preprocess'">
            <div class="flex items-center justify-between gap-3">
              <h2 class="toolbox-section-title">
                <span class="toolbox-section-bar"></span>
                实时预览
              </h2>
              <div class="text-sm font-medium text-gray-600 dark:text-white/55">
                已扫描 {{ preprocessDisplayItems.length }} 首歌曲，发生变化 {{ preprocessChangedCount }} 首。
              </div>
            </div>

            <div class="toolbox-list overflow-hidden">
              <div class="toolbox-list-header grid grid-cols-[42px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-3">
                <span>标记</span>
                <span>原先的歌曲</span>
                <span></span>
                <span>修改后的歌曲</span>
              </div>

              <div
                v-if="preprocessPreview.isScanning || (!preprocessPreview.hasScanned && isLoadingSongs)"
                class="flex min-h-[360px] items-center justify-center px-6 py-8 text-sm text-gray-500 dark:text-white/45"
              >
                正在自动扫描当前文件夹...
              </div>

              <div
                v-else-if="preprocessDisplayItems.length === 0"
                class="flex min-h-[360px] items-center justify-center px-6 py-8 text-sm text-gray-500 dark:text-white/45"
              >
                当前文件夹中没有可显示的歌曲。
              </div>

              <div v-else class="max-h-[520px] space-y-2 overflow-y-auto p-3">
                <div
                  v-for="item in preprocessDisplayItems"
                  :key="`${item.originalName}-${item.newName}`"
                  class="toolbox-item grid grid-cols-[42px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-3 px-3 py-3 text-sm"
                >
                  <div class="flex items-center justify-center">
                    <span
                      class="text-lg leading-none"
                      :class="item.changed ? 'text-amber-400' : 'text-gray-400 dark:text-white/30'"
                    >
                      ★
                    </span>
                  </div>
                  <div class="truncate font-medium text-gray-600 dark:text-white/65">{{ item.originalName }}</div>
                  <div class="flex items-center justify-center text-sky-500 dark:text-sky-300">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 12h14m-5-5 5 5-5 5" />
                    </svg>
                  </div>
                  <div class="truncate font-semibold text-gray-900 dark:text-white">{{ item.newName }}</div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="currentView === 'rename'">
            <div class="flex items-center justify-between gap-3">
              <h2 class="toolbox-section-title">
                <span class="toolbox-section-bar"></span>
                实时预览
              </h2>
              <div class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {{ renamePreview.items.length }} 项
              </div>
            </div>

            <div
              v-if="renamePreview.isScanning"
              class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45"
            >
              正在生成重命名预览，请稍候...
            </div>

            <div
              v-else-if="renamePreview.items.length === 0"
              class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45"
            >
              暂无可显示的重命名结果。
            </div>

            <div v-else class="toolbox-list">
              <div class="toolbox-list-header">重命名预览</div>
              <div class="max-h-[420px] overflow-y-auto">
                <div
                  v-for="item in renamePreview.items"
                  :key="`${item.originalName}-${item.newName}`"
                  class="toolbox-list-row grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-2"
                >
                  <div class="truncate text-sm text-gray-600 dark:text-white/60">{{ item.originalName }}</div>
                  <div class="text-center text-gray-300 dark:text-white/30">→</div>
                  <div class="truncate text-sm font-medium text-gray-900 dark:text-white">{{ item.newName }}</div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="currentView === 'refresh'">
            <div class="flex items-center justify-between gap-3">
              <h2 class="toolbox-section-title">
                <span class="toolbox-section-bar"></span>
                实时预览
              </h2>
              <div class="flex items-center gap-3">
                <SettingHint text="这里显示刷新进度和最终完成状态。" />
                <div
                  class="rounded-full px-3 py-1 text-xs font-medium"
                  :class="
                    refreshPreview.refreshed
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'toolbox-chip'
                  "
                >
                  {{ refreshPreview.refreshed ? '已完成' : '待刷新' }}
                </div>
              </div>
            </div>

            <div class="space-y-3">
              <div class="toolbox-item p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-400 dark:text-white/35">Folder</div>
                <div class="mt-2 break-all text-sm font-medium text-gray-900 dark:text-white">{{ refreshPreview.targetPath || targetPath }}</div>
              </div>

              <div
                class="toolbox-panel p-5 text-sm"
                :class="
                  refreshPreview.isRefreshing
                    ? 'toolbox-panel--muted text-gray-600 dark:text-white/65'
                    : refreshPreview.refreshed
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
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

  <!-- ===== 功能界面：文件转换（ffmpeg） ===== -->
  <div
    v-else
    class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <div class="flex items-center gap-2 px-5">
      <button
        type="button"
        class="toolbox-ghost-btn"
        @click="backToGrid"
      >
        ← 返回工具箱
      </button>
      <span class="text-sm text-gray-500 dark:text-white/50">文件转换 · 格式转换</span>
    </div>

    <SettingsAudioConvert />
  </div>
</template>

<style scoped>
/* ---------- Section (顶层区块) ---------- */
.toolbox-section {
  padding: 16px 20px;
}

.toolbox-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-primary, #1f2937);
}

:root.dark .toolbox-section-title {
  color: var(--text-primary, #e5e7eb);
}

.toolbox-section-bar {
  display: inline-block;
  width: 4px;
  height: 16px;
  border-radius: 9999px;
  background: #ec4141;
}

/* ---------- Panel (通用面板/卡片) ---------- */
.toolbox-panel {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
}

.toolbox-panel--muted {
  padding: 20px 24px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
}

/* ---------- Stack (基础配置的两个输入块) ---------- */
.toolbox-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---------- Item (行级条目) ---------- */
.toolbox-item {
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  transition: background 0.2s, border-color 0.2s;
}

.toolbox-item:hover {
  background: rgba(229, 231, 235, 0.4);
  border-color: rgba(229, 231, 235, 0.5);
}

/* ---------- Ghost button (选择路径/文件夹) ---------- */
.toolbox-ghost-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: #ec4141;
  font-size: 0.75rem;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
  transition: background 160ms ease;
}

.toolbox-ghost-btn:hover {
  background: #d13b3b;
}

/* ---------- Path field (路径展示) ---------- */
.toolbox-path-field {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px dashed rgba(229, 231, 235, 0.5);
  background: rgba(243, 244, 246, 1);
  font-size: 0.75rem;
}

/* ---------- Chip (badge) ---------- */
.toolbox-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary, #9ca3af);
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(243, 244, 246, 0.6);
}

/* ---------- List (歌曲预览/重命名列表) ---------- */
.toolbox-list {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  overflow: hidden;
}

.toolbox-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
}

:root.dark .toolbox-list-header {
  color: var(--text-primary, #ffffff);
}

.toolbox-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.2);
  transition: background 160ms ease;
}

.toolbox-list-row:last-child {
  border-bottom: none;
}

.toolbox-list-row:hover {
  background: rgba(243, 244, 246, 0.5);
}
</style>

<style>
/* ==========================================================================
   桌面歌词工具箱深色模式样式覆盖
   Vue scoped style 中 :global(.dark) .xxx 复合选择器无法正确编译，
   深色模式样式需放在非 scoped <style> 块中，使用 html.dark .xxx 选择器。
   底色/边框/hover 与下载页 UI 一致。
   ========================================================================== */

html.dark .toolbox-panel,
html.dark .toolbox-panel--muted {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

html.dark .toolbox-item {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

html.dark .toolbox-item:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .toolbox-path-field {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
}

html.dark .toolbox-chip {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}

html.dark .toolbox-list {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

html.dark .toolbox-list-header {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

html.dark .toolbox-list-row {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}

html.dark .toolbox-list-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
</style>
