<template>
  <!-- 队列暂无曲目时的占位画面 -->
  <div class="flex h-full flex-col items-center justify-center space-y-4 py-20 text-[#34445c] dark:text-white/90">
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-white/70 shadow-inner dark:bg-white/10">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-[#42526a] dark:text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
        />
      </svg>
    </div>
    <span class="text-sm font-medium">播放队列为空</span>
  </div>
</template>
