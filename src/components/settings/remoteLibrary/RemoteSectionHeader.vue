<script setup lang="ts">
defineOptions({ name: 'RemoteSectionHeader' });
</script>

<template>
  <h2 class="rl-heading">
    <span class="rl-heading__accent" aria-hidden="true"></span>
    <slot />
  </h2>
</template>

<style scoped>
.rl-heading {
  display: flex;
  align-items: center;
  column-gap: 8px;
  color: #1f2937;
  font-size: 14px;
  font-weight: 700;
}

.rl-heading__accent {
  display: block;
  width: 4px;
  height: 16px;
  border-radius: 9999px;
  background: #ec4141;
}

html.dark .rl-heading {
  color: #e5e7eb;
}
</style>
