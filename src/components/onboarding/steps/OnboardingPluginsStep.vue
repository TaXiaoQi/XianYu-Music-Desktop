<script setup lang="ts"> // 实现
// 引导流程插件步：安装渠道介绍。
// 插件管理器的挂载与遮罩切换逻辑由主组件持有，这里只发事件。
const emit = defineEmits<{
  (event: 'open-manager'): void;
}>();

// --- 打开插件管理：通知主组件显示全屏管理器遮罩 ---
const openPluginManager = () => {
  emit('open-manager');
};
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.45fr] gap-[clamp(2rem,5vw,5rem)] items-center lg:items-stretch lg:h-full lg:overflow-hidden">
    <header class="lg:flex lg:flex-col lg:justify-center">
      <p
        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
        style="font-size: clamp(14px, 1.2vw, 18px);"
      >
        插件管理
      </p>
      <h2
        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
        style="font-size: clamp(40px, 6vw, 80px);"
      >
        音乐来源
      </h2>
      <p
        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-sm"
        style="font-size: clamp(13px, 1vw, 16px);"
      >
        安装插件后，可以搜索和播放更多在线音乐。也可以稍后前往设置中的插件管理添加。
      </p>
    </header>

    <div class="border-t border-black/10 dark:border-white/10 lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:flex lg:flex-col lg:justify-center">
      <div class="grid grid-cols-1 sm:grid-cols-3 border-b border-black/10 dark:border-white/10">
        <div class="py-5 sm:pr-5">
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
          </div>
          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(14px, 1.1vw, 17px);">本地文件</div>
          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(11px, 0.9vw, 13px);">导入 JS 或 JSON 插件</div>
        </div>
        <div class="py-5 sm:px-5">
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>
          </div>
          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(14px, 1.1vw, 17px);">网络链接</div>
          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(11px, 0.9vw, 13px);">通过插件地址安装</div>
        </div>
        <div class="py-5 sm:pl-5">
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="m15 5-3 3-3-3"/><rect width="18" height="12" x="3" y="10" rx="2"/><path d="M7 14h.01"/><path d="M11 14h6"/></svg>
          </div>
          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(14px, 1.1vw, 17px);">订阅管理</div>
          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(11px, 0.9vw, 13px);">批量同步多个来源</div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-5 py-6">
        <div>
          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(15px, 1.2vw, 18px);">添加或管理插件</div>
          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(12px, 0.9vw, 14px);">安装、启停、更新或移除已有插件</div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-full bg-[#EC4141] px-[clamp(1.5rem,2.5vw,2.5rem)] py-3 font-medium text-white transition hover:bg-red-600 active:scale-95"
          style="font-size: clamp(13px, 1vw, 15px);"
          @click="openPluginManager"
        >
          添加或管理插件
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
