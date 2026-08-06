<script setup lang="ts">
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useSearchTitleSuffix } from '../../composables/useSearchAwareTitle';
import SortModeButton from '../common/SortModeButton.vue';

defineProps<{
}>();

const emit = defineEmits(['playAll', 'clearHistory', 'addAllToQueue']);

import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';

const { 
  recentTab, 
} = usePlayerViewState();

const searchSuffix = useSearchTitleSuffix();

// --- Tab Underline Logic ---
const tabsContainer = ref<HTMLElement | null>(null);
const underlineStyle = ref({ transform: 'translateX(0)', width: '0px' });

const updateUnderline = async () => {
  await nextTick();
  if (!tabsContainer.value) return;
  
  const activeBtn = tabsContainer.value.querySelector('.tab-active') as HTMLElement;
  if (activeBtn) {
    const containerRect = tabsContainer.value.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    
    const underlineWidth = 16; 
    const left = (btnRect.left - containerRect.left) + (btnRect.width / 2) - (underlineWidth / 2);
    
    underlineStyle.value = {
      transform: `translateX(${left}px)`,
      width: `${underlineWidth}px`
    };
  }
};

watch(() => recentTab.value, updateUnderline);
onMounted(() => {
  window.addEventListener('resize', updateUnderline);
  updateUnderline();
});
onUnmounted(() => window.removeEventListener('resize', updateUnderline));

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
      <!-- 左侧 Tab 切换 -->
      <div class="flex items-center gap-6 relative pb-1" ref="tabsContainer">
        <button 
          @click="recentTab='songs'" 
          class="tab-item transition-all duration-300 ease-out active:scale-90"
          :class="recentTab === 'songs' ? 'tab-active text-gray-900 dark:text-white font-bold text-xl' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg'"
        >
          单曲
        </button>
        <button 
          @click="recentTab='playlists'" 
          class="tab-item transition-all duration-300 ease-out active:scale-90"
          :class="recentTab === 'playlists' ? 'tab-active text-gray-900 dark:text-white font-bold text-xl' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg'"
        >
          歌单
        </button>
        <button 
          @click="recentTab='albums'" 
          class="tab-item transition-all duration-300 ease-out active:scale-90"
          :class="recentTab === 'albums' ? 'tab-active text-gray-900 dark:text-white font-bold text-xl' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg'"
        >
          专辑
        </button>

        <!-- 滑动底线 -->
        <div 
          class="absolute -bottom-1 h-1 bg-[#EC4141] rounded-full transition-all duration-300 ease-out pointer-events-none"
          :style="underlineStyle"
        ></div>
      </div>

      <!-- 搜索结果提示（仅搜索时显示） -->
      <span
        v-if="searchSuffix"
        class="ml-1 shrink-0 truncate text-base font-medium text-gray-500 dark:text-gray-400"
      >
        {{ searchSuffix }}
      </span>

      <!-- 右侧操作按钮 -->
      <div v-if="recentTab === 'songs'" class="flex items-center gap-2">
        
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

        <!-- 排序方式：仅单曲 tab 有意义（歌单/专辑是聚合视图） -->
        <SortModeButton v-if="recentTab === 'songs'" />
      </div>
    </div>

  </div>
</template>
