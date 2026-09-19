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
  player.recoverLayout('attach-sync');
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

  const nextPlayer = new PatchedLyricPlayer();
  nextPlayer.disableBlurFilter = isLowPerformance.value;
  attachPlayer(nextPlayer);
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
  player.setCurrentTime(Math.trunc(props.currentTime), true);
  player.recoverLayout('lyrics-sync');
  queueRecovery('lyrics');
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
