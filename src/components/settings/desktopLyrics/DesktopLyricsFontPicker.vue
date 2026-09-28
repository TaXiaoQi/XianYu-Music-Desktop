<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

import {
  getLyricsFontFamily,
  normalizeLyricsFontPreset,
  type LyricsFontOption,
  type LyricsFontPreset,
} from '../../../composables/lyrics';

const props = withDefaults(
  defineProps<{
    options: LyricsFontOption[];
    modelValue: LyricsFontPreset;
    /** 菜单顶部的标题文字 */
    heading?: string;
  }>(),
  { heading: '字体方案' },
);

const emit = defineEmits<{ 'update:modelValue': [value: LyricsFontPreset] }>();

const fieldRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const expanded = ref(false);
const menuStyle = ref<Record<string, string>>({});

const matched = computed(() => props.options.find((choice) => choice.value === props.modelValue));
const currentLabel = computed(
  () => matched.value?.label ?? normalizeLyricsFontPreset(props.modelValue),
);
const currentFamily = computed(
  () => matched.value?.fontFamily ?? getLyricsFontFamily(props.modelValue),
);

/** 依据触发器的视口位置计算菜单的固定定位（优先向下，放不下则向上翻）。 */
function placeMenu() {
  const anchor = triggerRef.value;
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  const margin = 16;
  const gap = 10;
  const wanted = Math.max(rect.width, 320);
  const width = Math.min(wanted, window.innerWidth - margin * 2);

  let left = rect.right - width;
  left = Math.min(left, window.innerWidth - margin - width);
  left = Math.max(margin, left);

  const roomBelow = window.innerHeight - rect.bottom - margin;
  const roomAbove = rect.top - margin;
  const openUp = roomBelow < 220 && roomAbove > roomBelow;
  const cap = Math.max(180, Math.min(360, (openUp ? roomAbove : roomBelow) - gap));

  menuStyle.value = openUp
    ? {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
        width: `${Math.round(width)}px`,
        maxHeight: `${Math.round(cap)}px`,
      }
    : {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(rect.bottom + gap)}px`,
        width: `${Math.round(width)}px`,
        maxHeight: `${Math.round(cap)}px`,
      };
}

async function flip() {
  expanded.value = !expanded.value;
  if (!expanded.value) return;

  await nextTick();
  placeMenu();
  const marked = menuRef.value?.querySelector('.dlx-fp-item--current') as HTMLElement | null;
  marked?.scrollIntoView({ block: 'nearest' });
}

function choose(value: LyricsFontPreset) {
  emit('update:modelValue', value);
  expanded.value = false;
}

function onDocPointerDown(event: MouseEvent) {
  if (!expanded.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (fieldRef.value?.contains(target)) return;
  if (menuRef.value?.contains(target)) return;
  expanded.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && expanded.value) {
    expanded.value = false;
  }
}

function onViewportShift() {
  if (expanded.value) placeMenu();
}

onMounted(() => {
  window.addEventListener('mousedown', onDocPointerDown);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onViewportShift);
  document.addEventListener('scroll', onViewportShift, true);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', onDocPointerDown);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onViewportShift);
  document.removeEventListener('scroll', onViewportShift, true);
});
</script>

<template>
  <div ref="fieldRef" class="dlx-fp flex-1 min-w-0">
    <button
      ref="triggerRef"
      type="button"
      class="dlx-fp-trigger flex w-full items-center justify-between"
      :class="expanded ? 'dlx-fp-trigger--open' : ''"
      @click="flip"
    >
      <span
        class="truncate text-[14px] font-semibold text-gray-800 dark:text-gray-100 flex-1 text-right mr-1.5"
        :style="{ fontFamily: currentFamily }"
      >
        {{ currentLabel }}
      </span>
      <ChevronDown :size="14" class="text-gray-400 shrink-0" />
    </button>

    <Teleport to="body">
      <transition name="dlx-fp-pop">
        <div
          v-if="expanded"
          ref="menuRef"
          class="dlx-fp-menu"
          :style="menuStyle"
          @click.stop
          @mousedown.stop
        >
          <div class="dlx-fp-menu-head">
            <span>{{ heading }}</span>
            <span>{{ options.length }} 项</span>
          </div>
          <div class="dlx-fp-menu-list custom-scrollbar">
            <button
              v-for="item in options"
              :key="item.value"
              type="button"
              class="dlx-fp-item"
              :class="modelValue === item.value ? 'dlx-fp-item--current' : ''"
              @click="choose(item.value)"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold" :style="{ fontFamily: item.fontFamily }">
                  {{ item.label }}
                </div>
              </div>
              <Check
                v-if="modelValue === item.value"
                :size="16"
                class="shrink-0 text-[#EC4141]"
              />
            </button>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dlx-fp {
  position: relative;
}

.dlx-fp-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 7px 10px;
  border: 1px solid var(--dlx-fp-trigger-border);
  border-radius: 10px;
  background: var(--dlx-fp-trigger-bg);
  box-shadow: var(--dlx-fp-trigger-shadow);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

.dlx-fp-trigger:hover,
.dlx-fp-trigger--open {
  border-color: var(--dlx-fp-trigger-hot-border);
  box-shadow: var(--dlx-fp-trigger-hot-shadow);
}

.dlx-fp-trigger--open {
  background: var(--dlx-fp-trigger-hot-bg);
}

.dlx-fp-menu {
  overflow: hidden;
  border: 1px solid var(--dlx-fp-menu-border);
  border-radius: 20px;
  background: var(--dlx-fp-menu-bg);
  box-shadow: var(--dlx-fp-menu-shadow);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  z-index: 120;
}

.dlx-fp-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--dlx-fp-menu-head-border);
  color: var(--dlx-fp-menu-head-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.dlx-fp-menu-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

.dlx-fp-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  text-align: left;
  color: var(--dlx-fp-item-color);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.dlx-fp-item:hover {
  border-color: var(--dlx-fp-item-hover-border);
  background: var(--dlx-fp-item-hover-bg);
  color: var(--dlx-fp-item-hover-color);
}

.dlx-fp-item--current {
  border-color: var(--dlx-fp-item-hot-border);
  background: var(--dlx-fp-item-hot-bg);
  color: var(--dlx-fp-item-hot-color);
}

.dlx-fp-pop-enter-active,
.dlx-fp-pop-leave-active {
  transition: opacity 180ms ease, transform 200ms ease;
  transform-origin: top center;
}

.dlx-fp-pop-enter-from,
.dlx-fp-pop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>

<style>
:root {
  --dlx-fp-trigger-bg: rgba(255, 255, 255, 0.2);
  --dlx-fp-trigger-border: rgba(229, 231, 235, 0.4);
  --dlx-fp-trigger-shadow: none;
  --dlx-fp-trigger-hot-bg: rgba(255, 255, 255, 0.3);
  --dlx-fp-trigger-hot-border: rgba(236, 65, 65, 0.35);
  --dlx-fp-trigger-hot-shadow: none;
  --dlx-fp-menu-bg: rgba(255, 255, 255, 0.88);
  --dlx-fp-menu-border: rgba(255, 255, 255, 0.5);
  --dlx-fp-menu-shadow: 0 24px 60px rgba(15, 23, 42, 0.16), 0 10px 24px rgba(15, 23, 42, 0.08);
  --dlx-fp-menu-head-color: rgba(71, 85, 105, 0.92);
  --dlx-fp-menu-head-border: rgba(148, 163, 184, 0.12);
  --dlx-fp-item-color: rgb(55 65 81);
  --dlx-fp-item-hover-bg: rgba(236, 65, 65, 0.06);
  --dlx-fp-item-hover-border: rgba(236, 65, 65, 0.16);
  --dlx-fp-item-hover-color: rgb(17 24 39);
  --dlx-fp-item-hot-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.12), rgba(236, 65, 65, 0.06));
  --dlx-fp-item-hot-border: rgba(236, 65, 65, 0.2);
  --dlx-fp-item-hot-color: #ec4141;
}

html.dark {
  --dlx-fp-trigger-bg: rgba(0, 0, 0, 0.1);
  --dlx-fp-trigger-border: rgba(31, 41, 55, 0.4);
  --dlx-fp-trigger-shadow: none;
  --dlx-fp-trigger-hot-bg: rgba(255, 255, 255, 0.1);
  --dlx-fp-trigger-hot-border: rgba(236, 65, 65, 0.35);
  --dlx-fp-trigger-hot-shadow: none;
  --dlx-fp-menu-bg: rgba(43, 43, 43, 0.88);
  --dlx-fp-menu-border: rgba(255, 255, 255, 0.08);
  --dlx-fp-menu-shadow: 0 24px 60px rgba(0, 0, 0, 0.34), 0 10px 24px rgba(0, 0, 0, 0.24);
  --dlx-fp-menu-head-color: rgba(255, 255, 255, 0.58);
  --dlx-fp-menu-head-border: rgba(255, 255, 255, 0.06);
  --dlx-fp-item-color: rgba(255, 255, 255, 0.84);
  --dlx-fp-item-hover-bg: rgba(236, 65, 65, 0.1);
  --dlx-fp-item-hover-border: rgba(236, 65, 65, 0.22);
  --dlx-fp-item-hover-color: rgba(255, 255, 255, 0.98);
  --dlx-fp-item-hot-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.08));
  --dlx-fp-item-hot-border: rgba(236, 65, 65, 0.28);
  --dlx-fp-item-hot-color: #ff9a9a;
}
</style>
