<script setup lang="ts">
/**
 * 写实唱机皮肤容器：金属转盘 + 封面盘（VinylCoverDisc）+ 唱臂总成（VinylTonearm），
 * 与 PlayerDetailLeft 占据同一布局位（左 40% 区域中央），
 * 封面加载逻辑复用 useDetailCover。点击转盘触发封面隐藏 toggle。
 */
import { computed, ref } from 'vue';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useDetailCover } from '../../composables/useDetailCover';
import { useThemeSettings } from '../../composables/useThemeSettings';
import VinylCoverDisc from './VinylCoverDisc.vue';
import VinylTonearm from './VinylTonearm.vue';

const props = defineProps<{
  isExpanded?: boolean;
  coverHidden?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-cover'): void;
}>();

const { isPlaying, dominantColors } = usePlaybackController();
const isExpandedRef = computed(() => Boolean(props.isExpanded));

const {
  currentSongPath,
  displayedLocalCoverUrl,
  currentBigCoverUrl,
  onBigCoverLoad,
  onBigCoverError,
  onLocalCoverError,
} = useDetailCover({ isExpanded: isExpandedRef });

/** 盘心展示的封面：优先大图，回退缩略图 */
const coverUrl = computed(() => currentBigCoverUrl.value || displayedLocalCoverUrl.value || '');

const accentColor = computed(() => dominantColors.value[0] || '#EC4141');

const { theme: themeSettings } = useThemeSettings();
/** 底座材质：浅灰（默认）/ 哑光深灰 / 橡木 / 大理石（设置 → 外观 → 底座材质） */
const plinthMaterial = computed(() => themeSettings.value?.playerDetailVinylMaterial ?? 'light');

const detailCoverRef = ref<HTMLElement | null>(null);
defineExpose({ detailCoverRef });

/**
 * 俯视写实唱机的布局，数值均为方形容器的百分比。
 * 座体略宽于容器（父级 overflow-visible，不会裁切），右侧留给唱臂总成。
 */
const PLINTH = { width: 108, height: 92, top: 4 } as const;
/** 转盘：大圆盘略偏左，左侧留出可见的座体边距，右侧留出枢轴与配重的空间 */
const PLATTER = { centerX: 46, centerY: 50, diameter: 86 } as const;
/** 封面盘占转盘直径的比例（参考机型约 0.47）：封面外的金属环即为落针区 */
const COVER_RATIO = 0.465;

const plinthStyle = {
  left: `${(100 - PLINTH.width) / 2}%`,
  top: `${PLINTH.top}%`,
  width: `${PLINTH.width}%`,
  height: `${PLINTH.height}%`,
};

const platterStyle = {
  left: `${PLATTER.centerX - PLATTER.diameter / 2}%`,
  top: `${PLATTER.centerY - PLATTER.diameter / 2}%`,
  width: `${PLATTER.diameter}%`,
  height: `${PLATTER.diameter}%`,
};

const coverStyle = (() => {
  const diameter = PLATTER.diameter * COVER_RATIO;
  return {
    left: `${PLATTER.centerX - diameter / 2}%`,
    top: `${PLATTER.centerY - diameter / 2}%`,
    width: `${diameter}%`,
    height: `${diameter}%`,
  };
})();

const handleCoverClick = (event: MouseEvent) => {
  event.stopPropagation();
  emit('toggle-cover');
};
</script>

