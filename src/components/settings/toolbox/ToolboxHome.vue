<script setup lang="ts">
import { computed, ref } from 'vue';
import { useToast } from '../../../composables/toast';

type ToolGlyph = 'tag' | 'convert' | 'trim';

interface ToolEntry {
  id: string;
  label: string;
  blurb: string;
  glyph: ToolGlyph;
  enabled: boolean;
}

interface ToolGroup {
  key: string;
  heading: string;
  tagline: string;
  entries: ToolEntry[];
}

const emit = defineEmits<{
  (e: 'launch', toolId: string): void;
}>();

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
        glyph: 'tag',
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
        glyph: 'convert',
        enabled: true,
      },
      {
        id: 'audio-trim',
        label: '音频剪辑',
        blurb: '拖动进度条裁剪音频区间 · 保持原格式无损输出',
        glyph: 'trim',
        enabled: true,
      },
    ],
  },
];

const GLYPH_TRAILS: Record<ToolGlyph, string[]> = {
  tag: [
    'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z',
    'M6 6h.008v.008H6V6Z',
  ],
  convert: [
    'M3 8.5 6 5l3 3.5M6.5 6C6.5 10.5 9 14 13 14',
    'M21 15.5 18 19l-3-3.5M17.5 18c0-4.5-2.5-8-6.5-8',
  ],
  trim: [
    'm6 6 8 8M6 18l8-8',
    'M7 6a2 2 0 1 1-1.414.586A2 2 0 0 1 7 6Zm10 12a2 2 0 1 0 1.414-.586A2 2 0 0 0 17 18Z',
  ],
};

const CHEVRON_TRAIL = 'm9 18 6-6-6-6';

const pickedGroupKey = ref<string>(groups[0]?.key ?? '');

const shownGroup = computed(
  () => groups.find((group) => group.key === pickedGroupKey.value) ?? groups[0],
);

const openEntry = (entry: ToolEntry) => {
  if (!entry.enabled) {
    toast.showToast(`${entry.label} 即将上线，敬请期待`, 'info');
    return;
  }

  emit('launch', entry.id);
};
</script>

<template>
  <div
    data-no-translate
    class="w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <div class="mb-6 space-y-1">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">工具箱</h1>
      <p class="text-sm text-gray-500 dark:text-white/50">按类别整理的音乐实用工具，功能会持续扩充。</p>
    </div>

    <div class="mb-6 flex flex-wrap gap-1 border-b border-black/5 pb-px dark:border-white/10">
      <button
        v-for="group in groups"
        :key="group.key"
        type="button"
        class="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
        :class="
          group.key === pickedGroupKey
            ? 'border-b-2 border-[#EC4141] text-[#EC4141]'
            : 'text-gray-500 hover:text-gray-800 dark:text-white/50 dark:hover:text-white'
        "
        @click="pickedGroupKey = group.key"
      >
        {{ group.heading }}
      </button>
    </div>

    <div v-if="shownGroup" class="space-y-2">
      <div class="px-5 text-[13px] text-gray-500 dark:text-white/50">{{ shownGroup.tagline }}</div>

      <button
        v-for="entry in shownGroup.entries"
        :key="entry.id"
        type="button"
        class="toolbox-item group flex w-full items-center gap-4 text-left"
        @click="openEntry(entry)"
      >
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
          :class="entry.enabled
            ? 'bg-[#EC4141]/10 text-[#EC4141] group-hover:bg-[#EC4141] group-hover:text-white'
            : 'bg-white/10 text-gray-400 dark:text-white/30'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path
              v-for="(trail, trailIndex) in GLYPH_TRAILS[entry.glyph]"
              :key="trailIndex"
              stroke-linecap="round"
              stroke-linejoin="round"
              :d="trail"
            />
          </svg>
        </div>

        <div class="min-w-0 flex-1">
          <div class="text-[15px] font-semibold text-gray-900 dark:text-white">{{ entry.label }}</div>
          <div class="mt-0.5 truncate text-[13px] text-gray-500 dark:text-white/45">{{ entry.blurb }}</div>
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
          class="h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-[#EC4141] dark:text-white/25"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" :d="CHEVRON_TRAIL" />
        </svg>
      </button>
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
</style>
