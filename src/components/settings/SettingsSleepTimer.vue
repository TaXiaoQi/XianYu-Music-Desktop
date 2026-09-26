<script setup lang="ts">
/**
 * 睡眠定时设置页：倒计时 / 空闲两种触发方式 + 到点后的三种动作。
 * 计时与执行都在 Rust（src-tauri/src/sleep_timer.rs），本页只做配置与显示。
 */
import { onMounted } from 'vue';

import { useI18n } from '../../features/i18n';
import { useSleepTimerStore } from '../../features/sleepTimer/store';
import type { SleepTimerAction } from '../../types';
import type { SleepTimerMode } from '../../features/sleepTimer/store';

const { t } = useI18n();
const sleepTimer = useSleepTimerStore();

const COUNTDOWN_PRESETS = [15, 30, 45, 60, 90];
const IDLE_PRESETS = [10, 20, 30, 60];

const rowClass = 'flex items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';
const chipClass = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all';
const chipActiveClass = 'border-[#EC4141] bg-[#EC4141]/8 text-[#EC4141]';
const chipIdleClass = 'border-gray-200/40 bg-white/20 text-gray-700 hover:border-[#EC4141]/40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200';

function selectChipClass(active: boolean) {
  return `${chipClass} ${active ? chipActiveClass : chipIdleClass}`;
}

function setMode(mode: SleepTimerMode) {
  sleepTimer.mode = mode;
}

function setAction(action: SleepTimerAction) {
  sleepTimer.action = action;
}

onMounted(() => {
  // 后端才是权威：重进本页时与它对齐（例如切过标签页、或刷新过界面）
  void sleepTimer.syncFromBackend();
});
</script>

<template>
  <section class="space-y-3">
    <div class="px-1">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.title') }}</h2>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.description') }}</p>
    </div>

    <div :class="rowClass">
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.modeLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.modeHint') }}</span>
      </span>
      <div class="flex shrink-0 gap-2">
        <button type="button" :class="selectChipClass(sleepTimer.mode === 'countdown')" @click="setMode('countdown')">
          {{ t('sleepTimer.modeCountdown') }}
        </button>
        <button type="button" :class="selectChipClass(sleepTimer.mode === 'idle')" @click="setMode('idle')">
          {{ t('sleepTimer.modeIdle') }}
        </button>
      </div>
    </div>

    <div v-if="sleepTimer.mode === 'countdown'" :class="rowClass">
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.countdownLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.countdownHint') }}</span>
      </span>
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-for="minutes in COUNTDOWN_PRESETS"
          :key="minutes"
          type="button"
          :class="selectChipClass(sleepTimer.countdownMinutes === minutes)"
          @click="sleepTimer.countdownMinutes = minutes"
        >
          {{ minutes }} {{ t('sleepTimer.minutes') }}
        </button>
        <input
          v-model.number="sleepTimer.countdownMinutes"
          type="number"
          min="1"
          max="600"
          class="w-16 rounded-lg border border-gray-200/40 bg-white/30 px-2 py-1.5 text-xs text-gray-700 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200"
          :aria-label="t('sleepTimer.customMinutes')"
        >
      </div>
    </div>

    <div v-else :class="rowClass">
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.idleLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.idleHint') }}</span>
      </span>
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-for="minutes in IDLE_PRESETS"
          :key="minutes"
          type="button"
          :class="selectChipClass(sleepTimer.idleMinutes === minutes)"
          @click="sleepTimer.idleMinutes = minutes"
        >
          {{ minutes }} {{ t('sleepTimer.minutes') }}
        </button>
      </div>
    </div>

    <div :class="rowClass">
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.actionLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.actionHint') }}</span>
      </span>
      <div class="flex shrink-0 gap-2">
        <button type="button" :class="selectChipClass(sleepTimer.action === 'pause')" @click="setAction('pause')">
          {{ t('sleepTimer.actionPause') }}
        </button>
        <button type="button" :class="selectChipClass(sleepTimer.action === 'exit')" @click="setAction('exit')">
          {{ t('sleepTimer.actionExit') }}
        </button>
        <button type="button" :class="selectChipClass(sleepTimer.action === 'hide_to_tray')" @click="setAction('hide_to_tray')">
          {{ t('sleepTimer.actionHideToTray') }}
        </button>
      </div>
    </div>

    <div :class="rowClass">
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">
          {{ sleepTimer.running ? t('sleepTimer.runningLabel') : t('sleepTimer.idle') }}
        </span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
          {{ sleepTimer.running ? sleepTimer.runningLabel : t('sleepTimer.notRunningHint') }}
        </span>
      </span>
      <button
        type="button"
        class="shrink-0 rounded-lg bg-[#EC4141] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        @click="sleepTimer.running ? sleepTimer.cancel() : sleepTimer.start()"
      >
        {{ sleepTimer.running ? t('sleepTimer.cancel') : t('sleepTimer.start') }}
      </button>
    </div>
  </section>
</template>
