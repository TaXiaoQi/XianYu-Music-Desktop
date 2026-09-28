<script setup lang="ts">
defineProps<{
  caption: string;
}>();

defineEmits<{
  (e: 'back'): void;
}>();
</script>

<template>
  <div class="flex items-center gap-2 px-5">
    <button
      type="button"
      class="toolbox-ghost-btn"
      @click="$emit('back')"
    >
      ← 返回工具箱
    </button>
    <span class="text-sm text-gray-500 dark:text-white/50">{{ caption }}</span>
  </div>
</template>

<style scoped>
.toolbox-ghost-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  background: #ec4141;
  font-size: 0.75rem;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
  transition: background 160ms ease;
}

.toolbox-ghost-btn:hover {
  background: #d13b3b;
}
</style>
