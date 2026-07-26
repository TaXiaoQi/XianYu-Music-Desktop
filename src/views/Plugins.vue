<script setup lang="ts">
import SettingsPlugins from '../components/settings/SettingsPlugins.vue';
</script>

<template>
  <div class="h-full w-full overflow-y-auto custom-scrollbar px-10 py-10 xl:px-16">
    <div class="w-full pb-16">
      <div class="mb-6">
        <h1 class="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
          <span class="w-1.5 h-6 bg-[#EC4141] rounded-full"></span>
          插件管理
        </h1>
        <p class="text-sm text-gray-500 dark:text-white/55 mt-2 ml-4">
          通过插件扩展音乐源、歌词、封面等在线内容能力
        </p>
      </div>

      <SettingsPlugins />
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
:global(.dark) .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}
</style>
