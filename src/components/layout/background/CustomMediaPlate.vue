<script setup lang="ts">
import { computed, ref, watch } from 'vue';

// 自定义背景媒体层：图片走 cover 几何铺排；视频额外做元数据探测、
// 尺寸上报与播放/暂停仲裁（详情页展开、省电、低性能时冻结）。
interface CoverGeometry { width: number; height: number }
interface CoverTransform { tx: number; ty: number; scale: number }

const props = defineProps<{
  source: string;
  mediaType: 'image' | 'video';
  blur: number;
  opacity?: number;
  maskColor?: string;
  maskAlpha?: number;
  geometry: CoverGeometry | null;
  transform: CoverTransform;
  motionFrozen: boolean;
}>();

const emit = defineEmits<{
  (event: 'video-measured', dimensions: CoverGeometry): void;
  (event: 'video-broken'): void;
}>();

const videoElement = ref<HTMLVideoElement | null>(null);
const videoBroken = ref(false);

/** 离屏探测视频帧尺寸，避免依赖挂载后的真实元素 */
const measureVideoFrame = (src: string) => new Promise<CoverGeometry>((resolve, reject) => {
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.muted = true;
  probe.playsInline = true;

  const detach = () => {
    probe.onloadedmetadata = null;
    probe.onerror = null;
    probe.src = '';
  };

  probe.onloadedmetadata = () => {
    const frame = { width: probe.videoWidth, height: probe.videoHeight };
    detach();
    resolve(frame);
  };

  probe.onerror = () => {
    detach();
    reject(new Error('probe failed'));
  };

  probe.src = src;
});

watch(
  () => props.source,
  async (src) => {
    videoBroken.value = false;
    if (props.mediaType !== 'video' || !src) return;

    try {
      const frame = await measureVideoFrame(src);
      emit('video-measured', frame);
    } catch {
      videoBroken.value = true;
      emit('video-broken');
    }
  },
  { immediate: true },
);

watch(
  () => props.motionFrozen,
  (frozen) => {
    const el = videoElement.value;
    if (!el) return;
    if (frozen) {
      el.pause();
    } else if (el.paused) {
      el.play().catch(() => {});
    }
  },
  { immediate: true },
);

const handleVideoReady = () => {
  const el = videoElement.value;
  if (!el) return;
  if (props.motionFrozen) {
    el.pause();
  } else if (el.paused) {
    el.play().catch(() => {});
  }
};

const handleVideoBroken = () => {
  videoBroken.value = true;
  videoElement.value?.pause();
  emit('video-broken');
};

const boxStyle = computed(() => ({
  position: 'absolute' as const,
  left: '50%',
  top: '50%',
  width: `${props.geometry?.width ?? 0}px`,
  height: `${props.geometry?.height ?? 0}px`,
  transform: 'translate(-50%, -50%)',
}));

const videoStyle = computed(() => ({
  left: '25%',
  top: '25%',
  width: '50%',
  height: '50%',
  transformOrigin: 'center center',
  transform: `translate3d(${props.transform.tx}px, ${props.transform.ty}px, 0) scale(${props.transform.scale}) scale(2)`,
  filter: props.blur ? `blur(${props.blur / 2}px)` : 'none',
  opacity: props.opacity ?? 1.0,
}));

const imageStyle = computed(() => ({
  width: '100%',
  height: '100%',
  transform: `translate3d(${props.transform.tx}px, ${props.transform.ty}px, 0) scale(${props.transform.scale})`,
  transformOrigin: 'center center',
  filter: `blur(${props.blur}px)`,
  opacity: props.opacity ?? 1.0,
}));
</script>

<template>
  <div class="absolute inset-0 overflow-hidden">
    <div
      v-if="maskAlpha !== undefined && maskAlpha > 0"
      class="pointer-events-none absolute inset-0 z-10 transition-all duration-300"
      :style="{
        backgroundColor: maskColor || '#000000',
        opacity: maskAlpha,
      }"
    ></div>

    <div v-if="geometry" class="absolute" :style="boxStyle">
      <video
        v-if="mediaType === 'video'"
        ref="videoElement"
        :src="source"
        muted
        loop
        playsinline
        autoplay
        preload="auto"
        class="pointer-events-none absolute block max-h-none max-w-none select-none"
        :class="{ 'custom-media-video-ghost': videoBroken }"
        :style="videoStyle"
        @loadedmetadata="handleVideoReady"
        @error="handleVideoBroken"
      ></video>
      <img
        v-else
        :src="source"
        class="pointer-events-none absolute block max-h-none max-w-none select-none transition-all duration-700"
        :style="imageStyle"
      />
    </div>
  </div>
</template>

<style scoped>
.custom-media-video-ghost {
  display: none !important;
}
</style>
