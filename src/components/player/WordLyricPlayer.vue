<script setup lang="ts">
/**
 * 自研逐字歌词播放器组件。
 *
 * 对外保持与歌词视图对接所需的 props / 事件 / expose 面：
 * - `lyricLines` 传入毫秒制逐字行，`currentTime` 毫秒驱动逐字与行切换；
 * - `line-click` 上抛被点击行与其下标，行级 seek 由父组件编排；
 * - `syncSeekLayout` 暴露给父组件在 seek 后同步渲染器布局。
 *
 * 动画内核在 WordLyricPlayer.ts；本组件只负责 props 桥接、
 * rAF 循环调度、暂停期 seek 突发帧、布局恢复与性能降级。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AmlPlayerLine } from '../../composables/lyrics';
import { WordLyricPlayerCore } from './WordLyricPlayer';
import type { WordLyricAlignAnchor, WordLyricLineClickEvent } from './WordLyricPlayer';
import { syncWordLyricSeekLayout } from './seekLayout';
import { usePerformanceMode } from '../../composables/usePerformanceMode';
import { useRenderingPower } from '../../composables/renderingPower';

const props = withDefaults(defineProps<{
  disabled?: boolean;
  playing?: boolean;
  alignAnchor?: WordLyricAlignAnchor;
  alignPosition?: number;
  enableSpring?: boolean;
  enableBlur?: boolean;
  enableScale?: boolean;
  hidePassedLines?: boolean;
  lyricLines?: AmlPlayerLine[];
  currentTime?: number;
  wordFadeWidth?: number;
  lineGap?: number;
  layoutVersion?: string | number;
}>(), {
  disabled: false,
  playing: true,
  alignAnchor: 'center',
  alignPosition: 0.5,
  enableSpring: true,
  enableBlur: true,
  enableScale: true,
  hidePassedLines: false,
  lyricLines: () => [],
  currentTime: 0,
  wordFadeWidth: 0.5,
  lineGap: 1,
  layoutVersion: 0,
});

const emit = defineEmits<{
  (e: 'line-click', event: WordLyricLineClickEvent): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);

const { isLowPerformance } = usePerformanceMode();
const { isMainWindowLowPower } = useRenderingPower();

let core: WordLyricPlayerCore | null = null;
let resizeObserver: ResizeObserver | null = null;
let wheelHandler: ((event: WheelEvent) => void) | null = null;
let frameId = 0;
let recoveryFrameId = 0;
let seekBurstFrameId = 0;

function stopAnimationLoop() {
  if (frameId !== 0) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }
}

function stopSeekBurst() {
  if (seekBurstFrameId !== 0) {
    cancelAnimationFrame(seekBurstFrameId);
    seekBurstFrameId = 0;
  }
}

/** 暂停态下渲染器没有常驻循环，seek / 手动滚动后用一串突发帧把动画收敛到位。 */
function runSeekBurst() {
  stopSeekBurst();
  let remaining = 20;
  let lastTime = -1;
  const onFrame = (time: number) => {
    if (!core) {
      seekBurstFrameId = 0;
      return;
    }
    if (lastTime === -1) lastTime = time;
    core.update(time - lastTime);
    lastTime = time;
    remaining -= 1;
    if (remaining > 0) {
      seekBurstFrameId = requestAnimationFrame(onFrame);
    } else {
      seekBurstFrameId = 0;
    }
  };
  seekBurstFrameId = requestAnimationFrame(onFrame);
}

function startAnimationLoop() {
  stopAnimationLoop();

  if (props.disabled || !props.playing || isMainWindowLowPower.value) {
    return;
  }

  let lastTime = -1;
  const onFrame = (time: number) => {
    if (!core || props.disabled || !props.playing || isMainWindowLowPower.value) {
      frameId = 0;
      return;
    }

    if (lastTime === -1) {
      lastTime = time;
    }

    core.update(time - lastTime);
    lastTime = time;
    frameId = requestAnimationFrame(onFrame);
  };

  frameId = requestAnimationFrame(onFrame);
}

