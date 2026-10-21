<script setup lang="ts">
// 音源列表的行包装层：作为 TransitionGroup 的直接子节点（真实元素），
// FLIP move class 落在此根元素上，带动内部卡片做重排补间动画。
// 注意：模板根层级不能有任何节点（包括 HTML 注释）——dev 模式下注释会被编译进
// 渲染输出，把组件子树变成 Fragment（锚点是文本节点），组件 vnode 的 .el 不再是
// Element，会被 TransitionGroup 的 el instanceof Element 过滤，拖拽 FLIP 动画
// 整体静默失效；同样不要用 <template v-for> 直接包卡片，是同一个坑。
</script>

<template>
  <div class="plugin-sortable-row">
    <slot />
  </div>
</template>
