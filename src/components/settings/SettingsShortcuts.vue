<script setup lang="ts"> // 实现
import { computed, ref } from 'vue'; // 实现

import { useGlobalShortcutStatus } from '../../composables/useKeyboardShortcuts'; // 实现
import { useToast } from '../../composables/toast'; // 实现
import { useSettings } from '../../features/settings/useSettings'; // 实现
import SettingHint from './SettingHint.vue';
import ShortcutCaptureButton from './shortcutsPanel/ShortcutCaptureButton.vue';
import {
  areShortcutBindingsEqual, createDefaultShortcutSettings, formatShortcutBinding, getShortcutBindingFromEvent,
  isSystemReservedShortcutEvent, shortcutActionLabels, shortcutActionOrder,
} from '../../features/settings/shortcuts'; // 实现
import type { ShortcutActionId } from '../../types'; // 实现

const settingsStore = useSettings();
const settings = settingsStore.settings;
const toastApi = useToast();
const showToast = toastApi.showToast;
const globalStatus = useGlobalShortcutStatus();
const occupiedActionIdSet = globalStatus.occupiedActionIdSet;

type BindingScope = 'local' | 'global';

type CaptureFocus = { actionId: ShortcutActionId; scope: BindingScope };

/** 当前正在等待按键录入的格子 */
const captureFocus = ref<CaptureFocus | null>(null);

const capturesNow = (scope: BindingScope, actionId: ShortcutActionId) =>
  captureFocus.value?.scope === scope && captureFocus.value.actionId === actionId;

const beginCapture = (scope: BindingScope, actionId: ShortcutActionId) => {
  captureFocus.value = { scope, actionId };
};

const endCapture = () => {
  captureFocus.value = null;
};

const writeBinding = (scope: BindingScope, actionId: ShortcutActionId, nextBinding: ReturnType<typeof getShortcutBindingFromEvent>) => {
  const slotTable = settings.value.shortcuts[scope];
  slotTable[actionId] = nextBinding;
};

const restoreDefaults = () => { // 实现
  settings.value.shortcuts = createDefaultShortcutSettings(); endCapture();
};

/** 录入处理：Esc 取消、退格清空、系统保留键拒绝、冲突拒绝 */
const commitCapture = (scope: BindingScope, actionId: ShortcutActionId, event: KeyboardEvent) => {
  if (!capturesNow(scope, actionId)) { return; }

  event.preventDefault(); event.stopPropagation();

  if (event.key === 'Escape') { endCapture(); return; }

  if (event.key === 'Backspace' || event.key === 'Delete') { writeBinding(scope, actionId, null); endCapture(); return; }

  if (isSystemReservedShortcutEvent(event)) { showToast('Win 组合键由系统保留，不能作为快捷键', 'error'); return; }

  const parsedBinding = getShortcutBindingFromEvent(event);
  if (!parsedBinding) { return; }

  const clashingActionId = shortcutActionOrder.find(
    (candidate) => candidate !== actionId
      && areShortcutBindingsEqual(settings.value.shortcuts[scope][candidate], parsedBinding),
  );

  if (clashingActionId) { showToast(`${shortcutActionLabels[clashingActionId]} 已使用 ${formatShortcutBinding(parsedBinding)}`, 'error'); return; }

  writeBinding(scope, actionId, parsedBinding);
  endCapture();
};

interface BindingRow {
  id: ShortcutActionId;
  title: string;
  localKey: ReturnType<typeof formatShortcutBinding>;
  globalKey: ReturnType<typeof formatShortcutBinding>;
}

const bindingRows = computed<BindingRow[]>(() =>
  shortcutActionOrder.map((actionId) => ({
    id: actionId,
    title: shortcutActionLabels[actionId],
    localKey: formatShortcutBinding(settings.value.shortcuts.local[actionId]),
    globalKey: formatShortcutBinding(settings.value.shortcuts.global[actionId]),
  })),
);