<template>
  <div class="pointer-events-none">
    <div
      ref="detailCoverRef"
      class="absolute aspect-square transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] z-[70] will-change-transform"
      :class="[
        props.isExpanded ? 'top-[45%] left-[calc(75px+18%)] -translate-x-1/2 -translate-y-1/2 w-[clamp(220px,45vh,580px)]' : 'top-[calc(100vh-64px)] left-[16px] translate-x-0 translate-y-0 w-12 rounded-full',
        props.coverHidden ? 'opacity-0 pointer-events-none' : (props.isExpanded ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'),
      ]"
      @click="handleCoverClick"
    >
      <!-- 大图预加载（隐藏 img，仅触发缓存加载与 onload 回调） -->
      <img
        v-if="currentBigCoverUrl"
        :key="`preload:${currentSongPath}:${currentBigCoverUrl}`"
        :src="currentBigCoverUrl"
        class="hidden"
        alt=""
        @load="onBigCoverLoad"
        @error="onBigCoverError"
        decoding="async"
        referrerpolicy="no-referrer"
      >
      <!-- 缩略图加载失败标记（不渲染，仅触发 onerror 回调） -->
      <img
        v-if="displayedLocalCoverUrl && !currentBigCoverUrl"
        :key="`thumb:${currentSongPath}:${displayedLocalCoverUrl}`"
        :src="displayedLocalCoverUrl"
        class="hidden"
        alt=""
        @error="onLocalCoverError"
        decoding="async"
        referrerpolicy="no-referrer"
      >

      <template v-if="props.isExpanded">
        <!-- 座体：材质由 turntable-plinth--* 决定，公共部分只有圆角 -->
        <div
          class="turntable-plinth absolute"
          :class="`turntable-plinth--${plinthMaterial}`"
          :style="plinthStyle"
        >
          <div class="turntable-top-plate absolute inset-[2.6%] rounded-[4%]">
            <!-- 木纹：细纹先画成直纹，再用湍流噪声做位移，得到不机械的顺纹 -->
            <svg
              v-if="plinthMaterial === 'oak'"
              class="turntable-texture absolute inset-0 h-full w-full rounded-[4%]"
              viewBox="0 0 600 420"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <defs>
                <pattern id="xy-oak-grain" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(2)">
                  <line x1="0" y1="0" x2="0" y2="28" stroke="rgba(66, 39, 14, 0.5)" stroke-width="1.1" />
                  <line x1="9" y1="0" x2="9" y2="28" stroke="rgba(255, 226, 186, 0.14)" stroke-width="0.7" />
                  <line x1="18" y1="0" x2="18" y2="28" stroke="rgba(84, 52, 22, 0.3)" stroke-width="0.8" />
                </pattern>
                <filter id="xy-oak-warp" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.005 0.022" numOctaves="4" seed="13" result="warp" />
                  <feDisplacementMap in="SourceGraphic" in2="warp" xChannelSelector="R" yChannelSelector="G" scale="16" />
                </filter>
                <filter id="xy-oak-fine" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="4" />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <radialGradient id="xy-oak-sheen" cx="36%" cy="26%" r="88%">
                  <stop offset="0" stop-color="rgba(255, 236, 206, 0.32)" />
                  <stop offset="0.55" stop-color="rgba(255, 236, 206, 0.05)" />
                  <stop offset="1" stop-color="rgba(0, 0, 0, 0.22)" />
                </radialGradient>
              </defs>
              <rect width="600" height="420" fill="#a8763f" />
              <rect width="600" height="420" fill="url(#xy-oak-grain)" filter="url(#xy-oak-warp)" opacity="0.9" />
              <rect width="600" height="420" filter="url(#xy-oak-fine)" opacity="0.05" style="mix-blend-mode: multiply" />
              <rect width="600" height="420" fill="url(#xy-oak-sheen)" />
            </svg>

            <!-- 石纹：同样用位移把直纹揉成脉络，另加一层宽纹与石材颗粒 -->
            <svg
              v-else-if="plinthMaterial === 'marble'"
              class="turntable-texture absolute inset-0 h-full w-full rounded-[4%]"
              viewBox="0 0 600 420"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <defs>
                <pattern id="xy-marble-veins-fine" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(26)">
                  <line x1="0" y1="0" x2="0" y2="64" stroke="rgba(74, 80, 92, 0.42)" stroke-width="1.2" />
                  <line x1="20" y1="0" x2="20" y2="64" stroke="rgba(74, 80, 92, 0.2)" stroke-width="0.7" />
                  <line x1="45" y1="0" x2="45" y2="64" stroke="rgba(88, 94, 106, 0.12)" stroke-width="0.6" />
                </pattern>
                <pattern id="xy-marble-veins-broad" width="168" height="168" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)">
                  <line x1="0" y1="0" x2="0" y2="168" stroke="rgba(64, 70, 84, 0.3)" stroke-width="2.6" />
                </pattern>
                <filter id="xy-marble-warp" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.007 0.011" numOctaves="4" seed="23" result="warp" />
                  <feDisplacementMap in="SourceGraphic" in2="warp" xChannelSelector="R" yChannelSelector="G" scale="44" />
                  <feGaussianBlur stdDeviation="0.45" />
                </filter>
                <filter id="xy-marble-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="6" />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <radialGradient id="xy-marble-sheen" cx="36%" cy="26%" r="90%">
                  <stop offset="0" stop-color="rgba(255, 255, 255, 0.32)" />
                  <stop offset="0.5" stop-color="rgba(255, 255, 255, 0.04)" />
                  <stop offset="1" stop-color="rgba(28, 30, 36, 0.18)" />
                </radialGradient>
              </defs>
              <rect width="600" height="420" fill="#efede9" />
              <rect width="600" height="420" fill="url(#xy-marble-veins-broad)" filter="url(#xy-marble-warp)" opacity="0.7" />
              <rect width="600" height="420" fill="url(#xy-marble-veins-fine)" filter="url(#xy-marble-warp)" opacity="0.92" />
              <rect width="600" height="420" filter="url(#xy-marble-grain)" opacity="0.05" style="mix-blend-mode: multiply" />
              <rect width="600" height="420" fill="url(#xy-marble-sheen)" />
            </svg>
          </div>
          <!-- 支脚：从座体下缘露出一点点（浅灰机身不露脚，见样式表） -->
          <div class="turntable-foot left-[10%]" />
          <div class="turntable-foot right-[10%]" />
        </div>

        <!-- 转盘：拉丝铝大圆盘，封面盘直接贴在其中心 -->
        <div class="turntable-platter absolute rounded-full" :style="platterStyle" />

        <VinylCoverDisc
          :cover="coverUrl"
          :is-playing="isPlaying"
          :accent="accentColor"
          class="absolute"
          :style="coverStyle"
        />
        <VinylTonearm
          :is-playing="isPlaying"
          :song-key="currentSongPath"
        />
      </template>
      <!-- 收起态（底栏小封面）保持普通缩略图 -->
      <div v-else class="h-full w-full overflow-hidden rounded-full">
        <img
          v-if="displayedLocalCoverUrl"
          :src="displayedLocalCoverUrl"
          class="h-full w-full object-cover"
          draggable="false"
          decoding="async"
          referrerpolicy="no-referrer"
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
/* —— 俯视写实唱机：座体 / 转盘 —— */

