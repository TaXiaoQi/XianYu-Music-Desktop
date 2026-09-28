<script setup lang="ts">
import { SHADOW_SWATCHES } from './useDesktopLyricsDraft';

defineProps<{
  /** 当前阴影颜色值 */
  value: string;
  /** 是否为自定义（非预设）颜色 */
  customActive: boolean;
}>();

const emit = defineEmits<{ select: [hex: string] }>();
</script>

<template>
  <div class="sw-cell">
    <div class="sw-cell-label">阴影颜色</div>
    <div class="sw-row">
      <button
        v-for="swatch in SHADOW_SWATCHES"
        :key="swatch.value"
        type="button"
        class="sw-preset"
        :class="{ 'sw-preset--active': value === swatch.value }"
        :style="{ backgroundColor: swatch.value }"
        :title="'切换阴影颜色: ' + swatch.label"
        @click="emit('select', swatch.value)"
      />
      <label class="sw-custom" :class="{ 'sw-custom--active': customActive }" title="自定义阴影颜色">
        <input
          type="color"
          :value="value"
          aria-label="自定义阴影颜色"
          @input="emit('select', ($event.target as HTMLInputElement).value)"
        >
        <span class="sw-custom-fill" :style="{ backgroundColor: value }" />
      </label>
    </div>
  </div>
</template>

<style scoped>
.sw-cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  min-height: 48px;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  transition: all 180ms ease;
}
:global(.dark) .sw-cell {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
.sw-cell:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(236, 65, 65, 0.35);
}
:global(.dark) .sw-cell:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(236, 65, 65, 0.35);
}
.sw-cell-label {
  font-size: 13px;
  font-weight: 700;
  color: rgb(55 65 81);
  user-select: none;
  white-space: nowrap;
}
:global(.dark) .sw-cell-label {
  color: rgba(255, 255, 255, 0.68);
}

.sw-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
}
.sw-preset {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
.sw-preset:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 1px #ec4141, 0 2px 6px rgba(236, 65, 65, 0.15);
}
.sw-preset--active {
  transform: scale(1.15);
  border-color: #fff !important;
  box-shadow: 0 0 0 2px #ec4141, 0 3px 8px rgba(236, 65, 65, 0.24) !important;
}
:global(.dark) .sw-preset {
  border-color: rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.2);
}
:global(.dark) .sw-preset:hover {
  box-shadow: 0 0 0 1.5px #ff8b8b, 0 2px 6px rgba(236, 65, 65, 0.2);
}
:global(.dark) .sw-preset--active {
  box-shadow: 0 0 0 2px #ff8b8b, 0 3px 8px rgba(236, 65, 65, 0.3) !important;
}

.sw-custom {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
.sw-custom input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.sw-custom-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
  background-image: linear-gradient(45deg, #bbb 25%, transparent 25%),
                    linear-gradient(-45deg, #bbb 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #bbb 75%),
                    linear-gradient(-45deg, transparent 75%, #bbb 75%);
  background-size: 4px 4px;
  background-position: 0 0, 0 2px, 2px -2px, -2px 0;
}
:global(.dark) .sw-custom-fill {
  border-color: rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.2);
}
.sw-custom:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 1px #ec4141, 0 2px 6px rgba(236, 65, 65, 0.15);
}
.sw-custom--active {
  transform: scale(1.15);
  box-shadow: 0 0 0 2px #ec4141, 0 3px 8px rgba(236, 65, 65, 0.24) !important;
}
:global(.dark) .sw-custom:hover {
  box-shadow: 0 0 0 1.5px #ff8b8b, 0 2px 6px rgba(236, 65, 65, 0.2);
}
:global(.dark) .sw-custom--active {
  box-shadow: 0 0 0 2px #ff8b8b, 0 3px 8px rgba(236, 65, 65, 0.3) !important;
}
</style>
