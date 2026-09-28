<script setup lang="ts">
import { ref } from 'vue';

import { rowLag } from './motion';

/**
 * 通用菜单行。默认渲染 div，button 为 true 时渲染原生 button（含禁用态）；
 * step 传入序号后获得错峰入场延迟；alert / alertDrift / frozen 为观感修饰；
 * hoverGroup 决定是否带 `group` 类（供图标槽内的 group-hover 工具类生效）。
 */
defineProps<{
  caption?: string;
  captionClass?: string;
  leadClass?: string;
  step?: number;
  alert?: boolean;
  alertDrift?: boolean;
  frozen?: boolean;
  button?: boolean;
  hoverGroup?: boolean;
}>();

const emit = defineEmits(['pick', 'roam']);

const body = ref<HTMLElement | null>(null);
defineExpose({ body });
</script>

<template>
  <component
    :is="button ? 'button' : 'div'"
    ref="body"
    class="ctx-row"
    :class="{
      'ctx-row--button': button,
      'ctx-row--alert': alert,
      'ctx-row--alert-drift': alertDrift,
      'ctx-row--frozen': frozen,
      group: hoverGroup,
    }"
    :style="typeof step === 'number' ? rowLag(step) : undefined"
    :type="button ? 'button' : undefined"
    :disabled="button && frozen ? true : undefined"
    @click="emit('pick')"
    @mouseenter="emit('roam')"
  >
    <div v-if="$slots.lead" class="mr-3 flex h-5 w-5 items-center justify-center" :class="leadClass">
      <slot name="lead" />
    </div>
    <span class="min-w-0 flex-1 truncate" :class="captionClass"><slot>{{ caption }}</slot></span>
    <slot name="tail" />
  </component>
</template>
