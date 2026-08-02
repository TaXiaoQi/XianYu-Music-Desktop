<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  ChevronDown,
  Download,
  Gauge,
  Heart,
  ListMusic,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  Repeat,
  FileText,
  EyeOff,
  Check,
} from 'lucide-vue-next';

import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import {
  DEFAULT_FOOTER_LAYOUT,
  FOOTER_ITEMS,
  findItemContainer,
  moveFooterItemTo,
  normalizeFooterLayout,
} from '../../features/settings/footerItems';
import type { FooterMoveTarget } from '../../features/settings/footerItems';
import type { FooterItemKey } from '../../types';
import SettingHint from './SettingHint.vue';

const { footerLayout, patchFooterLayout } = useSettings();
const { showToast } = useToast();

/** 归一化后的当前布局（与 PlayerFooter 共享同一 store，修改即时生效） */
const layout = computed(() => normalizeFooterLayout(footerLayout.value));

// --- 图标映射 ---
const ICON_MAP: Record<FooterItemKey, typeof Heart> = {
  favorite: Heart,
  download: Download,
  playMode: Repeat,
  desktopLyrics: FileText,
  quality: Gauge,
  speed: Gauge,
  volume: Volume2,
  equalizer: SlidersHorizontal,
  playlist: ListMusic,
};
const getItemIcon = (key: FooterItemKey) => ICON_MAP[key] ?? EyeOff;

/** 查找控件当前所在的容器 */
const getItemContainer = (key: FooterItemKey): FooterMoveTarget =>
  findItemContainer(layout.value, key);

/** 容器/收纳的显示标签 */
const TARGET_LABELS: Record<FooterMoveTarget, string> = {
  left: '左侧容器',
  middleLeft: '中间左侧',
  middleRight: '中间右侧',
  right: '右侧容器',
  collapsed: '收纳菜单',
};

// --- 移动目标选项 ---
const MOVE_TARGETS: FooterMoveTarget[] = ['left', 'middleLeft', 'middleRight', 'right', 'collapsed'];

/** 判断目标容器是否已满（不可再放控件） */
const isTargetFull = (target: FooterMoveTarget): boolean => {
  if (target === 'collapsed') return false;
  const l = layout.value;
  if (target === 'left') return l.left.length >= 2;
  if (target === 'right') return l.right.length >= 5;
  if (target === 'middleLeft') return l.middleLeft !== null;
  if (target === 'middleRight') return l.middleRight !== null;
  return false;
};

// --- 悬浮窗状态 ---
const openPopupKey = ref<FooterItemKey | null>(null);
const popupRefs = ref<Record<string, HTMLElement | null>>({});
const popupTriggers = ref<Record<string, HTMLElement | null>>({});

/** 切换悬浮窗 */
const togglePopup = (key: FooterItemKey) => {
  openPopupKey.value = openPopupKey.value === key ? null : key;
};

/** 关闭悬浮窗 */
const closePopup = () => {
  openPopupKey.value = null;
};

/** 点击外部关闭悬浮窗 */
const handleDocumentClick = (e: MouseEvent) => {
  if (!openPopupKey.value) return;
  const key = openPopupKey.value;
  const popup = popupRefs.value[key];
  const trigger = popupTriggers.value[key];
  if (popup && popup.contains(e.target as Node)) return;
  if (trigger && trigger.contains(e.target as Node)) return;
  closePopup();
};

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});
onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
});

// --- 移动控件 ---
const moveItem = (key: FooterItemKey, target: FooterMoveTarget) => {
  const current = getItemContainer(key);
  if (current === target) {
    closePopup();
    return;
  }
  const next = moveFooterItemTo(layout.value, key, target);
  if (next === null) {
    const label = TARGET_LABELS[target];
    showToast(`${label}已满，请先移出其他控件`, 'info');
    return;
  }
  patchFooterLayout(next);
  closePopup();
};

// --- 恢复默认 ---
const restoreDefault = () => {
  patchFooterLayout({
    left: [...DEFAULT_FOOTER_LAYOUT.left],
    middleLeft: DEFAULT_FOOTER_LAYOUT.middleLeft,
    middleRight: DEFAULT_FOOTER_LAYOUT.middleRight,
    right: [...DEFAULT_FOOTER_LAYOUT.right],
  });
  showToast('已恢复默认底栏布局', 'success');
};
</script>

