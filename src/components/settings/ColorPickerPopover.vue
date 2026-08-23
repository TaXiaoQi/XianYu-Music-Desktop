<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Pipette, X, Check } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: string;
  isOpen: boolean;
  triggerRef?: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
  (e: 'close'): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const nativeColorInputRef = ref<HTMLInputElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

// 经典/流行的扩展调色盘预设
const QUICK_COLOR_PALETTES = [
  '#EC4141', '#F9735B', '#F59E0B', '#10B981', 
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', 
  '#EC4899', '#F43F5E', '#14B8A6', '#64748B',
];

// HEX 手动输入值
const hexInput = ref(props.modelValue);
watch(() => props.modelValue, (val) => {
  hexInput.value = val.toUpperCase();
});

const selectColor = (color: string) => {
  const formatted = color.startsWith('#') ? color : `#${color}`;
  emit('update:modelValue', formatted);
};

const handleHexInput = (e: Event) => {
  const val = (e.target as HTMLInputElement).value;
  if (/^#?([0-9A-F]{6}|[0-9A-F]{3})$/i.test(val)) {
    const formatted = val.startsWith('#') ? val : `#${val}`;
    emit('update:modelValue', formatted);
  }
};

const triggerNativePicker = () => {
  nativeColorInputRef.value?.click();
};

const updatePosition = () => {
  if (!props.triggerRef) return;
  const rect = props.triggerRef.getBoundingClientRect();
  const menuWidth = 260;
  const menuHeight = 240; // 预估高度
  const gap = 8;

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 12) {
    left = window.innerWidth - menuWidth - 12;
  }
  if (left < 12) left = 12;

  const spaceBelow = window.innerHeight - rect.bottom;
  const shouldOpenUpward = spaceBelow < menuHeight && rect.top > menuHeight;

  menuStyle.value = shouldOpenUpward
    ? {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
        width: `${menuWidth}px`,
      }
    : {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(rect.bottom + gap)}px`,
        width: `${menuWidth}px`,
      };
};

watch(() => props.isOpen, (open) => {
  if (open) {
    nextTick(updatePosition);
  }
});

function handlePointerDownOutside(event: MouseEvent) {
  if (!props.isOpen) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (props.triggerRef?.contains(target)) return;
  if (menuRef.value?.contains(target)) return;
  emit('close');
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.isOpen) {
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('mousedown', handlePointerDownOutside);
  window.addEventListener('keydown', handleEscape);
  window.addEventListener('resize', updatePosition);
  document.addEventListener('scroll', updatePosition, true);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handlePointerDownOutside);
  window.removeEventListener('keydown', handleEscape);
  window.removeEventListener('resize', updatePosition);
  document.removeEventListener('scroll', updatePosition, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="color-picker-pop">
      <div
        v-if="isOpen"
        ref="menuRef"
        class="color-picker-popover-panel select-none backdrop-blur-2xl shadow-2xl rounded-2xl border p-3 z-[130] transition-all duration-200"
        :style="menuStyle"
        @click.stop
        @mousedown.stop
      >
        <!-- 头部标题与控制栏 -->
        <div class="flex items-center justify-between pb-2.5 mb-2 border-b border-black/5 dark:border-white/10">
          <div class="flex items-center gap-2">
            <span
              class="h-4 w-4 rounded-full border border-black/10 dark:border-white/20 shadow-sm transition-transform duration-200"
              :style="{ backgroundColor: modelValue }"
            ></span>
            <span class="text-xs font-semibold text-gray-800 dark:text-gray-200">自定义调色盘</span>
          </div>
          <div class="flex items-center gap-1">
            <!-- 调用系统吸管原生调色盘工具 -->
            <button
              type="button"
              class="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title="使用系统吸管取色器"
              @click="triggerNativePicker"
            >
              <Pipette class="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              class="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title="关闭"
              @click="emit('close')"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- 调色盘预设色块网格 -->
        <div class="mb-3">
          <div class="text-[11px] font-medium text-gray-500 dark:text-white/40 mb-1.5 px-0.5">调色板</div>
          <div class="grid grid-cols-6 gap-1.5">
            <button
              v-for="color in QUICK_COLOR_PALETTES"
              :key="color"
              type="button"
              class="group relative h-7 w-full rounded-xl border border-black/5 dark:border-white/10 shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
              :style="{ backgroundColor: color }"
              :title="color"
              @click="selectColor(color)"
            >
              <Check
                v-if="modelValue.toUpperCase() === color.toUpperCase()"
                class="h-3.5 w-3.5 text-white drop-shadow-md"
              />
            </button>
          </div>
        </div>

        <!-- 调色滑块与原生 Input 联动区 -->
        <div class="space-y-2 pt-1 border-t border-black/5 dark:border-white/10">
          <div class="flex items-center justify-between text-[11px] font-medium text-gray-500 dark:text-white/40 px-0.5">
            <span>渐变微调</span>
            <span class="font-mono text-gray-700 dark:text-gray-300">{{ modelValue.toUpperCase() }}</span>
          </div>

          <div class="flex items-center gap-2">
            <div class="relative flex-1 h-7 rounded-xl overflow-hidden border border-black/10 dark:border-white/15 shadow-inner">
              <input
                :value="modelValue"
                type="color"
                class="absolute -inset-4 h-16 w-full cursor-pointer border-0 bg-transparent p-0 opacity-90 transition-opacity hover:opacity-100"
                @input="selectColor(($event.target as HTMLInputElement).value)"
              />
            </div>
            <!-- 原生 Color Input 挂载点（用于点击 Pipette 触发系统吸管） -->
            <input
              ref="nativeColorInputRef"
              :value="modelValue"
              type="color"
              class="sr-only"
              @input="selectColor(($event.target as HTMLInputElement).value)"
            />
          </div>

          <!-- HEX 文本编辑 -->
          <div class="flex items-center gap-2 pt-1">
            <span class="text-xs font-mono font-medium text-gray-400">HEX</span>
            <input
              :value="hexInput"
              type="text"
              maxlength="7"
              spellcheck="false"
              class="h-7 flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-2 font-mono text-xs uppercase text-gray-800 dark:text-gray-100 outline-none transition focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10"
              @input="handleHexInput"
              @change="handleHexInput"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 调色盘面板外框圆角与模糊造型 */
.color-picker-popover-panel {
  background: rgba(255, 255, 255, 0.94);
  border-color: rgba(0, 0, 0, 0.08);
}

:deep(.dark) .color-picker-popover-panel,
.dark .color-picker-popover-panel {
  background: rgba(38, 38, 38, 0.94);
  border-color: rgba(255, 255, 255, 0.1);
}

/* 进退场弹性缩放与渐变动画 */
.color-picker-pop-enter-active,
.color-picker-pop-leave-active {
  transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.color-picker-pop-enter-from,
.color-picker-pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(6px);
}
</style>
