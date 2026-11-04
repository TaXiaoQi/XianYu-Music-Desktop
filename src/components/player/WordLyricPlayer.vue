<script setup lang="ts">
/**
 * 自研逐字歌词播放器组件。
 *
 * 对外保持与歌词视图对接所需的 props / 事件 / expose 面：
 * - `lyricLines` 传入毫秒制逐字行，`currentTime` 毫秒驱动逐字与行切换；
 * - `line-click` 上抛被点击行与其下标，行级 seek 由父组件编排；
 * - `syncSeekLayout` 暴露给父组件在 seek 后重排渲染器（弹簧滚动动画落位）。
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
let frameId = 0;
let recoveryFrameId = 0;
let seekBurstFrameId = 0;
/** 突发帧上一帧时间戳；跨滚动事件保持（突发帧复用，不随事件重启归零）。 */
let burstLastTime = -1;

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
  burstLastTime = -1;
}

/** 暂停态下渲染器没有常驻循环，seek / 手动滚动后用突发帧把动画收敛到位。 */
function runSeekBurst() {
  // 已在收敛中的突发帧直接复用：它在逐帧追赶最新目标，无需也不可重启。
  // 旧实现每个滚动事件都 stop + 重建，而触控板惯性事件（~10ms 一个）比帧间隔密，
  // 导致执行到的每帧都是 lastTime 归零的首帧（delta=0），暂停态滚动全程冻结、
  // 手势结束后才一次性追上——表现为滑完约 1s 才到位（播放态常驻循环不受影响）。
  if (seekBurstFrameId !== 0) return;
  // 收敛驱动：跑到渲染器无待定动画为止（级联延迟 / 弹簧 / 明暗），上限约 10s 兜底
  let remaining = 600;
  const onFrame = (time: number) => {
    if (!core || props.disabled) {
      seekBurstFrameId = 0;
      burstLastTime = -1;
      return;
    }
    if (burstLastTime === -1) burstLastTime = time;
    core.update(time - burstLastTime);
    burstLastTime = time;
    remaining -= 1;
    if (remaining > 0 && core.hasPendingMotion()) {
      seekBurstFrameId = requestAnimationFrame(onFrame);
    } else {
      seekBurstFrameId = 0;
      burstLastTime = -1;
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
  // 滚轮 / 拖拽 / 回弹由 core 内部处理并回调，暂停态下宿主借此补突发帧驱动滚动动画
  nextCore.setOnScrollActivity(() => {
    if (props.disabled || isMainWindowLowPower.value) return;
    if (!props.playing) runSeekBurst();
  });
  core = nextCore;
  applyCoreProps();
  // 内核默认 playing=true，而 playing 的 watch 只响应变化；
  // 暂停态下挂载（热更新 / 重挂载）若不同步，resize 突发帧会
  // 按“播放中”逐帧推进时间，表现为暂停态缩放后歌词自动前进一行。
  nextCore.setPlaying(props.playing);
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

/** 连续窗口变化（mac 原生全屏动画逐帧改写视口）视为结束的静默期 */
const RESIZE_SETTLE_MS = 160;
let resizeSettleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 连续 resize 的结算入口：尺寸停止变化后重算一次弹簧目标并驱动收敛。
 * 播放态由动画循环逐帧追赶、暂停态由突发帧收敛到无待定动画为止；
 * 全程不做 sync 吸附（瞬移会造成上下跳变），与页面其它部分的
 * 「同一次重排、同刻切换」保持一致（对齐 Windows 的瞬时 resize 观感）。
 */
function scheduleResizeSettle() {
  if (resizeSettleTimer !== null) {
    clearTimeout(resizeSettleTimer);
  }
  resizeSettleTimer = setTimeout(() => {
    resizeSettleTimer = null;
    if (!core) return;
    core.refreshLayoutTargets();
    if (!props.playing) {
      runSeekBurst();
    }
  }, RESIZE_SETTLE_MS);
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
    if (!core) return;
    // mac 原生全屏动画会逐帧改写视口尺寸：逐帧同步吸附（queueRecovery）
    // 会让歌词上下跳变。这里只标脏、由动画循环 / 暂停态突发帧平滑追赶，
    // 待尺寸停止变化后再一次性落位对齐。
    core.markLayoutDirty();
    if (!props.playing) {
      runSeekBurst();
    }
    scheduleResizeSettle();
  });
  resizeObserver.observe(wrapper);
});

onBeforeUnmount(() => {
  stopAnimationLoop();
  stopSeekBurst();

  if (resizeSettleTimer !== null) {
    clearTimeout(resizeSettleTimer);
    resizeSettleTimer = null;
  }

  if (recoveryFrameId !== 0) {
    cancelAnimationFrame(recoveryFrameId);
    recoveryFrameId = 0;
  }

  if (resizeSettleTimer !== null) {
    clearTimeout(resizeSettleTimer);
    resizeSettleTimer = null;
  }

  resizeObserver?.disconnect();
  resizeObserver = null;

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
  font-weight: 700;
  line-height: 1.35em;
  font-size: calc(max(max(5vh, 2.5vw), 12px) * var(--lyrics-font-scale, 1));
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
  user-select: none;
  -webkit-user-select: none;
  /* 按住拖拽浏览由 pointer 事件实现，屏蔽触摸屏默认手势劫持 */
  touch-action: none;
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
  padding: 0.35em 1em;
  border-radius: 0.25em;
  text-align: var(--lyrics-text-align, left);
  backface-visibility: hidden;
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
}

/* 唱毕词的余晖辉光（对齐移动端 Shadow α0.35 / blur10，按字号等比换算） */
:deep(.wlp-word--glow .wlp-word__text) {
  text-shadow: 0 0 0.36em rgba(255, 255, 255, 0.35);
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
  font-size: max(0.62em, 10px);
  line-height: 1.35em;
  margin-top: 0.2em;
  font-weight: 500;
  white-space: pre-wrap;
}

:deep(.wlp-line__sub--roman) {
  line-height: 1.2em;
}

/* 子行明暗由遮罩表达（未唱 .34、已唱全亮），进度由内核逐帧写进 --xy-sub-line-progress。
   遮罩挂在文本包裹层上：inline-block 使其宽度恰好等于文本宽度，扫光因此正好覆盖文本、
   与主行逐字高光同时结束，翻译比整行短也不会提前扫完。 */
:deep(.wlp-line__sub-text) {
  display: inline-block;
  -webkit-mask-image: linear-gradient(
    90deg,
    #000 var(--xy-sub-line-progress, 0%),
    rgba(0, 0, 0, 0.34) var(--xy-sub-line-progress, 0%)
  );
  mask-image: linear-gradient(
    90deg,
    #000 var(--xy-sub-line-progress, 0%),
    rgba(0, 0, 0, 0.34) var(--xy-sub-line-progress, 0%)
  );
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