<template>
  <section class="space-y-3">
    <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
      <span class="flex items-center gap-2">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        底部栏布局
      </span>
      <SettingHint text="点击右侧标签展开悬浮窗，选择控件显示的位置（含收纳菜单）。修改即时生效。" />
    </h2>

    <!-- 控件列表 -->
    <div class="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/45 dark:border-white/10 dark:bg-black/20">
      <div
        v-for="(item, index) in FOOTER_ITEMS"
        :key="item.key"
        class="flex items-center justify-between gap-3 px-4 py-3 transition-colors"
        :class="[
          index !== FOOTER_ITEMS.length - 1 ? 'border-b border-gray-200/50 dark:border-white/5' : '',
          openPopupKey === item.key ? 'bg-[#EC4141]/5' : 'hover:bg-white/40 dark:hover:bg-white/5',
        ]"
      >
        <!-- 左侧：图标 + 名称 + 描述 -->
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            :class="getItemContainer(item.key) === 'collapsed'
              ? 'bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-white/40'
              : 'bg-[#EC4141]/10 text-[#EC4141]'"
          >
            <component :is="getItemIcon(item.key)" class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{{ item.label }}</div>
            <div class="truncate text-xs text-gray-500 dark:text-white/50">{{ item.description }}</div>
          </div>
        </div>

        <!-- 右侧：当前容器标签（点击展开悬浮窗） -->
        <div class="relative shrink-0">
          <button
            :ref="el => { if (el) popupTriggers[item.key] = el as HTMLElement; }"
            type="button"
            class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all"
            :class="openPopupKey === item.key
              ? 'border-[#EC4141] bg-[#EC4141]/8 text-[#EC4141]'
              : 'border-gray-200/70 bg-white/60 text-gray-600 hover:border-[#EC4141]/40 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300'"
            @click.stop="togglePopup(item.key)"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="getItemContainer(item.key) === 'collapsed' ? 'bg-gray-400' : 'bg-[#EC4141]'"
            />
            {{ TARGET_LABELS[getItemContainer(item.key)] }}
            <ChevronDown class="h-3 w-3 transition-transform" :class="openPopupKey === item.key ? 'rotate-180' : ''" />
          </button>

          <!-- 悬浮窗：选择容器位置 -->
          <transition name="popup">
            <div
              v-if="openPopupKey === item.key"
              :ref="el => { if (el) popupRefs[item.key] = el as HTMLElement; }"
              class="absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-xl border border-gray-200/70 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95"
              @click.stop
            >
              <div class="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">
                选择显示位置
              </div>
              <button
                v-for="target in MOVE_TARGETS"
                :key="target"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors"
                :class="getItemContainer(item.key) === target
                  ? 'bg-[#EC4141]/8 text-[#EC4141]'
                  : isTargetFull(target) && getItemContainer(item.key) !== target
                    ? 'text-gray-300 dark:text-white/25 cursor-not-allowed'
                    : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-white/70 dark:hover:bg-white/8 dark:hover:text-white'"
                :disabled="isTargetFull(target) && getItemContainer(item.key) !== target"
                @click="moveItem(item.key, target)"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full shrink-0"
                  :class="target === 'collapsed' ? 'bg-gray-400' : 'bg-[#EC4141]'"
                />
                <span class="flex-1 text-left whitespace-nowrap">{{ TARGET_LABELS[target] }}</span>
                <!-- 容量提示 -->
                <span v-if="target !== 'collapsed'" class="text-[10px] text-gray-400 dark:text-white/40 tabular-nums">
                  {{ target === 'left' ? layout.left.length : target === 'right' ? layout.right.length : (layout[target as 'middleLeft'] ? 1 : 0) }}/{{ target === 'left' ? 2 : target === 'right' ? 5 : 1 }}
                </span>
                <span v-else class="text-[10px] text-gray-400 dark:text-white/40">已收纳</span>
                <!-- 当前选中 -->
                <Check v-if="getItemContainer(item.key) === target" class="h-3.5 w-3.5 shrink-0" />
              </button>
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- 恢复默认 -->
    <div class="flex justify-end">
      <button
        type="button"
        class="flex items-center gap-1.5 text-xs px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-full text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition"
        @click="restoreDefault"
      >
        <RotateCcw class="h-3.5 w-3.5" />
        恢复默认布局
      </button>
    </div>
  </section>
</template>

<style scoped>
.popup-enter-active,
.popup-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
