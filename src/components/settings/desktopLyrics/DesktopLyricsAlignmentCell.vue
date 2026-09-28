<script setup lang="ts">
import type { DesktopLyricsPlayerAlignment } from '../../../composables/lyrics';

defineProps<{
  /** 当前对齐取值 */
  value: DesktopLyricsPlayerAlignment;
}>();

const emit = defineEmits<{ select: [value: DesktopLyricsPlayerAlignment] }>();

/** 对齐方式候选（显示时去掉「靠/居」前缀）。 */
const CHOICES: Array<{ value: DesktopLyricsPlayerAlignment; label: string }> = [
  { value: 'left', label: '靠左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '靠右' },
  { value: 'split-corners', label: '阶梯式' },
];

function shortLabel(label: string) {
  return label.replace('靠', '').replace('居', '');
}
</script>

<template>
  <div class="al-cell">
    <div class="al-cell-label shrink-0">对齐</div>
    <div class="al-seg flex overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <button
        v-for="choice in CHOICES"
        :key="choice.value"
        type="button"
        class="al-seg-btn text-center text-xs font-semibold py-1.5 px-3 transition-all"
        :class="value === choice.value ? 'al-seg-btn--active' : ''"
        @click="emit('select', choice.value)"
      >
        {{ shortLabel(choice.label) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.al-cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  min-height: 48px;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  transition: all 180ms ease;
}
:global(.dark) .al-cell {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
.al-cell:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(236, 65, 65, 0.35);
}
:global(.dark) .al-cell:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(236, 65, 65, 0.35);
}
.al-cell-label {
  font-size: 13px;
  font-weight: 700;
  color: rgb(55 65 81);
  user-select: none;
  white-space: nowrap;
}
:global(.dark) .al-cell-label {
  color: rgba(255, 255, 255, 0.68);
}

.al-seg {
  padding: 2px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(15, 23, 42, 0.04);
  border-radius: 9px;
  gap: 2px;
  height: 28px;
  box-sizing: border-box;
}
:global(.dark) .al-seg {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
.al-seg-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgb(71 85 105);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 0 8px;
  height: 22px;
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}
:global(.dark) .al-seg-btn {
  color: rgba(255, 255, 255, 0.68);
}
.al-seg-btn:hover {
  color: #ec4141;
  background: rgba(255, 255, 255, 0.5);
}
:global(.dark) .al-seg-btn:hover {
  color: #ff8b8b;
  background: rgba(255, 255, 255, 0.05);
}
.al-seg-btn--active {
  background: #fff !important;
  color: #ec4141 !important;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 4px 10px rgba(15, 23, 42, 0.03);
}
:global(.dark) .al-seg-btn--active {
  background: rgba(255, 255, 255, 0.12) !important;
  color: #ff8b8b !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
</style>
