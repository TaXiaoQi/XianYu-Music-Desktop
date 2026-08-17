<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { LyricLine as AmlLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import { PatchedLyricPlayer } from '../../lib/amll/PatchedLyricPlayer';
import { syncAmlLyricSeekLayout } from './amllSeekLayout';
import { usePerformanceMode } from '../../composables/usePerformanceMode';
import { useRenderingPower } from '../../composables/renderingPower';

const props = withDefaults(defineProps<{
  disabled?: boolean;
  playing?: boolean;
  alignAnchor?: 'top' | 'bottom' | 'center';
  alignPosition?: number;
  enableSpring?: boolean;
  enableBlur?: boolean;
  enableScale?: boolean;
  hidePassedLines?: boolean;
  lyricLines?: AmlLyricLine[];
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
  (e: 'line-click', event: LyricLineMouseEvent): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);

const { isLowPerformance } = usePerformanceMode();
const { isMainWindowLowPower } = useRenderingPower();

let player: PatchedLyricPlayer | null = null;
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

// 暂停态下点击歌词跳转时，AML 弹簧动画需要连续帧才能收敛到新目标。
// 正常播放时由 animationLoop 驱动；暂停时 animationLoop 已停止，
// 因此在 syncSeekLayout 后启动一个短暂的动画爆发（约 20 帧 ≈ 320ms）让弹簧落位。
function runSeekBurst() {
  stopSeekBurst();
  let remaining = 20;
  let lastTime = -1;
  const onFrame = (time: number) => {
    if (!player) {
      seekBurstFrameId = 0;
      return;
    }
    if (lastTime === -1) lastTime = time;
    player.update(time - lastTime);
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

  // 窗口最小化/隐藏/迷你模式时暂停 rAF 循环，避免不可见状态下持续写入 DOM transform
  if (props.disabled || !props.playing || isMainWindowLowPower.value) {
    return;
  }

  let lastTime = -1;
  const onFrame = (time: number) => {
    if (!player || props.disabled || !props.playing || isMainWindowLowPower.value) {
      frameId = 0;
      return;
    }

    if (lastTime === -1) {
      lastTime = time;
    }

    player.update(time - lastTime);
    lastTime = time;
    frameId = requestAnimationFrame(onFrame);
  };

  frameId = requestAnimationFrame(onFrame);
}

function applyPlayerProps() {
  if (!player) return;

  player.setAlignAnchor(props.alignAnchor);
  player.setAlignPosition(props.alignPosition);
  player.setEnableSpring(props.enableSpring);
  player.setEnableBlur(props.enableBlur);
  player.setEnableScale(props.enableScale);
  player.setHidePassedLines(props.hidePassedLines);
  player.setWordFadeWidth(props.wordFadeWidth);
  player.setLineGap(props.lineGap);

  if (props.playing) {
    player.resume();
  } else {
    player.pause();
  }
}

function attachPlayer(nextPlayer: PatchedLyricPlayer) {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;

  const playerElement = nextPlayer.getElement();
  playerElement.style.width = '100%';
  playerElement.style.height = '100%';
  wrapper.appendChild(playerElement);
  nextPlayer.addEventListener('line-click', handleLineClick as EventListener);
  player = nextPlayer;
  applyPlayerProps();
  player.setLyricLines(props.lyricLines, Math.trunc(props.currentTime));
  player.setCurrentTime(Math.trunc(props.currentTime));
}

function detachPlayer() {
  if (!player) return;

  player.removeEventListener('line-click', handleLineClick as EventListener);
  player.dispose();
  player = null;
}

function queueRecovery(reason: string) {
  if (!player) return;

  if (recoveryFrameId !== 0) {
    cancelAnimationFrame(recoveryFrameId);
  }

  let attempts = 0;
  let lastTime = -1;
  const runRecovery = (time: number) => {
    if (!player) return;

    if (lastTime === -1) lastTime = time;
    const delta = time - lastTime;
    lastTime = time;

    player.recoverLayout(`${reason}:${attempts}`);
    // recoverLayout 内部的 update(0) 不推进弹簧（delta=0），
    // 暂停态下 animationLoop 已停止，弹簧目标无法收敛到正确位置，
    // 歌词行会停在初始位置（posY=0）全部挤在一起。
    // 用真实时间差 delta 调用 update 推进弹簧收敛。
    if (delta > 0) {
      player.update(delta);
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

function handleLineClick(event: Event) {
  emit('line-click', event as LyricLineMouseEvent);
}

function syncSeekLayout(timeMs: number, lineIndex?: number) {
  if (!player) return;

  syncAmlLyricSeekLayout(player, timeMs, lineIndex);
  // 暂停态下 animationLoop 已停止，弹簧动画无法自动收敛到新目标。
  // 启动短暂的动画爆发让歌词行位移/缩放/模糊落位到点击的行。
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

  // [修复防御]: 低性能模式禁用歌词 blur filter，避免集显每帧 N 行 blur 触发软件渲染
  const nextPlayer = new PatchedLyricPlayer();
  nextPlayer.disableBlurFilter = isLowPerformance.value;
  attachPlayer(nextPlayer);
  startAnimationLoop();
  queueRecovery('mounted');
  // 暂停态下 animationLoop 已停止，挂载后的初始布局弹簧无法收敛，
  // 歌词会停在未落位的位置（屏幕外或不可见）。启动动画爆发让初始布局落位。
  if (!props.playing) {
    runSeekBurst();
  }

  resizeObserver = new ResizeObserver(() => {
    queueRecovery('resize');
    // 暂停态下 animationLoop 已停止，resize 后 calcLayout 重设的弹簧目标无法收敛。
    // 启动动画爆发让弹簧落位到新布局（与 wheel handler 处理方式一致）。
    if (!props.playing) {
      runSeekBurst();
    }
  });
  resizeObserver.observe(wrapper);

  // 暂停态下滚轮滚动歌词：AMLL core 的 wheel handler 只调用 calcLayout 设置弹簧目标，
  // 不调用 update()。播放时 animationLoop 驱动弹簧收敛；暂停时 loop 已停止，
  // 弹簧无法落位。此处监听 wheel 事件（冒泡阶段，在 AMLL core handler 之后触发），
  // 暂停时启动动画爆发让弹簧收敛到新滚动位置。
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

  if (player) {
    detachPlayer();
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
  if (!player) return;

  if (playing) {
    player.resume();
    stopSeekBurst();
    startAnimationLoop();
  } else {
    player.pause();
    stopAnimationLoop();
  }
});

// 窗口最小化时暂停 rAF，恢复时重新启动
watch(isMainWindowLowPower, (lowPower) => {
  if (lowPower) {
    stopAnimationLoop();
  } else if (!props.disabled && props.playing) {
    startAnimationLoop();
  }
});

watch(() => props.alignAnchor, (value) => {
  player?.setAlignAnchor(value);
  queueRecovery('align-anchor');
});

watch(() => props.alignPosition, (value) => {
  player?.setAlignPosition(value);
  queueRecovery('align-position');
});

watch(() => props.enableSpring, (value) => {
  player?.setEnableSpring(value);
  queueRecovery('spring');
});

watch(() => props.enableBlur, (value) => {
  player?.setEnableBlur(value);
  queueRecovery('blur');
});

watch(() => props.enableScale, (value) => {
  player?.setEnableScale(value);
  queueRecovery('scale');
});

watch(() => props.hidePassedLines, (value) => {
  player?.setHidePassedLines(value);
  queueRecovery('hide-passed');
});

watch(() => props.wordFadeWidth, (value) => {
  player?.setWordFadeWidth(value);
  queueRecovery('fade-width');
});

watch(() => props.lineGap, (value) => {
  player?.setLineGap(value);
  queueRecovery('line-gap');
});

watch(() => props.layoutVersion, () => {
  queueRecovery('layout-version');
});

watch(() => props.lyricLines, (value) => {
  if (!player) return;

  player.setLyricLines(value, Math.trunc(props.currentTime));
  // [修复] setLyricLines 内部会强制 setCurrentTime(0, force=true)，把热行重置回首行。
  // 若当前播放进度恰好未变化，currentTime watcher 不会再次触发，导致歌词永远停在首行。
  // 这里在歌词重设后立即用真实进度强制重算热行/滚动位置，恢复正确的当前行。
  player.setCurrentTime(Math.trunc(props.currentTime), true);
  queueRecovery('lyrics');
  // 暂停态下 animationLoop 已停止，calcLayout 设置的弹簧目标无法收敛。
  // 启动动画爆发让歌词行位移/缩放/模糊落位到正确位置，否则歌词加载后不可见。
  if (!props.playing) {
    runSeekBurst();
  }
}, { deep: false });

watch(() => props.currentTime, (value) => {
  if (!player || props.disabled) return;
  player.setCurrentTime(Math.trunc(value));
});


</script>

<template>
  <div ref="wrapperRef" class="w-full h-full min-h-0 min-w-0" />
</template>
