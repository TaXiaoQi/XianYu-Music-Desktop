<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  ArrowDown,
  ArrowUp,
  Download,
  Gauge,
  GripVertical,
  Heart,
  ListMusic,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  Repeat,
  FileText,
  Eye,
  EyeOff,
} from 'lucide-vue-next';

import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import {
  DEFAULT_FOOTER_LAYOUT,
  FOOTER_CONTAINER_LIMITS,
  computeCollapsedItems,
  getFooterItemMeta,
  normalizeFooterLayout,
} from '../../features/settings/footerItems';
import type {
  FooterContainerKey,
  FooterItemKey,
  FooterLayoutSettings,
} from '../../types';
import SettingHint from './SettingHint.vue';

const { footerLayout, patchFooterLayout } = useSettings();
const { showToast } = useToast();

/** 归一化后的当前布局（与 PlayerFooter 使用同一份 store，修改即时生效） */
const layout = computed<FooterLayoutSettings>(() =>
  normalizeFooterLayout(footerLayout.value),
);

const collapsedItems = computed<FooterItemKey[]>(() =>
  computeCollapsedItems(layout.value),
);

// --- 容器元数据（用于渲染分组卡片） ---
interface ContainerMeta {
  key: FooterContainerKey;
  label: string;
  hint: string;
  capacity: number;
}

const CONTAINERS: ContainerMeta[] = [
  { key: 'left', label: '左侧容器', hint: '紧邻封面与歌曲信息', capacity: FOOTER_CONTAINER_LIMITS.left },
  { key: 'middleLeft', label: '中间左侧', hint: '紧邻「上一首」按钮', capacity: FOOTER_CONTAINER_LIMITS.middleLeft },
  { key: 'middleRight', label: '中间右侧', hint: '紧邻「下一首」按钮', capacity: FOOTER_CONTAINER_LIMITS.middleRight },
  { key: 'right', label: '右侧容器', hint: '紧邻窗口右边缘', capacity: FOOTER_CONTAINER_LIMITS.right },
];

/** 获取容器内当前显示的控件列表（middleLeft/middleRight 转为单元素或空数组） */
const getContainerItems = (container: FooterContainerKey): FooterItemKey[] => {
  const l = layout.value;
  if (container === 'left') return l.left;
  if (container === 'right') return l.right;
  if (container === 'middleLeft') return l.middleLeft ? [l.middleLeft] : [];
  return l.middleRight ? [l.middleRight] : [];
};

/** 容器当前占用数 */
const getContainerCount = (container: FooterContainerKey): number =>
  getContainerItems(container).length;

// --- 图标渲染 ---
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

const getItemIcon = (key: FooterItemKey) => ICON_MAP[key] ?? Eye;

// --- 排序操作（仅 left / right 列表型容器） ---
/**
 * 写回新布局：保留单值容器原值，仅替换被修改的列表。
 * patchFooterLayout 内部会再次归一化，保证合法性。
 */
const applyLayout = (next: FooterLayoutSettings) => {
  patchFooterLayout(next);
};

const moveInList = (
  container: 'left' | 'right',
  from: number,
  to: number,
) => {
  const list = [...getContainerItems(container)];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  applyLayout({
    ...layout.value,
    [container]: list,
  } as FooterLayoutSettings);
};

const moveUp = (container: 'left' | 'right', index: number) =>
  moveInList(container, index, index - 1);
const moveDown = (container: 'left' | 'right', index: number) =>
  moveInList(container, index, index + 1);

// --- 显示 / 隐藏（收入折叠） ---
/** 将控件从其容器移除（进入折叠收纳菜单） */
const hideItem = (key: FooterItemKey) => {
  const l = layout.value;
  const next: FooterLayoutSettings = {
    left: l.left.filter(k => k !== key),
    middleLeft: l.middleLeft === key ? null : l.middleLeft,
    middleRight: l.middleRight === key ? null : l.middleRight,
    right: l.right.filter(k => k !== key),
  };
  applyLayout(next);
};

