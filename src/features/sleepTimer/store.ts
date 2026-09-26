import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { sleepTimerApi } from './api';
import { formatRemaining, shouldFireIdle } from './idle';
import type { SleepTimerAction } from '../../types';

/** 两种触发方式互斥：到点倒计时 / 应用内空闲 */
export type SleepTimerMode = 'countdown' | 'idle';

/**
 * 睡眠定时的会话状态（不写入 settings、不持久化）。
 *
 * 倒计时的权威计时在 Rust：这里只做显示用的每秒递减，并以后端快照为准；
 * 空闲模式没有后端计时，由这里的心跳（tick）判断，触发后再交给 Rust 执行。
 */
export const useSleepTimerStore = defineStore('sleepTimer', () => {
  const mode = ref<SleepTimerMode>('countdown');
  const action = ref<SleepTimerAction>('pause');
  const countdownMinutes = ref(30);
  const idleMinutes = ref(30);

  /** 倒计时剩余秒数（仅用于显示） */
  const remainingSeconds = ref(0);
  /** 是否已开始：倒计时=后端已受理，空闲=看门狗在跑 */
  const running = ref(false);
  /** 最后一次应用内活动时间戳 */
  const lastActivityAt = ref(Date.now());

  const remainingLabel = computed(() => formatRemaining(remainingSeconds.value));
  /** 运行中的提示文案用得到（倒计时显示剩余，空闲显示阈值） */
  const runningLabel = computed(() => (
    mode.value === 'countdown' ? remainingLabel.value : `${idleMinutes.value} min`
  ));

  async function start() {
    lastActivityAt.value = Date.now();

    if (mode.value === 'idle') {
      remainingSeconds.value = 0;
      running.value = true;
      return;
    }

    const snapshot = await sleepTimerApi.set(Math.round(countdownMinutes.value * 60), action.value);
    action.value = snapshot.action;
    remainingSeconds.value = snapshot.remaining_seconds;
    running.value = true;
  }

  function cancel() {
    if (running.value && mode.value === 'countdown') {
      void sleepTimerApi.clear();
    }
    running.value = false;
    remainingSeconds.value = 0;
  }

  /** 记录一次应用内活动（空闲模式据此重新计时） */
  function noteActivity(nowMs: number) {
    lastActivityAt.value = nowMs;
  }

  /** 每秒心跳：倒计时递减显示；空闲模式判定是否需要收尾 */
  async function tick(nowMs: number, isPlaying: boolean) {
    if (!running.value) return;

    if (mode.value === 'countdown') {
      remainingSeconds.value = Math.max(0, remainingSeconds.value - 1);
      return;
    }

    const shouldFire = shouldFireIdle({
      lastActivityMs: lastActivityAt.value,
      nowMs,
      idleMinutes: idleMinutes.value,
      isPlaying,
    });
    if (!shouldFire) return;

    // 先落状态再调用：避免心跳在等待期间重复触发
    running.value = false;
    await sleepTimerApi.runAction(action.value);
  }

  /** 后端到点后的事件同步（Rust 已经淡出并暂停了） */
  function handleFired(firedAction: SleepTimerAction) {
    running.value = false;
    remainingSeconds.value = 0;
    action.value = firedAction;
  }

  /** 重进设置页时与后端对齐（后端才是权威） */
  async function syncFromBackend() {
    const snapshot = await sleepTimerApi.get();
    if (!snapshot) {
      running.value = false;
      remainingSeconds.value = 0;
      return;
    }
    action.value = snapshot.action;
    remainingSeconds.value = snapshot.remaining_seconds;
    mode.value = 'countdown';
    running.value = true;
  }

  return {
    mode,
    action,
    countdownMinutes,
    idleMinutes,
    remainingSeconds,
    remainingLabel,
    runningLabel,
    running,
    lastActivityAt,
    start,
    cancel,
    noteActivity,
    tick,
    handleFired,
    syncFromBackend,
  };
});