const hasClashingGlobals = computed(() => occupiedActionIdSet.value.size > 0);
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300"> 
    <!-- 快捷键绑定表 -->
    <div class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>快捷按键
      </h2>

      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="flex items-center justify-between gap-4 p-4">
          <div class="text-sm font-medium dark:text-gray-200 text-gray-800">窗口内快捷键</div>
          <SettingHint
            text="软件打开且窗口处于焦点时生效。默认支持按下 Space 播放/暂停。点击快捷键按钮后直接按键录入，按 Esc 取消，按 Backspace 或 Delete 清空当前绑定。"
          /></div>

        <div class="px-4 py-4 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-white/45">
          <div class="truncate">功能说明</div>
          <div class="truncate">快捷按键</div>
          <div class="truncate">全局快捷键</div></div>

        <div v-for="row in bindingRows" :key="row.id" class="px-4 py-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-center">
          <div class="min-w-0"><div class="truncate text-sm font-medium dark:text-gray-200 text-gray-800" :title="row.title">{{ row.title }}</div></div>

          <ShortcutCaptureButton
            :capturing="capturesNow('local', row.id)"
            :hint="formatShortcutBinding(settings.shortcuts.local[row.id])"
            :label="capturesNow('local', row.id) ? '按下新的快捷键' : row.localKey"
            @activate="beginCapture('local', row.id)"
            @release="endCapture"
            @commit="commitCapture('local', row.id, $event)"
          />

          <ShortcutCaptureButton
            :capturing="capturesNow('global', row.id)"
            :occupied="occupiedActionIdSet.has(row.id)"
            :hint="formatShortcutBinding(settings.shortcuts.global[row.id])"
            :label="capturesNow('global', row.id) ? '按下新的快捷键' : row.globalKey"
            @activate="beginCapture('global', row.id)"
            @release="endCapture"
            @commit="commitCapture('global', row.id, $event)"
          /></div>

        <div
          v-if="settings.shortcuts.globalEnabled && hasClashingGlobals"
          class="px-4 py-4 bg-[#fff5f5] text-[#c65a5a] text-xs dark:bg-[#3b2020]/70 dark:text-[#f0abab]"
        >
          {{ '淡红色背景代表热键被其他软件占用，暂时无法启用。' }}</div>
      </div>
    </div>

    <!-- 开关区 -->
    <div class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>选项
      </h2>

      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0 pr-3">
            <div class="text-sm font-medium dark:text-gray-200 text-gray-800">启用窗口内快捷键</div></div>
          <div class="flex items-center gap-3">
            <SettingHint text="关闭后将不再响应当前窗口内的所有快捷键" />
            <button type="button" class="glass-switch" :class="{ 'is-checked': settings.shortcuts.enabled }" @click="settings.shortcuts.enabled = !settings.shortcuts.enabled"></button></div></div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0 pr-3">
            <div class="text-sm font-medium dark:text-gray-200 text-gray-800">启用全局快捷键</div></div>
          <div class="flex items-center gap-3">
            <SettingHint text="开启后在后台也可响应上方设置的全局快捷键，默认关闭" />
            <button type="button" class="glass-switch" :class="{ 'is-checked': settings.shortcuts.globalEnabled }" @click="settings.shortcuts.globalEnabled = !settings.shortcuts.globalEnabled"></button></div></div>

        <div class="p-4 flex items-center justify-between opacity-70 cursor-not-allowed hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0 pr-3">
            <div class="text-sm font-medium dark:text-gray-200 text-gray-800">使用系统媒体快捷键</div></div>
          <div class="flex items-center gap-3">
            <SettingHint text="播放/暂停、上一首、下一首等系统级媒体键入口已预留" />
            <div class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-gray-300 dark:bg-gray-700">
              <span class="inline-block h-4 w-4 rounded-full bg-white shadow-sm translate-x-1 transform" /></div></div></div>
      </div>

      <div class="justify-end flex">
        <button type="button" class="text-xs px-4 py-2 rounded-full border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition" @click="restoreDefaults">恢复默认</button>
      </div></div>
  </div>
</template>
