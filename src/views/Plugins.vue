<script setup lang="ts">
import SettingsPlugins from '../components/settings/SettingsPlugins.vue';
</script>

<template>
  <div class="h-full w-full overflow-y-auto custom-scrollbar pt-[clamp(0.5rem,1.5vh,1.5rem)] pb-10">
    <div class="w-full px-10 pb-16 xl:px-16">
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