function applyCoreProps() {
  if (!core) return;

  core.setAlignAnchor(props.alignAnchor);
  core.setAlignPosition(props.alignPosition);
  core.setEnableSpring(props.enableSpring);
  core.setEnableBlur(props.enableBlur);
  core.setEnableScale(props.enableScale);
  core.setHidePassedLines(props.hidePassedLines);
  core.setWordFadeWidth(props.wordFadeWidth);
  core.setLineGap(props.lineGap);
  core.setDisableBlurFilter(isLowPerformance.value);
}

function attachCore(nextCore: WordLyricPlayerCore) {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;

  const element = nextCore.getElement();
  element.style.width = '100%';
  element.style.height = '100%';
  wrapper.appendChild(element);
  nextCore.onLineClick(handleLineClick);
  core = nextCore;
  applyCoreProps();
  core.setLyricLines(props.lyricLines, Math.trunc(props.currentTime));
  core.recoverLayout();
}

function detachCore() {
  if (!core) return;

  core.dispose();
  core = null;
}

function queueRecovery(_reason: string) {
  if (!core) return;

  if (recoveryFrameId !== 0) {
    cancelAnimationFrame(recoveryFrameId);
  }

  let attempts = 0;
  let lastTime = -1;
  const runRecovery = (time: number) => {
    if (!core) return;

    if (lastTime === -1) lastTime = time;
    const delta = time - lastTime;
    lastTime = time;

    core.recoverLayout();
    if (delta > 0) {
      core.update(delta);
    }

    if (attempts < 12) {
      attempts += 1;
      recoveryFrameId = requestAnimationFrame(runRecovery);
    } else {
      recoveryFrameId = 0;
    }
  };

  recoveryFrameId = requestAnimationFrame(runRecovery);
}

function handleLineClick(event: WordLyricLineClickEvent) {
  emit('line-click', event);
}

function syncSeekLayout(timeMs: number, lineIndex?: number) {
  if (!core) return;

  syncWordLyricSeekLayout(core, timeMs, lineIndex);
  if (!props.playing) {
    runSeekBurst();
  }
}

defineExpose({
  syncSeekLayout,
});

onMounted(() => {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;

  attachCore(new WordLyricPlayerCore(wrapper));
  startAnimationLoop();
  queueRecovery('mounted');
  if (!props.playing) {
    runSeekBurst();
  }

  resizeObserver = new ResizeObserver(() => {
    queueRecovery('resize');
    if (!props.playing) {
      runSeekBurst();
    }
  });
  resizeObserver.observe(wrapper);

  wheelHandler = () => {
    if (props.disabled || isMainWindowLowPower.value) return;
    if (!props.playing) {
      runSeekBurst();
    }
  };
  wrapper.addEventListener('wheel', wheelHandler, { passive: true });
});

onBeforeUnmount(() => {
  stopAnimationLoop();
  stopSeekBurst();

  if (recoveryFrameId !== 0) {
    cancelAnimationFrame(recoveryFrameId);
    recoveryFrameId = 0;
  }

  resizeObserver?.disconnect();
  resizeObserver = null;

  if (wheelHandler) {
    wrapperRef.value?.removeEventListener('wheel', wheelHandler);
    wheelHandler = null;
  }

  if (core) {
    detachCore();
  }
});

watch(() => props.disabled, (disabled) => {
  if (disabled) {
    stopAnimationLoop();
    return;
  }

  startAnimationLoop();
  queueRecovery('disabled-toggle');
});

watch(() => props.playing, (playing) => {
  if (!core) return;

  core.setPlaying(playing);
  if (playing) {
    stopSeekBurst();
    startAnimationLoop();
  } else {
    stopAnimationLoop();
    runSeekBurst();
  }
});

watch(isMainWindowLowPower, (lowPower) => {
  if (lowPower) {
    stopAnimationLoop();
  } else if (!props.disabled && props.playing) {
    startAnimationLoop();
  }
});

watch(isLowPerformance, (low) => {
  core?.setDisableBlurFilter(low);
});

watch(() => props.alignAnchor, (value) => {
  core?.setAlignAnchor(value);
  queueRecovery('align-anchor');
});

watch(() => props.alignPosition, (value) => {
  core?.setAlignPosition(value);
  queueRecovery('align-position');
});