/** 将控件从折叠区放回其允许的容器（若容器已满则提示） */
const showItem = (key: FooterItemKey) => {
  const meta = getFooterItemMeta(key);
  if (!meta) return;
  const l = layout.value;

  // 该控件允许的容器（按元数据顺序取第一个）
  const target = meta.allowedContainers[0];
  if (!target) return;

  if (target === 'middleLeft') {
    if (l.middleLeft !== null) {
      showToast('中间左侧位置已被占用，请先隐藏当前控件', 'info');
      return;
    }
    applyLayout({ ...l, middleLeft: key });
    return;
  }
  if (target === 'middleRight') {
    if (l.middleRight !== null) {
      showToast('中间右侧位置已被占用，请先隐藏当前控件', 'info');
      return;
    }
    applyLayout({ ...l, middleRight: key });
    return;
  }

  const list = target === 'left' ? [...l.left] : [...l.right];
  if (list.length >= FOOTER_CONTAINER_LIMITS[target]) {
    showToast(`${target === 'left' ? '左侧' : '右侧'}容器已满，请先隐藏其他控件`, 'info');
    return;
  }
  list.push(key);
  applyLayout({ ...l, [target]: list } as FooterLayoutSettings);
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

// --- 拖拽排序（pointer 事件，参考 SettingsSidebar 实现） ---
// Tauri WebView2 dragDropEnabled 接管原生 DnD，需用 pointer 自行实现。
const dragging = ref<{ container: 'left' | 'right'; index: number } | null>(null);
const listRefs = ref<Record<string, HTMLElement | null>>({});

const resolveTargetIndex = (
  container: 'left' | 'right',
  clientY: number,
  currentIndex: number,
): number | null => {
  const listEl = listRefs.value[container];
  if (!listEl) return null;
  const rows = Array.from(
    listEl.querySelectorAll<HTMLElement>('[data-footer-row]'),
  );
  if (rows.length === 0) return null;

  let target = currentIndex;
  for (let i = currentIndex - 1; i >= 0; i--) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) target = i;
    else break;
  }
  if (target !== currentIndex) return target;
  for (let i = currentIndex + 1; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) target = i;
    else break;
  }
  return target;
};

const updateDraggedPosition = (clientY: number) => {
  const drag = dragging.value;
  if (!drag) return;
  const target = resolveTargetIndex(drag.container, clientY, drag.index);
  if (target === null || target === drag.index) return;
  moveInList(drag.container, drag.index, target);
  dragging.value = { container: drag.container, index: target };
};

const handlePointerMove = (event: PointerEvent) => {
  if (!dragging.value) return;
  event.preventDefault();
  updateDraggedPosition(event.clientY);
};

const stopDragging = () => {
  dragging.value = null;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopDragging);
  window.removeEventListener('pointercancel', stopDragging);
};

const startDragging = (
  container: 'left' | 'right',
  index: number,
  event: PointerEvent,
) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = { container, index };
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
};

onUnmounted(stopDragging);
</script>

