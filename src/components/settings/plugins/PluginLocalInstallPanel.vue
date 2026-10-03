<script setup lang="ts">
import { UploadCloud } from 'lucide-vue-next';
import SettingHint from '../SettingHint.vue';

defineProps<{
  visible: boolean;
  isDragOverDropZone: boolean;
}>();

defineEmits<{
  (e: 'select'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <Transition name="settings-pop-panel">
    <div v-if="visible" class="px-4 pb-4">
      <div class="settings-plugin-inline-panel">
        <div
          class="settings-plugin-dropzone"
          :class="{ 'settings-plugin-dropzone--active': isDragOverDropZone }"
          @click="$emit('select')"
        >
          <div class="settings-plugin-dropzone-icon">
            <UploadCloud class="h-8 w-8" />
          </div>
          <div class="settings-plugin-dropzone-title">
            点击选择文件或拖拽到此处
          </div>
          <SettingHint severity="warning" class="absolute right-4 top-4" text="支持 .js 或 .json 格式的插件文件" />
        </div>
        <div class="flex justify-end mt-3">
          <button
            type="button"
            class="settings-plugin-button settings-plugin-button--ghost"
            @click="$emit('cancel')"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-plugin-dropzone {
  position: relative;
  display: flex; /* 样式 */
  flex-direction: column; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: center; /* 样式 */
  gap: 8px;
  padding: 32px 20px;
  border: 2px dashed rgba(148, 163, 184, 0.35);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer; /* 样式 */
  transition:
    border-color 200ms ease,
    background-color 200ms ease,
    transform 200ms ease;
}

.settings-plugin-dropzone:hover {
  border-color: rgba(236, 65, 65, 0.4); /* 样式 */
  background: rgba(236, 65, 65, 0.04);
  transform: translateY(-1px);
}

.settings-plugin-dropzone--active {
  border-color: rgba(236, 65, 65, 0.6); /* 样式 */
  background: rgba(236, 65, 65, 0.08);
  transform: scale(1.01);
}

.settings-plugin-dropzone-icon {
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: center; /* 样式 */
  width: 56px;
  height: 56px;
  border-radius: 16px; /* 样式 */
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141; /* 样式 */
  transition: background-color 200ms ease, color 200ms ease;
}

.settings-plugin-dropzone--active .settings-plugin-dropzone-icon {
  background: rgba(236, 65, 65, 0.16);
}

.settings-plugin-dropzone-title {
  font-size: 14px;
  font-weight: 600; /* 样式 */
  color: rgba(55, 65, 81, 0.9);
}

.settings-plugin-dropzone-hint {
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 5px;
  font-size: 12px; /* 样式 */
  color: rgba(100, 116, 139, 0.8);
}
</style>
