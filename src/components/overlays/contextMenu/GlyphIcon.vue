<script setup lang="ts">
import type { GlyphShape, GlyphStroke } from './songMenuPlan';

// 按 GlyphShape 定义渲染单色图标：solid 决定填充还是描边，
// edge 覆盖默认描边粗细，evenOdd 的路径段以奇偶规则填充。
defineProps<{ shape: GlyphShape }>();

const plain = (seg: GlyphStroke): { d: string; evenOdd?: boolean } =>
  typeof seg === 'string' ? { d: seg } : seg;
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="shape.canvas ?? '0 0 24 24'"
    class="h-5 w-5"
    :fill="shape.solid ? 'currentColor' : 'none'"
    :stroke="shape.solid ? 'none' : 'currentColor'"
    :stroke-width="shape.solid ? undefined : (shape.edge ?? '1.7')"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path
      v-for="(seg, order) in shape.strokes"
      :key="order"
      :d="plain(seg).d"
      :fill-rule="plain(seg).evenOdd ? 'evenodd' : undefined"
      :clip-rule="plain(seg).evenOdd ? 'evenodd' : undefined"
    />
  </svg>
</template>
