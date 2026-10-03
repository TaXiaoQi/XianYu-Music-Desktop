<script setup lang="ts"> // 实现
// 引导流程主题选择步：外观主题四选一。
// "自定义"暂不支持，通过 custom-select 事件交由主组件弹提示。
import { useSettingsThemeControls } from '../../../composables/useSettingsThemeControls'; // 实现

const emit = defineEmits<{
  (event: 'custom-select'): void;
}>();

const { colorScheme, setColorScheme } = useSettingsThemeControls(); // 实现

// --- 点击"自定义"主题：暂不支持，通知主组件弹提示 ---
const handleCustomThemeClick = () => {
  emit('custom-select');
};
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-[clamp(2rem,5vw,5rem)] items-center lg:items-stretch lg:h-full lg:overflow-hidden">
    <header class="lg:flex lg:flex-col lg:justify-center">
      <p
        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
        style="font-size: clamp(14px, 1.2vw, 18px);"
      >
        外观主题
      </p>
      <h2
        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
        style="font-size: clamp(48px, 7vw, 96px);"
      >
        主题
      </h2>
      <p
        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-md"
        style="font-size: clamp(14px, 1.1vw, 17px);"
      >
        可在设置中随时更改。浅色模式明亮清新，深色模式护眼沉浸，跟随系统自动适应，自定义支持个性化皮肤。
      </p>
    </header>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-[clamp(0.75rem,1.5vw,1.5rem)] lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:content-center">
      <button
        v-for="opt in [
          { value: 'light', label: '浅色模式', desc: '明亮清新' },
          { value: 'dark', label: '深色模式', desc: '护眼沉浸' },
          { value: 'system', label: '跟随系统', desc: '自动适应' },
          { value: 'custom', label: '自定义', desc: '个性化皮肤' },
        ]"
        :key="opt.value"
        type="button"
        class="group relative flex flex-col items-start gap-[clamp(1rem,2vh,1.5rem)] pb-[clamp(1rem,2vh,1.5rem)] transition-all text-left"
        :class="colorScheme === opt.value
          ? 'border-b-2 border-[#EC4141]'
          : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50'"
        @click="opt.value === 'custom' ? handleCustomThemeClick() : setColorScheme(opt.value as 'dark' | 'light' | 'system')"
      >
        <div
          class="w-[clamp(56px,7vw,84px)] h-[clamp(56px,7vw,84px)] rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 border border-black/10 dark:border-white/10"
          :class="opt.value === 'dark'
            ? 'bg-black dark:bg-white'
            : opt.value === 'light'
              ? 'bg-white dark:bg-black'
              : opt.value === 'system'
                ? 'bg-gray-100 dark:bg-gray-800'
                : 'bg-black dark:bg-white'"
        >
          <svg
            v-if="opt.value === 'dark'"
            xmlns="http://www.w3.org/2000/svg"
            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-white dark:text-black"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          <svg
            v-else-if="opt.value === 'system'"
            xmlns="http://www.w3.org/2000/svg"
            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-black/70 dark:text-white/70"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <svg
            v-else-if="opt.value === 'light'"
            xmlns="http://www.w3.org/2000/svg"
            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-black dark:text-white"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-white dark:text-black"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"></path></svg>
        </div>
        <div>
          <div
            class="font-semibold"
            :class="colorScheme === opt.value ? 'text-[#EC4141]' : 'text-black dark:text-white'"
            style="font-size: clamp(16px, 1.4vw, 22px);"
          >
            {{ opt.label }}
          </div>
          <div
            class="text-black/40 dark:text-white/40 font-light mt-1"
            style="font-size: clamp(11px, 0.9vw, 14px);"
          >
            {{ opt.desc }}
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
