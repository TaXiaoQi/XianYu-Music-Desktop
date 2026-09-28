<script setup lang="ts">
import ModernModal from '../../common/ModernModal.vue';

defineProps<{
  /** 弹窗是否展示 */
  shown: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:shown', value: boolean): void;
  (e: 'confirmed'): void;
}>();
</script>

<template>
  <!-- 清空队列前的二次确认弹窗 -->
  <ModernModal
    :visible="shown"
    type="danger"
    title="清空播放队列"
    confirm-text="清空"
    content="确定要清空当前播放队列吗？此操作不会影响本地文件。"
    @update:visible="emit('update:shown', $event)"
    @confirm="emit('confirmed')"
  />
</template>
