<script setup lang="ts">
import { computed } from 'vue';
import { useSearchAwareTitle } from '../../composables/useSearchAwareTitle';
import SortModeButton from '../common/SortModeButton.vue';

const props = defineProps<{
  isBatchMode: boolean;
  selectedCount?: number;
  totalSongCount?: number;
}>();

const emit = defineEmits(['update:isBatchMode', 'playAll', 'batchPlay', 'addToPlaylist', 'batchDelete', 'batchDownload', 'clearAll', 'addAllToQueue', 'selectAll']);

const isAllSelected = computed(() =>
  (props.totalSongCount ?? 0) > 0 && (props.selectedCount ?? 0) === props.totalSongCount,
);

const pageTitle = useSearchAwareTitle('我的收藏');

const handlePlayAll = () => { 
  emit('playAll');
};

const handleAddAllToQueue = () => {
  emit('addAllToQueue');
};

const handleEnterBatchMode = () => {
  emit('update:isBatchMode', true);
};
</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-[clamp(0px,0.3vh,4px)] pb-[clamp(6px,1vh,12px)] h-auto justify-center">
    
    <!-- 批量操作模式 -->
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
      <div class="flex items-center gap-3">
        <button @click="emit('selectAll')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path v-if="isAllSelected" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /><template v-else><circle cx="12" cy="12" r="9" stroke-width="2" /></template></svg>
          {{ isAllSelected ? '取消全选' : '全选' }}
        </button>
        <button @click="emit('addToPlaylist')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg> 收藏到歌单
        </button>
        <button @click="emit('batchDownload')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
          下载
        </button>
        <button @click="emit('batchDelete')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> 删除
        </button>
      </div>
      <div class="flex items-center gap-4">
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button>
      </div>
    </div>

    <!-- 正常模式 -->
    <div v-else class="flex items-center justify-between">
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

        <!-- 批量操作 -->
        <button 
          @click="handleEnterBatchMode" 
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="批量操作"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
        </button>

        <!-- 排序方式 -->
        <SortModeButton />
      </div>
    </div>

  </div>
</template>
