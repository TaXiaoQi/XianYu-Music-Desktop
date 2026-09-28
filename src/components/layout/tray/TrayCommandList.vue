<script setup lang="ts">
import { Maximize2, Minimize2, Power, Settings } from 'lucide-vue-next';

defineProps<{
  miniMode: boolean;
}>();

const emit = defineEmits<{
  lyrics: [];
  toggleMini: [];
  settings: [];
  quit: [];
}>();
</script>

<template>
  <div>
    <div class="rule" />

    <button class="entry" @click="emit('lyrics')">
      <span class="entry__glyph entry__glyph--textual">词</span>
      <span class="entry__caption">桌面歌词</span>
    </button>

    <div class="rule" />

    <button class="entry" @click="emit('toggleMini')">
      <span class="entry__glyph">
        <component :is="miniMode ? Maximize2 : Minimize2" :size="18" :stroke-width="2.15" />
      </span>
      <span class="entry__caption">{{ miniMode ? '恢复主窗口' : 'mini窗口' }}</span>
    </button>

    <button class="entry" @click="emit('settings')">
      <span class="entry__glyph">
        <Settings :size="18" :stroke-width="2.15" />
      </span>
      <span class="entry__caption">设置</span>
    </button>

    <div class="rule" />

    <button class="entry" @click="emit('quit')">
      <span class="entry__glyph">
        <Power :size="18" :stroke-width="2.15" />
      </span>
      <span class="entry__caption">退出</span>
    </button>
  </div>
</template>

<style scoped>
.rule {
  height: 1px;
  margin: 3px 13px;
  background: var(--trayRule);
}

.entry {
  display: flex;
  align-items: center;
  width: calc(100% - 12px);
  height: 32px;
  margin: 0 6px;
  gap: 9px;
  border-radius: 7px;
  padding: 0 7px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--trayInk);
  cursor: default;
  flex-shrink: 0;
}

.entry:hover {
  background: var(--trayHover);
  color: var(--trayInk);
}

.entry__glyph {
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  color: currentColor;
}

.entry__glyph--textual {
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
}

.entry__caption {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  color: currentColor;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
