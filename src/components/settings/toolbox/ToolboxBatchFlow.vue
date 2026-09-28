<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useToast } from '../../../composables/toast';
import { fileApi } from '../../../services/tauri/fileApi';
import { appApi } from '../../../services/tauri/appApi';
import type { Song } from '../../../types';
import ToolboxStep1 from '../ToolboxStep1.vue';
import ToolboxStep2 from '../ToolboxStep2.vue';
import ToolboxStep3 from '../ToolboxStep3.vue';
import ToolboxStep4 from '../ToolboxStep4.vue';
import ToolboxToolHeader from './ToolboxToolHeader.vue';
import ToolboxStepTrack from './ToolboxStepTrack.vue';
import ToolboxSetupStage from './ToolboxSetupStage.vue';
import ToolboxPreprocessPreview from './ToolboxPreprocessPreview.vue';
import ToolboxRenamePreview from './ToolboxRenamePreview.vue';
import ToolboxRefreshPreview from './ToolboxRefreshPreview.vue';

type FlowStage = 'setup' | 'preprocess' | 'tagging' | 'rename' | 'refresh';

interface StageMarker {
  key: FlowStage;
  caption: string;
}

interface PreviewRow {
  originalName: string;
  newName: string;
}

const emit = defineEmits<{
  (e: 'exit'): void;
}>();

const toast = useToast();

const MUSICTAG_STORAGE_KEY = 'toolbox_musictag_path';

const FLOW_STAGES: StageMarker[] = [
  { key: 'setup', caption: '预设' },
  { key: 'preprocess', caption: '预处理' },
  { key: 'tagging', caption: '编辑标签' },
  { key: 'rename', caption: '重命名' },
  { key: 'refresh', caption: '完成' },
];

const NEXT_STAGE: Partial<Record<FlowStage, FlowStage>> = {
  preprocess: 'tagging',
  tagging: 'rename',
  rename: 'refresh',
};

const PREV_STAGE: Partial<Record<FlowStage, FlowStage>> = {
  tagging: 'preprocess',
  rename: 'tagging',
  refresh: 'rename',
};

const stage = ref<FlowStage>('setup');
const targetFolder = ref('');
const musicTagApp = ref('');

const preprocessState = ref({
  targetPath: '',
  isScanning: false,
  hasScanned: false,
  removeTrackPrefix: true,
  items: [] as PreviewRow[],
});

const taggingState = ref({
  targetPath: '',
  musicTagPath: '',
  isLaunching: false,
  hasLaunched: false,
});

const renameState = ref({
  targetPath: '',
  template: '{title} - {artist}',
  isScanning: false,
  hasScanned: false,
  items: [] as PreviewRow[],
  skippedCount: 0,
});

const refreshState = ref({
  targetPath: '',
  isRefreshing: false,
  refreshed: false,
});

const songsInTarget = ref<Song[]>([]);
const loadingSongs = ref(false);

watch(
  () => targetFolder.value,
  async (pickedFolder) => {
    if (!pickedFolder) {
      songsInTarget.value = [];
      return;
    }

    loadingSongs.value = true;
    try {
      songsInTarget.value = await fileApi.scanMusicFolder(pickedFolder);
    } catch (cause) {
      console.error('Failed to scan songs:', cause);
      toast.showToast(`加载歌曲失败: ${cause}`, 'error');
      songsInTarget.value = [];
    } finally {
      loadingSongs.value = false;
    }
  },
);

const readyToStart = computed(() => Boolean(targetFolder.value && musicTagApp.value));

const activeStageIndex = computed(() =>
  FLOW_STAGES.findIndex((marker) => marker.key === stage.value),
);

const preparedCount = computed(
  () => Number(Boolean(musicTagApp.value)) + Number(Boolean(targetFolder.value)),
);

const stageLayoutClass = computed(() =>
  stage.value === 'tagging'
    ? 'px-6'
    : 'grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]',
);

const stagePanelClass = computed(() =>
  stage.value === 'tagging' ? 'toolbox-panel max-w-[520px] p-6' : 'toolbox-panel p-6',
);

const pickPathLeaf = (path: string) => {
  const fragments = path.split(/[\\/]/).filter(Boolean);
  return fragments.length > 0 ? fragments[fragments.length - 1] : '未选择';
};

const preprocessRows = computed(() => {
  const renameMap = new Map(
    preprocessState.value.items.map((row) => [row.originalName, row.newName]),
  );

  if (songsInTarget.value.length > 0) {
    return songsInTarget.value.map((song) => {
      const leafName = pickPathLeaf(song.path);
      const mappedName = renameMap.get(leafName);

      return {
        originalName: leafName,
        newName: mappedName ?? leafName,
        changed: Boolean(mappedName && mappedName !== leafName),
      };
    });
  }

  return preprocessState.value.items.map((row) => ({
    originalName: row.originalName,
    newName: row.newName,
    changed: row.originalName !== row.newName,
  }));
});

const preprocessChangedTotal = computed(
  () => preprocessRows.value.filter((row) => row.changed).length,
);

onMounted(() => {
  const storedPath = localStorage.getItem(MUSICTAG_STORAGE_KEY);

  if (storedPath) {
    musicTagApp.value = storedPath;
  }
});

