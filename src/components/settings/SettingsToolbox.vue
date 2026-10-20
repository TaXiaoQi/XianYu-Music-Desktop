<script setup lang="ts">
import { ref } from 'vue';
import ToolboxHome from './toolbox/ToolboxHome.vue';
import ToolboxBatchFlow from './toolbox/ToolboxBatchFlow.vue';
import ToolboxToolHeader from './toolbox/ToolboxToolHeader.vue';
import SettingsAudioConvert from './SettingsAudioConvert.vue';
import SettingsAudioTrim from './SettingsAudioTrim.vue';

type ToolboxToolKey = 'music-tag-flow' | 'format-convert' | 'audio-trim';

const ROUTABLE_TOOLS: ToolboxToolKey[] = ['music-tag-flow', 'format-convert', 'audio-trim'];

const openedToolKey = ref<ToolboxToolKey | null>(null);

const launchTool = (toolKey: string) => {
  if (ROUTABLE_TOOLS.includes(toolKey as ToolboxToolKey)) {
    openedToolKey.value = toolKey as ToolboxToolKey;
  }
};

const closeTool = () => {
  openedToolKey.value = null;
};
</script>

<template>
  <ToolboxHome v-if="openedToolKey === null" @launch="launchTool" />

  <ToolboxBatchFlow
    v-else-if="openedToolKey === 'music-tag-flow'"
    @exit="closeTool"
  />

  <div
    v-else-if="openedToolKey === 'format-convert'"
    class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <ToolboxToolHeader caption="文件转换 · 格式转换" @back="closeTool" />
    <SettingsAudioConvert />
  </div>

  <div
    v-else
    class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300"
  >
    <ToolboxToolHeader caption="文件转换 · 音频剪辑" @back="closeTool" />
    <SettingsAudioTrim />
  </div>
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
