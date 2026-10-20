<template>
  <!-- 音源列表的行包装层：作为 TransitionGroup 的直接子节点（真实元素），
       FLIP move class 落在此根元素上，带动内部卡片做重排补间动画。
       注意不要用 <template v-for> 直接包卡片——Fragment 锚点是文本节点，
       会被 TransitionGroup 的 el instanceof Element 过滤，动画整体静默失效。 -->
  <div class="plugin-sortable-row">
    <slot />
  </div>
</template>
