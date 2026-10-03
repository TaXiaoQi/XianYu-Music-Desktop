<script setup lang="ts"> // 实现
// 引导流程窗口材质步：none / mica / acrylic / blur 四档选择与失焦保材质开关。
import { useSettingsThemeControls } from '../../../composables/useSettingsThemeControls'; // 实现

type OnboardingWindowMaterial = 'none' | 'mica' | 'acrylic' | 'blur'; // 实现

const {
  materialMode, // 实现
  keepWindowMaterialOnBlur,
  setKeepWindowMaterialOnBlur,
  toggleWindowMaterial, // 实现
  isWindowMaterialButtonDisabled, // 实现
  isWindows11, // 实现
} = useSettingsThemeControls(); // 实现

// --- 默认材质按钮：切回 none ---
const setMaterialToNone = () => { // 实现
  if (materialMode.value !== 'none') { // 实现
    toggleWindowMaterial(materialMode.value as 'acrylic' | 'mica' | 'blur'); // 实现
  }
};

const selectWindowMaterial = (mode: OnboardingWindowMaterial) => { // 实现
  if (materialMode.value === mode) return; // 实现
  if (mode === 'none') { // 实现
    setMaterialToNone(); // 实现
    return;
  }
  if (isWindowMaterialButtonDisabled(mode)) return; // 实现
  toggleWindowMaterial(mode); // 实现
};
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-[clamp(2rem,5vw,5rem)] items-center lg:items-stretch lg:h-full lg:overflow-hidden">
    <header class="lg:flex lg:flex-col lg:justify-center">
      <p
        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
        style="font-size: clamp(14px, 1.2vw, 18px);"
      >
        窗口材质
      </p>
      <h2
        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
        style="font-size: clamp(48px, 7vw, 96px);"
      >
        材质
      </h2>
      <p
        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-md"
        style="font-size: clamp(14px, 1.1vw, 17px);"
      >
        影响窗口背景的视觉效果，可在设置中随时更改。Mica 与 Acrylic 仅 Windows 11 可用。
      </p>
    </header>

    <div class="grid grid-cols-2 gap-[clamp(1rem,2vw,2rem)] lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:content-center">
      <button
        type="button"
        class="group relative flex cursor-pointer items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
        :class="materialMode === 'none'
          ? 'border-b-2 border-[#EC4141]'
          : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50'"
        @click="selectWindowMaterial('none')"
      >
        <div
          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-transform group-hover:scale-105"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/60 dark:text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect></svg>
        </div>
        <div>
          <div
            class="font-semibold"
            :class="materialMode === 'none' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
            style="font-size: clamp(18px, 1.5vw, 24px);"
          >
            默认
          </div>
          <div
            class="text-black/40 dark:text-white/40 font-light mt-1"
            style="font-size: clamp(12px, 1vw, 14px);"
          >
            无透明效果
          </div>
        </div>
      </button>

      <button
        type="button"
        class="group relative flex items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
        :class="[
          materialMode === 'mica'
            ? 'border-b-2 border-[#EC4141]'
            : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50',
          isWindowMaterialButtonDisabled('mica') ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
        ]"
        :disabled="isWindowMaterialButtonDisabled('mica')"
        @click="selectWindowMaterial('mica')"
      >
        <div
          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur flex items-center justify-center border border-black/10 dark:border-white/10 transition-transform group-hover:scale-105"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/70 dark:text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>
        </div>
        <div>
          <div
            class="font-semibold"
            :class="materialMode === 'mica' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
            style="font-size: clamp(18px, 1.5vw, 24px);"
          >
            Mica
          </div>
          <div
            class="text-black/40 dark:text-white/40 font-light mt-1"
            style="font-size: clamp(12px, 1vw, 14px);"
          >
            {{ isWindows11 ? '云母材质' : '仅 Win11' }}
          </div>
        </div>
      </button>

      <button
        type="button"
        class="group relative flex items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
        :class="[
          materialMode === 'acrylic'
            ? 'border-b-2 border-[#EC4141]'
            : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50',
          isWindowMaterialButtonDisabled('acrylic') ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
        ]"
        :disabled="isWindowMaterialButtonDisabled('acrylic')"
        @click="selectWindowMaterial('acrylic')"
      >
        <div
          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur-md flex items-center justify-center border border-black/10 dark:border-white/10 transition-transform group-hover:scale-105"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/70 dark:text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </div>
        <div>
          <div
            class="font-semibold"
            :class="materialMode === 'acrylic' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
            style="font-size: clamp(18px, 1.5vw, 24px);"
          >
            Acrylic
          </div>
          <div
            class="text-black/40 dark:text-white/40 font-light mt-1"
            style="font-size: clamp(12px, 1vw, 14px);"
          >
            {{ isWindows11 ? '亚克力半透明' : '仅 Win11' }}
          </div>
        </div>
      </button>

      <button
        type="button"
        class="group relative flex items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
        :class="[
          materialMode === 'blur'
            ? 'border-b-2 border-[#EC4141]'
            : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50',
          isWindowMaterialButtonDisabled('blur') ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
        ]"
        :disabled="isWindowMaterialButtonDisabled('blur')"
        @click="selectWindowMaterial('blur')"
      >
        <div
          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur-lg flex items-center justify-center border border-black/10 dark:border-white/10 transition-transform group-hover:scale-105"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/70 dark:text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>
        </div>
        <div>
          <div
            class="font-semibold"
            :class="materialMode === 'blur' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
            style="font-size: clamp(18px, 1.5vw, 24px);"
          >
            Blur
          </div>
          <div
            class="text-black/40 dark:text-white/40 font-light mt-1"
            style="font-size: clamp(12px, 1vw, 14px);"
          >
            高斯模糊背景
          </div>
        </div>
      </button>
    </div>

    <label
      class="mt-[clamp(0.75rem,1.5vw,1.25rem)] flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-black/8 dark:border-white/8 px-[clamp(0.75rem,1.5vw,1rem)] py-[clamp(0.625rem,1vw,0.875rem)] transition-all"
      :class="materialMode === 'none'
        ? 'cursor-not-allowed opacity-40'
        : 'hover:border-[#EC4141]/30 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'"
    >
      <div class="flex flex-col gap-1">
        <span
          class="font-medium text-black/80 dark:text-white/80"
          style="font-size: clamp(14px, 1.1vw, 16px);"
        >保持材质</span>
        <span
          class="text-black/40 dark:text-white/40 font-light"
          style="font-size: clamp(11px, 0.9vw, 13px);"
        >开启后窗口失焦时不会卸载材质，避免切换时的闪烁</span>
      </div>
      <span class="flex items-center shrink-0">
        <input
          type="checkbox"
          class="sr-only"
          :checked="keepWindowMaterialOnBlur"
          :disabled="materialMode === 'none'"
          @change="setKeepWindowMaterialOnBlur(($event.target as HTMLInputElement).checked)"
        />
        <span
          class="relative h-6 w-11 rounded-full transition-colors"
          :class="keepWindowMaterialOnBlur && materialMode !== 'none' ? 'bg-[#EC4141]' : 'bg-black/15 dark:bg-white/20'"
        >
          <span
            class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
            :class="keepWindowMaterialOnBlur && materialMode !== 'none' ? 'translate-x-5' : ''"
          ></span>
        </span>
      </span>
    </label>
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
