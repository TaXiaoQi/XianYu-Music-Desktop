<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePlayer } from '../../features/playback';
import { lyricsSettings } from '../../composables/lyrics';
import { fileApi } from '../../services/tauri/fileApi';

const props = defineProps<{
  bgOpacity?: number;
  active?: boolean;
}>();

const { dominantColors, currentCover, currentSongPath } = usePlayer();

const viewportArea = ref(
  typeof window !== 'undefined' ? window.innerWidth * window.innerHeight : 0
);
const isLargeViewport = computed(() => viewportArea.value >= 2000000);

const updateViewportArea = () => {
  viewportArea.value = window.innerWidth * window.innerHeight;
};

const thumbCoverUrl = computed(() => (
  (props.active ?? true) ? currentCover.value : ''
));

/** 单曲独立背景图路径（从数据库读取，每首歌可不同） */
const songBgPath = ref<string | null>(null);

let fetchSeq = 0;
async function fetchSongBackground(path: string | null) {
  if (!path) {
    songBgPath.value = null;
    return;
  }
  const seq = ++fetchSeq;
  try {
    const result = await fileApi.getSongBackground(path);
    if (seq === fetchSeq) {
      songBgPath.value = result;
    }
  } catch {
    if (seq === fetchSeq) {
      songBgPath.value = null;
    }
  }
}

watch(currentSongPath, (path) => fetchSongBackground(path), { immediate: true });

/** 自定义背景图 URL：优先使用单曲背景，其次全局自定义背景 */
const customBgUrl = computed(() => {
  const path = songBgPath.value || lyricsSettings.customBackgroundImage;
  if (!path) return '';
  return path.startsWith('http') || path.startsWith('data:') || path.startsWith('asset:')
    ? path
    : convertFileSrc(path);
});

/** 背景模糊程度（0-100）：0% 时完全清晰，100% 时完全模糊 */
const backgroundBlurPx = computed(() => {
  const percent = lyricsSettings.backgroundBlur;
  // 0% → 0px（清晰），100% → 52px（完全模糊）
  return (percent / 100) * 52;
});

/** 封面背景的 filter 样式：模糊程度跟随用户设置 */
const coverFilterStyle = computed(() => {
  const blur = backgroundBlurPx.value;
  if (blur === 0) return 'brightness(0.78) saturate(1.42) contrast(1.16)';
  return `blur(${blur}px) brightness(0.78) saturate(1.42) contrast(1.16)`;
});

onMounted(() => {
  window.addEventListener('resize', updateViewportArea);
  updateViewportArea();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportArea);
});
</script>

<template>
  <div
    class="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
    :style="{ opacity: props.bgOpacity ?? 1, transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1)' }"
  >
    <div class="absolute inset-0 bg-[#0b1222] z-0"></div>

    <div
      class="absolute inset-0 transition-colors duration-[1200ms]"
      :class="isLargeViewport ? 'opacity-[0.04]' : 'opacity-[0.06]'"
      :style="{ backgroundColor: dominantColors[0] }"
    ></div>

    <!-- 自定义背景图（用户上传）：覆盖默认封面背景 -->
    <div v-if="customBgUrl" class="absolute inset-0 overflow-hidden z-[1]">
      <img
        :src="customBgUrl"
        class="w-full h-full object-cover scale-110 select-none"
        :style="{ filter: coverFilterStyle }"
        draggable="false"
        decoding="async"
      />
    </div>

    <!-- 默认封面背景（无自定义背景图时显示） -->
    <div v-else-if="thumbCoverUrl" class="absolute inset-0 overflow-hidden z-[1]">
      <img
        :src="thumbCoverUrl"
        class="w-full h-full object-cover scale-110 select-none"
        :style="{ filter: coverFilterStyle }"
        draggable="false"
        decoding="async"
      />
    </div>

    <div class="absolute inset-0 z-[2]" :style="{ background: `radial-gradient(circle at 24% 16%, ${dominantColors[1] || dominantColors[0]}22 0%, transparent 52%)` }"></div>
    <div class="absolute inset-0 z-[3]" :style="{ background: `radial-gradient(circle at 78% 84%, ${dominantColors[2] || dominantColors[0]}18 0%, transparent 62%)` }"></div>
    <div class="absolute inset-0 z-[4]" :style="{ background: `radial-gradient(circle at 50% 48%, ${dominantColors[0]}10 0%, transparent 58%)` }"></div>

    <div class="absolute inset-0 bg-gradient-to-r from-black/6 via-transparent to-black/6 z-[18]"></div>
    <div class="absolute inset-0 bg-gradient-to-b from-black/3 via-transparent to-black/22 z-20"></div>
  </div>
</template>
