<script setup lang="ts">
import { ref } from 'vue';
import EqualizerPanel from './EqualizerPanel.vue';

const showEqualizer = ref(false);

const toggleEqualizer = () => {
  showEqualizer.value = !showEqualizer.value;
};
</script>

<template>
  <div class="sound-effect-wrapper">
    <button class="sound-effect-btn" :aria-label="'均衡器'" @click="toggleEqualizer">
      <span class="sound-effect-text">均衡器</span>
    </button>
    <EqualizerPanel :visible="showEqualizer" @update:visible="showEqualizer = $event" />
  </div>
</template>

<style scoped>
.sound-effect-wrapper {
  position: relative;
  display: contents;
}

.sound-effect-btn {
  position: relative;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  background-color: transparent;
  border: none;
  display: flex;
  flex-flow: column nowrap;
  padding: 0;
  color: inherit;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
}

.sound-effect-btn:hover {
  transform: scale(1.08);
}

.sound-effect-btn:active {
  transform: scale(0.95);
}

.sound-effect-text {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: 0.5px;
  line-height: 1;
  color: inherit;
  transition: color 0.2s ease;
}

.sound-effect-btn:hover .sound-effect-text {
  color: var(--theme-color, #5885a0);
}
</style>
