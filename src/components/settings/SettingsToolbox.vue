<script setup lang="ts">
import ToolboxHome from './toolbox/ToolboxHome.vue';
</script>

<template>
  <ToolboxHome />
</template>

<style>
html.dark .toolbox-panel,
html.dark .toolbox-panel--muted {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

html.dark .toolbox-item {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

html.dark .toolbox-item:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .toolbox-path-field {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
}

html.dark .toolbox-chip {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}

html.dark .toolbox-list {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

html.dark .toolbox-list-header {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

html.dark .toolbox-list-row {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}

html.dark .toolbox-list-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
</style>