/* 座体与顶面板：结构性规则（外观全部由下方的材质类给出） */
.turntable-plinth {
  border-radius: 5%;
}

.turntable-top-plate {
  border-radius: 4%;
}

/* 支脚：只从座体下缘露出一点点 */
.turntable-foot {
  position: absolute;
  bottom: -2.6%;
  width: 9%;
  height: 6%;
  border-radius: 45%;
  background: linear-gradient(180deg, #16171b 0%, #0a0b0d 100%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
}

/* 转盘：拉丝铝盘面 —— 左上一大片柔和受光、右下渐暗，盘缘一圈细亮环 */
.turntable-platter {
  background:
    repeating-conic-gradient(
      from 0deg,
      rgba(255, 255, 255, 0.03) 0deg 1.2deg,
      rgba(0, 0, 0, 0.012) 1.2deg 2.4deg
    ),
    radial-gradient(
      circle at 36% 24%,
      #f5f7fa 0%,
      #e0e4ea 16%,
      #c4c9d1 38%,
      #a9afb8 60%,
      #8e949e 80%,
      #777d87 100%
    );
  box-shadow:
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.5),
    inset 0 2px 6px rgba(255, 255, 255, 0.35),
    inset 0 -10px 26px rgba(40, 45, 55, 0.28),
    0 12px 28px rgba(10, 12, 18, 0.42),
    0 3px 8px rgba(10, 12, 18, 0.3);
}

/* —— 底座材质 —— */

/* 浅灰（默认）：素净的浅色机身，几乎不反光，靠柔和落地投影撑起体积 */
.turntable-plinth--light {
  background: linear-gradient(180deg, #eceef1 0%, #e2e4e8 52%, #cdd0d5 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 -1px 0 rgba(140, 145, 155, 0.35),
    0 34px 60px rgba(15, 18, 25, 0.34),
    0 12px 24px rgba(15, 18, 25, 0.2);
}

.turntable-plinth--light .turntable-top-plate {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.62) 0%, rgba(206, 210, 216, 0.34) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 8px 18px rgba(150, 156, 168, 0.16);
}

/* 浅灰是整块落地的素净机身，不露支脚 */
.turntable-plinth--light .turntable-foot {
  display: none;
}

/* 哑光深灰：深灰底 + 左上受光、底部沉下去 */
.turntable-plinth--matte {
  background:
    linear-gradient(158deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 46%),
    linear-gradient(180deg, #23242a 0%, #1a1b1f 48%, #101114 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.09),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
    0 30px 64px rgba(0, 0, 0, 0.66),
    0 12px 26px rgba(0, 0, 0, 0.5);
}

/* 顶面板：细密拉丝 + 与座体之间的落差 */
.turntable-plinth--matte .turntable-top-plate {
  background:
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.016) 0 1px,
      rgba(0, 0, 0, 0.014) 1px 3px
    ),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(0, 0, 0, 0.17) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    inset 0 10px 22px rgba(0, 0, 0, 0.34);
}

/* 橡木：暖棕底 + 顺纹路（细密纹 + 宽年轮两层），顶面比侧面亮 */
.turntable-plinth--oak {
  background:
    linear-gradient(158deg, rgba(255, 240, 214, 0.1) 0%, rgba(255, 255, 255, 0) 46%),
    linear-gradient(180deg, #8d6238 0%, #6f4a29 48%, #4b3119 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 231, 194, 0.28),
    inset 0 -1px 0 rgba(0, 0, 0, 0.5),
    0 30px 64px rgba(0, 0, 0, 0.62),
    0 12px 26px rgba(0, 0, 0, 0.46);
}

.turntable-plinth--oak .turntable-top-plate {
  background: linear-gradient(180deg, #a8763f 0%, #8a5c30 52%, #6b4522 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 235, 200, 0.3),
    inset 0 10px 24px rgba(0, 0, 0, 0.28);
}

/* 大理石：白石底 + 湍流噪声揉出的脉络 */
.turntable-plinth--marble {
  background:
    linear-gradient(158deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0) 46%),
    linear-gradient(180deg, #d9d6cf 0%, #c2bfb8 48%, #9d9a94 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    inset 0 -1px 0 rgba(0, 0, 0, 0.34),
    0 30px 64px rgba(0, 0, 0, 0.5),
    0 12px 26px rgba(0, 0, 0, 0.34);
}

.turntable-plinth--marble .turntable-top-plate {
  background: radial-gradient(circle at 40% 30%, #f4f2ee 0%, #e2dfd9 46%, #cbc8c1 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.75),
    inset 0 10px 24px rgba(0, 0, 0, 0.14);
}
</style>
