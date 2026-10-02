<script setup lang="ts"> // 实现
import { computed, ref, watch } from 'vue';

import { dragSession as dragCtx } from '../../composables/dragState';
import { useCoverCache as coverCacheOf } from '../../composables/useCoverCache';
import DragThumb from './drag/DragThumb.vue';

const ghostShown = ref(false);
const ghostArt = ref('');
const { loadCover: resolveCover } = coverCacheOf();
let coverEpoch = 0;

watch(() => dragCtx.showGhost, (shown) => {
  ghostShown.value = shown;
});

watch(
  () => [dragCtx.active, dragCtx.type] as const,
  async ([isActive, dragType]) => {
    const epoch = ++coverEpoch;
    if (!isActive || dragType !== 'song' || dragCtx.songs.length === 0) {
      ghostArt.value = '';
      return;
    }
    try {
      const resolved = await resolveCover(dragCtx.songs[0].path);
      if (epoch !== coverEpoch) return;
      ghostArt.value = resolved || '';
    } catch {
      if (epoch !== coverEpoch) return;
      ghostArt.value = '';
    }
  },
);

const ghostPlacement = computed(() => ({
  top: `${dragCtx.mouseY + 10}px`,
  left: `${dragCtx.mouseX + 10}px`,
}));

const headingFallback: Record<string, string> = {
  playlist: '未知歌单',
  folder: '未知文件夹',
  artist: '未知歌手',
  album: '未知专辑',
};

const kindCaption: Record<string, string> = {
  playlist: '歌单',
  folder: '文件夹',
  artist: '歌手',
  album: '专辑',
};

const heading = computed(() => {
  const { type, songs, data } = dragCtx;
  if (type === 'song') {
    const lead = songs[0];
    if (!lead) return '移动中...';
    return lead.title || lead.name;
  }
  return data?.name || headingFallback[type] || '移动中...';
});

const caption = computed(() => {
  const { type, songs } = dragCtx;
  if (type === 'song') {
    const lead = songs[0];
    return lead ? lead.artist : '';
  }
  return kindCaption[type] || '';
});

const stackSize = computed(() => (dragCtx.type === 'song' ? dragCtx.songs.length : 0));
</script>

<template>
  <Teleport to="body">
    <transition
      enter-active-class="duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] transition-all"
      enter-from-class="-translate-y-2 scale-[0.85] opacity-0"
      enter-to-class="translate-y-0 scale-100 opacity-100"
      leave-active-class="duration-150 ease-[ease] transition-all"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-90 opacity-0"
    >
      <div
        v-if="ghostShown"
        class="pointer-events-none fixed z-[9999] flex select-none items-center gap-3 rounded-lg border border-white/20 bg-white/90 p-3 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-[#262626]/90"
        :style="ghostPlacement"
      >
        <DragThumb :drag-type="dragCtx.type" :cover="ghostArt" />

        <div class="flex min-w-0 flex-col">
          <span class="max-w-[200px] truncate text-sm font-bold text-gray-900 drop-shadow-sm dark:text-white">{{ heading }}</span>
          <span class="max-w-[200px] truncate text-xs text-gray-500 dark:text-white/60">{{ caption }}</span>
        </div>

        <div
          v-if="stackSize > 1"
          class="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#EC4141] text-xs font-bold text-white shadow-md dark:border-white/10"
        >
          {{ stackSize }}
        </div>
      </div>
    </transition> 
  </Teleport>
</template>
