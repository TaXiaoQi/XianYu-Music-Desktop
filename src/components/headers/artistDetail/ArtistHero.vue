<script setup lang="ts">
import type { TagWriteProgress } from './useAvatarWriter';

defineProps<{
  artistName: string;
  cover: string;
  loading: boolean;
  gradient: string;
  editable: boolean;
  saving: boolean;
  tagTask: TagWriteProgress | null;
  size: string;
  infoHeight: string;
  nameSize: string;
  nameLine: string;
  nameGap: string;
  btnGap: string;
}>();

defineEmits(['pick', 'playAll', 'manage']);
</script>

<template>
  <div class="flex items-center gap-6 h-auto mt-2 mb-6">
    <div
      @click="editable ? $emit('pick') : undefined"
      :style="{ width: size, height: size }"
      class="rounded-full shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5 border-4 border-white/50 dark:border-white/5"
      :class="editable ? 'cursor-pointer' : 'cursor-default'"
    >
      <div v-if="loading" class="w-full h-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
      <img v-else-if="cover" :src="cover" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="artistName" decoding="async" />
      <div v-else class="w-full h-full flex items-center justify-center text-4xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="gradient">
        {{ artistName.charAt(0).toUpperCase() }}
      </div>

      <div v-if="tagTask && !tagTask.done" class="absolute inset-0 bg-black/75 flex flex-col items-center justify-center text-white z-10 p-2 text-center select-none animate-in fade-in duration-200">
        <svg class="animate-spin h-5 w-5 mb-1.5 text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-[10px] font-semibold">同步标签中...</span>
        <span class="text-[10px] opacity-80 mt-0.5 tabular-nums">{{ tagTask.current }}/{{ tagTask.total }}</span>
      </div>

      <div
        v-else-if="editable"
        class="absolute inset-0 bg-black/50 opacity-0 flex flex-col items-center justify-center text-white transition-opacity duration-300 gap-1.5"
        :class="saving ? 'hidden' : 'group-hover:opacity-100'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <span class="text-xs font-semibold">修改头像</span>
      </div>
    </div>

    <div :style="{ height: infoHeight }" class="flex flex-col justify-start pt-2 pb-1 flex-1 min-w-0">
      <div :style="{ marginBottom: nameGap }">
        <h1 :style="{ fontSize: nameSize, lineHeight: nameLine }" class="font-bold text-gray-900 dark:text-white truncate max-w-[600px] leading-tight">
          {{ artistName }}
        </h1>
      </div>

      <div class="flex items-center gap-3" :style="{ marginTop: btnGap }">
        <button
          @click="$emit('playAll')"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-6 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5.5v13l10-6.5-10-6.5Z" />
          </svg>
          播放全部
        </button>

        <button
          v-if="editable"
          @click="$emit('manage')"
          title="批量操作"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          管理
        </button>
      </div>
    </div>
  </div>
</template>
