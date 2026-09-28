<script setup lang="ts">
// 排序方式弹出面板：由父级决定选项、定位与高亮，本组件只负责展示与回传选择
import { computed } from 'vue';

interface SortOptionItem {
  value: string;
  label: string;
}

const props = defineProps<{
  shown: boolean;
  posX: number;
  posY: number;
  dockRight: boolean;
  options: readonly SortOptionItem[];
  currentMode: string;
  /** 允许展示升降向箭头的排序值 */
  arrowModes: readonly string[];
  /** 当前处于降序（箭头翻转）的排序值 */
  reversedModes: readonly string[];
}>();

const emit = defineEmits<{ (e: 'pick', value: string): void }>();

const panelStyle = computed(() =>
  props.dockRight
    ? { right: `${props.posX}px`, top: `${props.posY}px` }
    : { left: `${props.posX}px`, top: `${props.posY}px` },
);

const isActive = (value: string) => (props.currentMode || '').startsWith(value);
const showsArrow = (value: string) => props.arrowModes.includes(value);
const isReversed = (value: string) => props.reversedModes.includes(value);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="shown"
      class="fixed z-[9999] isolate py-1 min-w-[120px] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#262626] animate-in fade-in zoom-in-95 duration-100"
      :style="panelStyle"
    >
      <div
        v-for="option in options"
        :key="option.value"
        class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
        :class="isActive(option.value) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
        @click="emit('pick', option.value)"
      >
        <span>{{ option.label }}</span>
        <div v-if="isActive(option.value)" class="flex items-center gap-1.5">
          <svg
            v-if="showsArrow(option.value)"
            class="h-3 w-3 transition-transform duration-200"
            :class="{ 'rotate-180': isReversed(option.value) }"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z"
            />
          </svg>
          <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            />
          </svg>
        </div>
      </div>
    </div>
  </Teleport>
</template>