watch(() => props.enableSpring, (value) => {
  core?.setEnableSpring(value);
  queueRecovery('spring');
});

watch(() => props.enableBlur, (value) => {
  core?.setEnableBlur(value);
  queueRecovery('blur');
});

watch(() => props.enableScale, (value) => {
  core?.setEnableScale(value);
  queueRecovery('scale');
});

watch(() => props.hidePassedLines, (value) => {
  core?.setHidePassedLines(value);
  queueRecovery('hide-passed');
});

watch(() => props.wordFadeWidth, (value) => {
  core?.setWordFadeWidth(value);
});

watch(() => props.lineGap, (value) => {
  core?.setLineGap(value);
  queueRecovery('line-gap');
});

watch(() => props.layoutVersion, () => {
  queueRecovery('layout-version');
});

watch(() => props.lyricLines, (value) => {
  if (!core) return;

  core.setLyricLines(value, Math.trunc(props.currentTime));
  queueRecovery('lyrics');
  if (!props.playing) {
    runSeekBurst();
  }
}, { deep: false });

watch(() => props.currentTime, (value) => {
  if (!core || props.disabled) return;
  core.setCurrentTime(Math.trunc(value));
});
</script>

<template>
  <div ref="wrapperRef" class="w-full h-full min-h-0 min-w-0" />
</template>

<style scoped>
/* 内核 DOM 为命令式创建，须借 :deep() 穿透模板根节点下发样式 */

:deep(.wlp-lyric-player) {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.95);
  mix-blend-mode: plus-lighter;
  line-height: 1.2em;
  font-size: calc(max(max(5vh, 2.5vw), 12px) * var(--lyrics-font-scale, 1));
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
  user-select: none;
  -webkit-user-select: none;
}

@media screen and (max-width: 768px) {
  :deep(.wlp-lyric-player) {
    font-size: calc(max(8vw, 12px) * var(--lyrics-font-scale, 1));
  }
}

/* ---------- 行 ---------- */

:deep(.wlp-line) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 0.5em 1em;
  border-radius: 0.25em;
  text-align: var(--lyrics-text-align, left);
  backface-visibility: hidden;
  will-change: transform, filter, opacity;
  cursor: pointer;
  transition: background-color 0.25s;
}

:deep(.wlp-line:hover) {
  background-color: rgba(255, 255, 255, 0.07);
}

:deep(.wlp-line:active) {
  background-color: rgba(255, 255, 255, 0.02);
}

:deep(.wlp-line--bg) {
  font-size: max(0.7em, 10px);
  padding-top: 1vh;
  padding-bottom: 1vh;
}

/* ---------- 主行与逐字 ---------- */

:deep(.wlp-line__main) {
  display: block;
  white-space: pre-wrap;
}

:deep(.wlp-word) {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  vertical-align: top;
  will-change: transform;
  transition: transform 0.25s ease;
}

:deep(.wlp-word--glow) {
  transform: scale(1.05);
}

:deep(.wlp-word--glow .wlp-word__text) {
  text-shadow: 0 0 0.35em rgba(255, 255, 255, 0.75);
}

:deep(.wlp-word__text) {
  display: inline-block;
  white-space: pre-wrap;
}

:deep(.wlp-word__roman) {
  font-size: 0.5em;
  line-height: 1.1em;
  opacity: 0.85;
  white-space: pre;
}

/* ---------- 副行（罗马音 / 翻译） ---------- */

:deep(.wlp-line__sub) {
  opacity: 0.3;
  font-size: max(0.5em, 10px);
  line-height: 1.5em;
  margin-top: 0.1em;
  white-space: pre-wrap;
}

/* ---------- 间奏呼吸点 ---------- */

:deep(.wlp-interlude-dots) {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 0.25em;
  height: clamp(0.5em, 1vh, 3em);
  padding: 2.5% 0.75em;
  padding-left: 1em;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

:deep(.wlp-interlude-dots__dot) {
  width: clamp(0.5em, 1vh, 3em);
  height: clamp(0.5em, 1vh, 3em);
  border-radius: 50%;
  background-color: currentColor;
}
</style>
