<script setup lang="ts">
import SettingsPlugins from '../components/settings/SettingsPlugins.vue';
</script>

<template>
  <div class="h-full w-full overflow-y-auto custom-scrollbar px-10 pt-[clamp(0.5rem,1.5vh,1.5rem)] pb-10 xl:px-16">
    <div class="w-full pb-16">
      <div class="mb-[clamp(0.75rem,2vh,1.25rem)]">
        <h1 class="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
          <span class="w-1.5 h-6 bg-[#EC4141] rounded-full"></span>
          插件管理
        </h1>
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
