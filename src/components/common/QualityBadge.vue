<script setup lang="ts">
import { computed, ref } from 'vue';

// 接收父组件传来的参数
const props = withDefaults(defineProps<{
  bitrate: number;
  sampleRate: number;
  bitDepth?: number;
  format: string;
  codec?: string;
  container?: string;
  variant?: 'simple' | 'detailed';
}>(), {
  variant: 'simple'
});

// 控制悬浮提示的显示与隐藏
const isHovered = ref(false);
const badgeRef = ref<HTMLElement | null>(null);
const tooltipStyle = ref({});

// 1. 判断音质等级 (HR / SQ / HQ)
const badgeType = computed(() => {
  const losslessFormats = ['aif', 'aiff', 'flac', 'wav', 'alac', 'ape', 'pcm'];
  const audioType = (props.codec || props.format).toLowerCase();
  const isLossless = losslessFormats.includes(audioType);
  const hasAudioInfo = Boolean(audioType || props.bitrate || props.sampleRate || props.bitDepth);
  
  // HR: 无损格式 且 (位深 > 16bit 或 采样率 > 44.1kHz) - 只要有一项超越 CD 即视为高解析
  if (isLossless && ((props.bitDepth && props.bitDepth > 16) || props.sampleRate > 44100)) {
    return 'HR';
  }
  // SQ: 无损格式但未达到 HR 标准
  if (isLossless) {
    return 'SQ';
  }
  // HQ: 有损格式的极致音质
  // - MP3: >= 320kbps
  // - AAC/OGG/Opus 等现代高效编码: >= 256kbps (256k ≈ MP3 320k)
  const efficientCodecs = ['aac', 'm4a', 'm4b', 'mp4', 'oga', 'ogg', 'opus', 'vorbis', 'wma'];
  const hqThreshold = efficientCodecs.includes(audioType) ? 256 : 320;
  if (props.bitrate >= hqThreshold) {
    return 'HQ';
  }
  return hasAudioInfo ? 'HQ' : null;
});

// 1.1 详细标签文本 (仅用于 detailed variant)
const detailedLabel = computed(() => {
  switch (badgeType.value) {
    case 'HR': return 'HI-RES LOSSLESS';
    case 'SQ': return 'LOSSLESS'; // 或根据偏好改为 CD LOSSLESS
    case 'HQ': return 'HIGH';
    default: return '';
  }
});

// 2. 定义颜色样式
const badgeColorClass = computed(() => {
  const common = 'font-bold px-[3px] rounded-[3px] border';
  switch (badgeType.value) {
    case 'HR':
      // Premium Gold (Kobe Style) - Gradient for luxury feel
      // Light: Gradient Amber-100 to Amber-200, Text Amber-800
      // Dark: Gradient Amber-500/30 to Amber-600/30, Text Amber-300
      return `${common} bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A] text-[#92400E] border-transparent dark:from-amber-900/40 dark:to-amber-600/20 dark:text-[#FCD34D]`;
    case 'SQ':
      // Soft Filled Cyan (match image: light bg, dark text)
      // Light: bg-cyan-100 text-cyan-600
      // Dark: bg-cyan-500/20 text-cyan-300
      return `${common} bg-cyan-100 text-cyan-600 border-transparent dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-transparent`;
    case 'HQ':
      // Soft Filled Beige/Brown (match image)
      // Light: bg-orange-100 text-orange-800
      // Dark: bg-orange-500/20 text-orange-300
      return `${common} bg-orange-100 text-orange-800 border-transparent dark:bg-orange-500/20 dark:text-orange-300 dark:border-transparent`;
    default:
      return '';
  }
});

// 4. 生成分级提示内容 (Tiered Tooltip Content)
const tooltipContent = computed(() => {
  const fmt = (props.codec || props.format || '').toUpperCase();
  const container = props.container?.toUpperCase() || '';
  const kbps = props.bitrate || 0;
  
  // 统一模板: {bitDepth}-bit · {sampleRate} kHz · {codec} · {bitrate} kbps
  let sub = '';
  if (props.bitDepth) sub += `${props.bitDepth}-bit · `;
  if (props.sampleRate) sub += `${props.sampleRate / 1000} kHz · `;
  sub += fmt;
  if (container && container !== fmt) sub += ` / ${container}`;
  if (kbps > 0) sub += ` · ${kbps} kbps`;

  const losslessFormats = ['AIF', 'AIFF', 'FLAC', 'WAV', 'ALAC', 'APE', 'PCM'];
  const isLossless = losslessFormats.includes(fmt);

  // HR: 高解析无损
  if (isLossless && ((props.bitDepth && props.bitDepth > 16) || props.sampleRate > 44100)) {
    return {
      emoji: '',
      title: '高解析无损',
      subtitle: sub,
      isMaster: true 
    };
  }

  // SQ: 标准无损
  if (isLossless) {
    return {
      emoji: '',
      title: '标准无损',
      subtitle: sub,
      isMaster: false
    };
  }

  // HQ: 高品质音乐
  const efficientCodecs = ['AAC', 'M4A', 'M4B', 'MP4', 'OGA', 'OGG', 'OPUS', 'VORBIS', 'WMA'];
  const hqThreshold = efficientCodecs.includes(fmt) ? 256 : 320;
  if (kbps >= hqThreshold) {
    return {
      emoji: '',
      title: '高品质音乐',
      subtitle: sub,
      isMaster: false
    };
  }

  // 标准音质（不显示标签，但 tooltip 仍可显示）
  return {
    emoji: '',
    title: '标准音质',
    subtitle: sub,
    isMaster: false
  };
});

