<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 是否处于按键监听状态 */
    capturing: boolean;
    /** 绑定是否被其他软件占用（仅全局快捷键有意义） */
    occupied?: boolean;
    /** 悬停提示（当前绑定描述） */
    hint: string;
    /** 按钮文案 */
    label: string;
  }>(),
  {
    occupied: false,
  },
);

const emit = defineEmits<{
  (event: 'activate'): void;
  (event: 'commit', keyEvent: KeyboardEvent): void;
  (event: 'release'): void;
}>();

const BUTTON_BASE_CLASS =
  'w-full min-w-0 truncate whitespace-nowrap rounded-full border px-4 py-3 text-left text-sm transition-all backdrop-blur-md';

const CAPTURING_CLASS =
  'border-[#EC4141] bg-red-500/10 text-[#EC4141] dark:bg-red-500/20 shadow-[0_0_12px_rgba(236,65,65,0.2)]';

const OCCUPIED_CLASS =
  'border-[#f3b0b0] bg-[#f9ecec] text-[#b14c4c] shadow-sm hover:border-[#e78f8f] hover:bg-[#f7e4e4] dark:border-[#6a3030] dark:bg-[#3a1f1f]/80 dark:text-[#f2b1b1] dark:hover:border-[#874444] dark:hover:bg-[#472525]/80';

const IDLE_CLASS =
  'border-gray-200/40 bg-white/20 text-gray-800 shadow-sm hover:border-[#EC4141] hover:text-[#EC4141] hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200 dark:hover:bg-white/10 dark:hover:border-[#EC4141]';

// 优先级：录入中 > 被占用 > 常规
const buttonClass = computed(() => {
  if (props.capturing) {
    return [BUTTON_BASE_CLASS, CAPTURING_CLASS];
  }
  if (props.occupied) {
    return [BUTTON_BASE_CLASS, OCCUPIED_CLASS];
  }
  return [BUTTON_BASE_CLASS, IDLE_CLASS];
});
</script>

<template>
  <button
    type="button"
    data-shortcut-capture="true"
    :class="buttonClass"
    :title="hint"
    @click="emit('activate')"
    @blur="capturing && emit('release')"
    @keydown="emit('commit', $event)"
  >
    {{ label }}
  </button>
</template>
