<script setup lang="ts">
defineProps<{ everythingPicked: boolean }>();
defineEmits(['toggleAll', 'collect', 'remove', 'finish']);
</script>

<template>
  <div class="flex items-center justify-between mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
    <div class="flex items-center gap-3">
      <button
        @click="$emit('toggleAll')"
        class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path v-if="everythingPicked" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /><template v-else><circle cx="12" cy="12" r="9" stroke-width="2" /></template></svg>
        {{ everythingPicked ? '取消全选' : '全选' }}
      </button>
      <button
        @click="$emit('collect')"
        class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg> 收藏到歌单
      </button>
      <button
        @click="$emit('remove')"
        class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> 删除
      </button>
    </div>
    <div class="flex items-center gap-4">
      <button @click="$emit('finish')" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button>
    </div>
  </div>
</template>
