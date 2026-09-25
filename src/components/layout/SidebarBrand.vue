<template>
  <!-- 品牌区：整块作为窗口拖拽区域；子元素设 pointer-events-none，
       保证拖拽始终命中带 data-tauri-drag-region 的容器 -->
  <div class="h-16 px-6 shrink-0 mb-2 flex items-center justify-center" data-tauri-drag-region>
    <img
      src="/logo.png"
      alt="Logo"
      class="object-contain drop-shadow-sm opacity-80 w-[29px] h-[29px] dark:invert pointer-events-none shrink-0 translate-x-[-14px] translate-y-[11px]"
    />
    <h1 class="font-medium tracking-wide text-[18px] text-[#353A3E] dark:text-white/80 pointer-events-none translate-x-[-3px] translate-y-[12px]">
      弦予音乐
    </h1>
  </div>
</template>