const pickMusicTagApp = async () => {
  try {
    const chosen = await appApi.registerExternalProgram();

    if (!chosen) {
      toast.showToast('已取消选择 MusicTag', 'info');
      return;
    }

    musicTagApp.value = chosen;
    localStorage.setItem(MUSICTAG_STORAGE_KEY, chosen);
    toast.showToast('MusicTag 路径已保存', 'success');
  } catch (cause) {
    console.error(cause);
    toast.showToast(`选择路径失败: ${cause}`, 'error');
  }
};

const pickTargetFolder = async () => {
  try {
    const chosen = await open({
      directory: true,
      multiple: false,
      title: '选择要整理的目标文件夹',
    });

    if (chosen && typeof chosen === 'string') {
      targetFolder.value = chosen;
    }
  } catch (cause) {
    console.error(cause);
    toast.showToast(`选择文件夹失败: ${cause}`, 'error');
  }
};

const discardStageOutputs = () => {
  preprocessState.value = {
    targetPath: '',
    isScanning: false,
    hasScanned: false,
    removeTrackPrefix: true,
    items: [],
  };
  taggingState.value = {
    targetPath: '',
    musicTagPath: '',
    isLaunching: false,
    hasLaunched: false,
  };
  renameState.value = {
    targetPath: '',
    template: '{title} - {artist}',
    isScanning: false,
    hasScanned: false,
    items: [],
    skippedCount: 0,
  };
  refreshState.value = {
    targetPath: '',
    isRefreshing: false,
    refreshed: false,
  };
};

const beginFlow = () => {
  if (!readyToStart.value) {
    toast.showToast('请先选择 MusicTag 和目标文件夹', 'error');
    return;
  }

  stage.value = 'preprocess';
};

const goForward = () => {
  const upcoming = NEXT_STAGE[stage.value];
  if (upcoming) {
    stage.value = upcoming;
  }
};

const goBack = () => {
  const previous = PREV_STAGE[stage.value];
  if (previous) {
    stage.value = previous;
  }
};

const restartFlow = () => {
  stage.value = 'setup';
  targetFolder.value = '';
  discardStageOutputs();
};

const quitFlow = () => {
  emit('exit');
};
</script>

<template>
  <div class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <ToolboxToolHeader caption="音乐整理 · 批处理流程" @back="quitFlow" />

    <ToolboxStepTrack :stages="FLOW_STAGES" :active-index="activeStageIndex" />

    <section
      v-if="stage !== 'setup' && targetFolder"
      class="px-6"
    >
      <div class="toolbox-item px-5 py-3">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-white/70">
          <span class="text-[15px] font-semibold text-gray-900 dark:text-white">当前文件夹路径</span>
          <span class="break-all">{{ targetFolder }}</span>
        </div>
      </div>
    </section>

    <ToolboxSetupStage
      v-if="stage === 'setup'"
      :music-tag-app="musicTagApp"
      :target-folder="targetFolder"
      :ready-to-start="readyToStart"
      :prepared-count="preparedCount"
      :songs="songsInTarget"
      :scanning="loadingSongs"
      @choose-app="pickMusicTagApp"
      @choose-folder="pickTargetFolder"
      @begin="beginFlow"
    />

    <div v-else :class="stageLayoutClass">
      <section :class="stagePanelClass">
        <ToolboxStep1
          v-if="stage === 'preprocess'"
          :target-path="targetFolder"
          @next="goForward"
          @skip="goForward"
          @preview-change="preprocessState = $event"
        />

        <ToolboxStep2
          v-else-if="stage === 'tagging'"
          :target-path="targetFolder"
          :music-tag-path="musicTagApp"
          @back="goBack"
          @next="goForward"
          @preview-change="taggingState = $event"
        />

        <ToolboxStep3
          v-else-if="stage === 'rename'"
          :target-path="targetFolder"
          @back="goBack"
          @next="goForward"
          @preview-change="renameState = $event"
        />

        <ToolboxStep4
          v-else-if="stage === 'refresh'"
          :target-path="targetFolder"
          @back="goBack"
          @restart="restartFlow"
          @close="restartFlow"
          @preview-change="refreshState = $event"
        />
      </section>

      <aside
        v-if="stage !== 'tagging'"
        class="xl:sticky xl:top-6 xl:self-start"
      >
        <ToolboxPreprocessPreview
          v-if="stage === 'preprocess'"
          :rows="preprocessRows"
          :changed-total="preprocessChangedTotal"
          :scanning="preprocessState.isScanning"
          :pending-first-scan="!preprocessState.hasScanned && loadingSongs"
        />

        <ToolboxRenamePreview
          v-else-if="stage === 'rename'"
          :report="renameState"
        />

        <ToolboxRefreshPreview
          v-else
          :report="refreshState"
          :fallback-path="targetFolder"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.toolbox-item {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 10px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.2);
  transition: background 0.2s, border-color 0.2s;
}

.toolbox-item:hover {
  border-color: rgba(229, 231, 235, 0.5);
  background: rgba(229, 231, 235, 0.4);
}

.toolbox-ghost-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
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

.toolbox-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
}
</style>
