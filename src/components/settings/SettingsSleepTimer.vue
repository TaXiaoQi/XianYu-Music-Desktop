<script setup lang="ts">
/**
 * 睡眠定时设置页：倒计时 / 空闲两种触发方式 + 到点后的三种动作。
 * 计时与执行都在 Rust（src-tauri/src/sleep_timer.rs），本页只做配置与显示。
 */
import { computed, onMounted } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';

import { useI18n } from '../../features/i18n';
import { useSleepTimerStore } from '../../features/sleepTimer/store';
import { useInlineSelectDropdown } from '../../composables/useInlineSelectDropdown';
import type { SleepTimerAction } from '../../types';
import type { SleepTimerMode } from '../../features/sleepTimer/store';

const { t } = useI18n();
const sleepTimer = useSleepTimerStore();

const COUNTDOWN_PRESETS = [15, 30, 45, 60, 90];
const IDLE_PRESETS = [10, 20, 30, 60];

const rowClass = 'flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';

// --- 行内下拉（触发按钮下方展开，互斥单开） ---
const {
  openId: openDropdownId,
  panelRef: dropdownPanelRef,
  panelStyle: dropdownPanelStyle,
  registerTrigger,
  toggle: toggleDropdown,
  close: closeDropdown,
} = useInlineSelectDropdown();

const modeOptions = computed<{ value: SleepTimerMode; label: string }[]>(() => [
  { value: 'countdown', label: t('sleepTimer.modeCountdown') },
  { value: 'idle', label: t('sleepTimer.modeIdle') },
]);

const actionOptions = computed<{ value: SleepTimerAction; label: string }[]>(() => [
  { value: 'pause', label: t('sleepTimer.actionPause') },
  { value: 'exit', label: t('sleepTimer.actionExit') },
  { value: 'hide_to_tray', label: t('sleepTimer.actionHideToTray') },
]);

const modeLabel = computed(() => modeOptions.value.find(o => o.value === sleepTimer.mode)?.label ?? '');
const actionLabel = computed(() => actionOptions.value.find(o => o.value === sleepTimer.action)?.label ?? '');
const countdownLabel = computed(() => `${sleepTimer.countdownMinutes} ${t('sleepTimer.minutes')}`);
const idleLabel = computed(() => `${sleepTimer.idleMinutes} ${t('sleepTimer.minutes')}`);

function setMode(mode: SleepTimerMode) {
  sleepTimer.mode = mode;
  closeDropdown();
}

function setAction(action: SleepTimerAction) {
  sleepTimer.action = action;
  closeDropdown();
}

function setCountdownMinutes(minutes: number) {
  sleepTimer.countdownMinutes = minutes;
  closeDropdown();
}

function setIdleMinutes(minutes: number) {
  sleepTimer.idleMinutes = minutes;
  closeDropdown();
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
      <span class="min-w-[12rem] flex-1">
        <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.modeLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.modeHint') }}</span>
      </span>
      <button
        type="button"
        :ref="(el) => registerTrigger('sleepMode', el)"
        class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
        @click="toggleDropdown('sleepMode')"
      >
        <span>{{ modeLabel }}</span>
        <ChevronDown
          class="h-4 w-4 text-gray-400 transition-transform duration-200"
          :class="openDropdownId === 'sleepMode' ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>

    <div v-if="sleepTimer.mode === 'countdown'" :class="rowClass">
      <span class="min-w-[12rem] flex-1">
        <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.countdownLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.countdownHint') }}</span>
      </span>
      <button
        type="button"
        :ref="(el) => registerTrigger('countdownMinutes', el)"
        class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
        @click="toggleDropdown('countdownMinutes')"
      >
        <span>{{ countdownLabel }}</span>
        <ChevronDown
          class="h-4 w-4 text-gray-400 transition-transform duration-200"
          :class="openDropdownId === 'countdownMinutes' ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>

    <div v-else :class="rowClass">
      <span class="min-w-[12rem] flex-1">
        <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.idleLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.idleHint') }}</span>
      </span>
      <button
        type="button"
        :ref="(el) => registerTrigger('idleMinutes', el)"
        class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
        @click="toggleDropdown('idleMinutes')"
      >
        <span>{{ idleLabel }}</span>
        <ChevronDown
          class="h-4 w-4 text-gray-400 transition-transform duration-200"
          :class="openDropdownId === 'idleMinutes' ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>

    <div :class="rowClass">
      <span class="min-w-[12rem] flex-1">
        <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('sleepTimer.actionLabel') }}</span>
        <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.actionHint') }}</span>
      </span>
      <button
        type="button"
        :ref="(el) => registerTrigger('sleepAction', el)"
        class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
        @click="toggleDropdown('sleepAction')"
      >
        <span>{{ actionLabel }}</span>
        <ChevronDown
          class="h-4 w-4 text-gray-400 transition-transform duration-200"
          :class="openDropdownId === 'sleepAction' ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>

    <div :class="rowClass">
      <span class="min-w-[12rem] flex-1">
        <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">
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

    <Teleport to="body">
      <Transition name="settings-dropdown">
        <div
          v-if="openDropdownId"
          ref="dropdownPanelRef"
          class="settings-inline-dropdown custom-scrollbar"
          :style="dropdownPanelStyle"
        >
          <template v-if="openDropdownId === 'sleepMode'">
            <button
              v-for="option in modeOptions"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': sleepTimer.mode === option.value }"
              @click="setMode(option.value)"
            >
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <Check
                v-if="sleepTimer.mode === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'countdownMinutes'">
            <button
              v-for="minutes in COUNTDOWN_PRESETS"
              :key="minutes"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': sleepTimer.countdownMinutes === minutes }"
              @click="setCountdownMinutes(minutes)"
            >
              <span class="min-w-0 flex-1 truncate">{{ minutes }} {{ t('sleepTimer.minutes') }}</span>
              <Check
                v-if="sleepTimer.countdownMinutes === minutes"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
            <div class="flex items-center gap-2 px-2.5 py-2">
              <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">{{ t('sleepTimer.customMinutes') }}</span>
              <input
                v-model.number="sleepTimer.countdownMinutes"
                type="number"
                min="1"
                max="600"
                class="w-20 rounded-lg border border-gray-200/40 bg-white/30 px-2 py-1 text-xs text-gray-700 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200"
                :aria-label="t('sleepTimer.customMinutes')"
              >
            </div>
          </template>

          <template v-else-if="openDropdownId === 'idleMinutes'">
            <button
              v-for="minutes in IDLE_PRESETS"
              :key="minutes"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': sleepTimer.idleMinutes === minutes }"
              @click="setIdleMinutes(minutes)"
            >
              <span class="min-w-0 flex-1 truncate">{{ minutes }} {{ t('sleepTimer.minutes') }}</span>
              <Check
                v-if="sleepTimer.idleMinutes === minutes"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'sleepAction'">
            <button
              v-for="option in actionOptions"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': sleepTimer.action === option.value }"
              @click="setAction(option.value)"
            >
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <Check
                v-if="sleepTimer.action === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
