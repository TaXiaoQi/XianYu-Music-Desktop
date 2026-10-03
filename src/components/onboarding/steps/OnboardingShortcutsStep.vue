<script setup lang="ts"> // 实现
// 引导流程快捷按键步：快捷键录入/捕获/冲突检测/保存统一由 useShortcutCapture 提供。
import { useShortcutCapture } from '../../../composables/onboarding/useShortcutCapture';
import { formatShortcutBinding } from '../../../features/settings/shortcuts'; // 实现

const {
  shortcutRows,
  isCapturing,
  startCapture,
  stopCapture,
  restoreDefaultShortcuts,
  handleShortcutCapture,
} = useShortcutCapture();
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-[clamp(2rem,5vw,5rem)] items-start lg:items-stretch lg:h-full lg:overflow-hidden">
    <header class="lg:flex lg:flex-col lg:justify-center">
      <p
        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
        style="font-size: clamp(14px, 1.2vw, 18px);"
      >
        快捷按键
      </p>
      <h2
        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
        style="font-size: clamp(40px, 6vw, 80px);"
      >
        快捷按键
      </h2>
      <p
        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-sm"
        style="font-size: clamp(13px, 1vw, 16px);"
      >
        点击按钮后按键录入，Esc 取消，Backspace 清空。
      </p>
      <button
        type="button"
        class="mt-6 text-black/50 dark:text-white/50 hover:text-[#EC4141] font-medium tracking-wide transition"
        style="font-size: clamp(12px, 1vw, 14px);"
        @click="restoreDefaultShortcuts"
      >
        恢复默认
      </button>
    </header>

    <div class="border-t border-black/10 dark:border-white/10 lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:flex lg:flex-col lg:justify-center">
      <div
        class="py-3 grid grid-cols-[minmax(0,1.2fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-4 text-black/40 dark:text-white/40 font-light uppercase tracking-wider border-b border-black/10 dark:border-white/10"
        style="font-size: clamp(10px, 0.85vw, 12px);"
      >
        <div>功能</div>
        <div>窗口内</div>
        <div>全局</div>
      </div>

      <div
        v-for="row in shortcutRows"
        :key="row.actionId"
        class="py-[clamp(0.75rem,1.5vh,1.25rem)] border-b border-black/5 dark:border-white/5 last:border-0 grid grid-cols-[minmax(0,1.2fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-4 items-center"
      >
        <div
          class="font-medium text-black dark:text-white truncate"
          style="font-size: clamp(14px, 1.1vw, 17px);"
        >
          {{ row.label }}
        </div>
        <button
          type="button"
          @click="startCapture('local', row.actionId)"
          @blur="isCapturing('local', row.actionId) && stopCapture()"
          @keydown="handleShortcutCapture('local', row.actionId, $event)"
          class="w-full text-left border-b transition-all bg-transparent"
          :class="isCapturing('local', row.actionId)
            ? 'border-[#EC4141] text-[#EC4141]'
            : 'border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 hover:border-[#EC4141]/50'"
          style="font-size: clamp(13px, 1vw, 15px); padding: 8px 4px;"
        >
          {{ isCapturing('local', row.actionId) ? '按下新键…' : (formatShortcutBinding(row.localBinding) || '未设置') }}
        </button>
        <button
          type="button"
          @click="startCapture('global', row.actionId)"
          @blur="isCapturing('global', row.actionId) && stopCapture()"
          @keydown="handleShortcutCapture('global', row.actionId, $event)"
          class="w-full text-left border-b transition-all bg-transparent"
          :class="isCapturing('global', row.actionId)
            ? 'border-[#EC4141] text-[#EC4141]'
            : 'border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 hover:border-[#EC4141]/50'"
          style="font-size: clamp(13px, 1vw, 15px); padding: 8px 4px;"
        >
          {{ isCapturing('global', row.actionId) ? '按下新键…' : (formatShortcutBinding(row.globalBinding) || '未设置') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped> /* 样式 */
.custom-scrollbar::-webkit-scrollbar { /* 样式 */
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track { /* 样式 */
  background: transparent; /* 样式 */
}
.custom-scrollbar::-webkit-scrollbar-thumb { /* 样式 */
  background: rgba(0, 0, 0, 0.1); /* 样式 */
  border-radius: 10px; /* 样式 */
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb { /* 样式 */
  background: rgba(255, 255, 255, 0.1); /* 样式 */
}
</style>
