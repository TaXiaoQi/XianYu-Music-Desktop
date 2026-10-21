<script setup lang="ts">
import { ref } from 'vue';
import { useToast } from '../../../composables/toast';
import ToolboxBatchFlow from './ToolboxBatchFlow.vue';
import SettingsAudioConvert from '../SettingsAudioConvert.vue';
import SettingsAudioTrim from '../SettingsAudioTrim.vue';

interface ToolEntry {
  id: string;
  label: string;
  blurb: string;
  enabled: boolean;
}

interface ToolGroup {
  key: string;
  heading: string;
  tagline: string;
  entries: ToolEntry[];
}

const toast = useToast();

const groups: ToolGroup[] = [
  {
    key: 'organize',
    heading: '音乐整理',
    tagline: '批量处理本地歌曲的标签、文件名与音乐库刷新',
    entries: [
      {
        id: 'music-tag-flow',
        label: '批处理整理',
        blurb: '标签编辑 · 重命名 · 刷新音乐库',
        enabled: true,
      },
    ],
  },
  {
    key: 'convert',
    heading: '文件编辑',
    tagline: '音频格式转换与音频剪辑工具',
    entries: [
      {
        id: 'format-convert',
        label: '格式转换',
        blurb: '音频编码格式转换 · mp3 / flac / wav / ogg 等',
        enabled: true,
      },
      {
        id: 'audio-trim',
        label: '音频剪辑',
        blurb: '拖动进度条裁剪音频区间 · 保持原格式无损输出',
        enabled: true,
      },
    ],
  },
];

const CHEVRON_TRAIL = 'm6 9 6 6 6-6';

// 点击工具条向下展开对应工具面板，再点收起（一次只展开一个）
const expandedToolKey = ref<string | null>(null);

const toggleEntry = (entry: ToolEntry) => {
  if (!entry.enabled) {
    toast.showToast(`${entry.label} 即将上线，敬请期待`, 'info');
    return;
  }

  expandedToolKey.value = expandedToolKey.value === entry.id ? null : entry.id;
};
</script>

<template>
  <div
    data-no-translate
    class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <section v-for="group in groups" :key="group.key" class="flex flex-col gap-3">
      <!-- 与其他设置页一致的红条分组标题 -->
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ group.heading }}
      </h2>
      <p class="-mt-1 text-xs text-gray-500 dark:text-gray-400">{{ group.tagline }}</p>

      <template v-for="entry in group.entries" :key="entry.id">
        <button
          type="button"
          class="toolbox-item group flex w-full items-center gap-4 text-left"
          :aria-expanded="expandedToolKey === entry.id"
          @click="toggleEntry(entry)"
        >
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ entry.label }}</div>
            <div class="mt-0.5 truncate text-xs text-gray-500 dark:text-white/45">{{ entry.blurb }}</div>
          </div>

          <span
            v-if="!entry.enabled"
            class="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-gray-400 dark:text-white/35"
          >
            即将上线
          </span>
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 shrink-0 text-gray-300 transition-all duration-200 group-hover:text-[#EC4141] dark:text-white/25"
            :class="{ 'rotate-180': expandedToolKey === entry.id }"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" :d="CHEVRON_TRAIL" />
          </svg>
        </button>

        <!-- 点击工具条向下展开工具面板 -->
        <div
          v-if="entry.enabled && expandedToolKey === entry.id"
          class="animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <ToolboxBatchFlow v-if="entry.id === 'music-tag-flow'" />
          <SettingsAudioConvert v-else-if="entry.id === 'format-convert'" />
          <SettingsAudioTrim v-else-if="entry.id === 'audio-trim'" />
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.toolbox-item {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.2);
  transition: background-color 160ms ease;
}

.toolbox-item:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .toolbox-item:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
