<script setup lang="ts">
import { useSearchAwareTitle } from '../../composables/useSearchAwareTitle';
import SortModeButton from '../common/SortModeButton.vue';

defineProps<{
}>();

const emit = defineEmits(['playAll', 'clearHistory', 'addAllToQueue']);

const pageTitle = useSearchAwareTitle('最近播放');

const handlePlayAll = () => {
  emit('playAll');
};

const handleAddAllToQueue = () => {
  emit('addAllToQueue');
};

</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-[clamp(0px,0.3vh,4px)] pb-[clamp(6px,1vh,12px)] h-auto justify-center">

    <!-- 正常模式 -->
    <div class="flex items-center justify-between">
      <!-- 左侧标题 -->
      <div class="flex items-center gap-2 pb-1">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ pageTitle }}</h2>
      </div>

      <!-- 右侧操作按钮 -->
      <div class="flex items-center gap-2">

        <!-- 播放全部 -->
        <button
          @click="handlePlayAll"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="播放全部"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5.5v13l10-6.5-10-6.5Z" />
          </svg>
        </button>

        <!-- 全部添加至播放列表 -->
        <button
          @click="handleAddAllToQueue"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="全部添加至播放列表"
        >
          <!-- 队列列表 + 加号 -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 6H17" />
            <path d="M3.5 12H14" />
            <path d="M3.5 18H11" />
            <path d="M18 14v6" />
            <path d="M15 17h6" />
          </svg>
        </button>

        <!-- 清空播放记录 -->
        <button
          @click="emit('clearHistory')"
          class="bg-white/1 hover:bg-red-50 dark:hover:bg-red-500/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-[#EC4141] w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-red-200 dark:hover:border-red-500/30"
          title="清空播放记录"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>

        <!-- 排序方式 -->
        <SortModeButton />
      </div>
    </div>

  </div>
</template>
