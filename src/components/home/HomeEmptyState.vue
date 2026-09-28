<script lang="ts" setup>
// 空态占位组件：只负责渲染一段提示文案与一个线性图标，样式全部内聚于本组件。
defineProps<{ message: string; iconPath: string }>();
</script>

<template>
  <section class="empty-hint">
    <svg
      class="empty-hint__glyph"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path :d="iconPath" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg><!-- 线性图标，path 数据由父组件传入 -->
    <p class="empty-hint__text">{{ message }}</p>
  </section>
</template>

<style scoped>
.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  color: rgb(156 163 175);
}

:global(.dark) .empty-hint {
  color: rgb(107 114 128);
}

.empty-hint__glyph {
  width: 4rem;
  height: 4rem;
  margin-bottom: 1rem;
  opacity: 0.3;
}

.empty-hint__text {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
</style>