<template>
  <section class="space-y-3">
    <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
      <span class="flex items-center gap-2">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        底部栏布局
      </span>
      <SettingHint text="拖动手柄或上下箭头调整顺序，点击眼睛图标隐藏/显示控件。修改即时生效，底部栏会实时更新。" />
    </h2>

    <!-- 容器卡片 -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div
        v-for="container in CONTAINERS"
        :key="container.key"
        class="rounded-2xl border border-gray-200/70 bg-white/45 p-4 dark:border-white/10 dark:bg-black/20"
      >
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ container.label }}</div>
            <div class="text-xs text-gray-500 dark:text-white/50">{{ container.hint }}</div>
          </div>
          <div
            class="rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums"
            :class="getContainerCount(container.key) >= container.capacity && container.capacity > 0
              ? 'bg-[#EC4141]/10 text-[#EC4141]'
              : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/60'"
          >
            {{ getContainerCount(container.key) }} / {{ container.capacity }}
          </div>
        </div>

        <!-- 列表型容器（left / right） -->
        <div
          v-if="container.key === 'left' || container.key === 'right'"
          :ref="el => { if (el) listRefs[container.key] = el as HTMLElement; }"
          class="flex flex-col gap-1.5"
        >
          <TransitionGroup name="footer-sort" tag="div" class="flex flex-col gap-1.5">
            <div
              v-for="(key, index) in getContainerItems(container.key)"
              :key="key"
              data-footer-row
              class="group flex items-center gap-2 rounded-xl border border-gray-200/60 bg-white/60 px-2.5 py-2 transition-colors dark:border-white/8 dark:bg-white/5"
              :class="dragging && dragging.container === container.key && dragging.index === index
                ? 'ring-1 ring-inset ring-[#EC4141]/40 bg-[#EC4141]/8'
                : ''"
            >
              <GripVertical
                class="h-4 w-4 shrink-0 touch-none select-none text-gray-400 transition-colors hover:text-[#EC4141] dark:text-white/35 cursor-grab"
                :class="dragging && dragging.container === container.key && dragging.index === index ? 'cursor-grabbing text-[#EC4141]' : ''"
                @pointerdown="startDragging(container.key as 'left' | 'right', index, $event)"
              />
              <component
                :is="getItemIcon(key)"
                class="h-4 w-4 shrink-0 text-[#EC4141]"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                  {{ getFooterItemMeta(key)?.label ?? key }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="settings-footer-move"
                  title="上移"
                  :disabled="index === 0"
                  @click.stop="moveUp(container.key as 'left' | 'right', index)"
                >
                  <ArrowUp class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="settings-footer-move"
                  title="下移"
                  :disabled="index === getContainerItems(container.key).length - 1"
                  @click.stop="moveDown(container.key as 'left' | 'right', index)"
                >
                  <ArrowDown class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="settings-footer-move"
                  title="隐藏到折叠菜单"
                  @click.stop="hideItem(key)"
                >
                  <EyeOff class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </TransitionGroup>

          <div
            v-if="getContainerItems(container.key).length === 0"
            class="rounded-xl border border-dashed border-gray-200/70 px-2.5 py-3 text-center text-xs text-gray-400 dark:border-white/10 dark:text-white/40"
          >
            空（控件已收入折叠菜单）
          </div>
        </div>

        <!-- 单值容器（middleLeft / middleRight） -->
        <div v-else class="flex flex-col gap-1.5">
          <template v-for="key in getContainerItems(container.key)" :key="key">
            <div
              class="group flex items-center gap-2 rounded-xl border border-gray-200/60 bg-white/60 px-2.5 py-2 dark:border-white/8 dark:bg-white/5"
            >
              <component
                :is="getItemIcon(key)"
                class="h-4 w-4 shrink-0 text-[#EC4141]"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                  {{ getFooterItemMeta(key)?.label ?? key }}
                </div>
              </div>
              <button
                type="button"
                class="settings-footer-move"
                title="隐藏到折叠菜单"
                @click.stop="hideItem(key)"
              >
                <EyeOff class="h-3.5 w-3.5" />
              </button>
            </div>
          </template>

          <div
            v-if="getContainerItems(container.key).length === 0"
            class="rounded-xl border border-dashed border-gray-200/70 px-2.5 py-3 text-center text-xs text-gray-400 dark:border-white/10 dark:text-white/40"
          >
            空（控件已收入折叠菜单）
          </div>
        </div>
      </div>
    </div>

    <!-- 折叠收纳菜单 -->
    <div
      v-if="collapsedItems.length > 0"
      class="rounded-2xl border border-gray-200/70 bg-white/45 p-4 dark:border-white/10 dark:bg-black/20"
    >
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">折叠收纳菜单</div>
          <div class="text-xs text-gray-500 dark:text-white/50">未在容器中显示的控件，将收入底栏右侧的折叠菜单</div>
        </div>
        <div class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-gray-500 dark:bg-white/10 dark:text-white/60">
          {{ collapsedItems.length }}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="key in collapsedItems"
          :key="key"
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-gray-200/70 bg-white/60 px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:border-[#EC4141]/40 hover:bg-[#EC4141]/8 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
          @click="showItem(key)"
        >
          <component :is="getItemIcon(key)" class="h-3.5 w-3.5" />
          {{ getFooterItemMeta(key)?.label ?? key }}
          <Eye class="h-3 w-3 opacity-60" />
        </button>
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
.footer-sort-move {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .footer-sort-move {
    transition: none;
  }
}

.settings-footer-move {
  display: inline-flex;
  height: 26px;
  width: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: rgba(71, 85, 105, 0.85);
  transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
}

.settings-footer-move:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}

.settings-footer-move:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

:global(.dark) .settings-footer-move {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.6);
}

:global(.dark) .settings-footer-move:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.16);
  color: #ff8b8b;
}
</style>