const showTooltip = () => {
    if (props.variant === 'detailed') return;
    isHovered.value = true;
    updateTooltipPosition();
};

const hideTooltip = () => {
    isHovered.value = false;
};

const updateTooltipPosition = () => {
    if (badgeRef.value) {
        const rect = badgeRef.value.getBoundingClientRect();
        tooltipStyle.value = {
            top: `${rect.top}px`,
            left: `${rect.left + rect.width / 2}px`,
        };
    }
};

</script>

<template>
  <div 
    v-if="badgeType" 
    ref="badgeRef"
    class="relative flex items-center mt-[2px]"
    @mouseenter="showTooltip"
    @mouseleave="hideTooltip"
  >
    <span 
      v-if="variant === 'simple'"
      class="text-[7px] font-bold border px-0.5 rounded-[3px] cursor-help select-none flex items-center justify-center h-[12px] leading-none transition-colors"
      :class="badgeColorClass"
    >
      {{ badgeType }}
    </span>

    <!-- Detailed Style for Player Detail View -->
    <div 
      v-else
      class="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded-[4px] text-[10px] font-bold text-white/60 tracking-tight select-none"
    >
      {{ detailedLabel }}
    </div>

    <Teleport to="body">
        <Transition 
          enter-active-class="tooltip-enter-active"
          enter-from-class="opacity-0 scale-90 blur-[8px] translate-y-2"
          enter-to-class="opacity-100 scale-100 blur-0 translate-y-0"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-1"
        >
        <div 
            v-if="isHovered"
            class="fixed z-[9999] pointer-events-none"
            :style="tooltipStyle"
        >
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap">
                <!-- Inner Highlight Ring -->
                <div class="px-3 py-2 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] flex flex-col items-center gap-0.5 ring-1 ring-white/20 dark:ring-white/5">
                    
                    <!-- Line 1: Main Title (Big & Bold) -->
                    <!-- Gold Gradient for Master Quality, normal colors for others -->
                    <!-- Emoji rendered separately to prevent color inheritance -->
                    <div class="flex items-center gap-1 text-xs font-bold leading-normal">
                      <span v-if="tooltipContent.emoji" class="text-base">{{ tooltipContent.emoji }}</span>
                      <span :class="tooltipContent.isMaster ? 'bg-gradient-to-r from-amber-500 to-yellow-600 bg-clip-text text-transparent' : 'text-gray-900 dark:text-gray-100'">
                        {{ tooltipContent.title }}
                      </span>
                    </div>

                    <!-- Line 2: Technical Subtitle (Small & Faded) -->
                    <div class="flex items-center gap-1.5 opacity-60 text-gray-700 dark:text-gray-300">
                        <span class="font-mono text-[10px] tracking-tight">{{ tooltipContent.subtitle }}</span>
                    </div>
                </div>
                
                <!-- Triangle indicator -->
                <div class="w-3 h-3 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border-r border-b border-white/20 dark:border-white/10 transform rotate-45 absolute -bottom-1.5 left-1/2 -translate-x-1/2 shadow-[4px_4px_4px_rgba(0,0,0,0.05)]"></div>
            </div>
        </div>
        </Transition>
    </Teleport>
  </div>

</template>

<style scoped>
/* Separated transition durations for Opacity vs Transform/Filter
   Opacity becomes solid almost instantly (0.05s) to hide X-ray effect,
   while Transform pops smoothly (0.2s) */
.tooltip-enter-active {
  transition-property: opacity, transform, filter;
  transition-duration: 0.05s, 0.2s, 0.2s;
  transition-timing-function: ease-out, cubic-bezier(0.16, 1, 0.3, 1), cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
