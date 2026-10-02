<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import CustomColorPicker from '../CustomColorPicker.vue';
import type { DesktopCustomColorTarget } from './useDesktopLyricsDraft';

const props = defineProps<{
  /** 配色弹窗是否打开 */
  open: boolean;
  showRomaji: boolean;
  showTranslation: boolean;
  playedColor: string;
  unplayedColor: string;
  romajiPlayedColor: string;
  romajiUnplayedColor: string;
  translationColor: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  /** 点亮某个颜色槽位（同时把方案切到自定义） */
  activate: [target: DesktopCustomColorTarget];
  /** 取色面板产出了新颜色 */
  apply: [target: DesktopCustomColorTarget, hex: string];
}>();

const TARGET_TITLES: Record<DesktopCustomColorTarget, string> = {
  played: '主歌词 已播放',
  unplayed: '主歌词 未播放',
  romajiPlayed: '罗马音 已播放',
  romajiUnplayed: '罗马音 未播放',
  translation: '翻译',
};

const currentTarget = ref<DesktopCustomColorTarget | null>(null);
const pickerAnchor = ref<HTMLElement | null>(null);

const colorRows = computed(() => [
  { target: 'played' as const, title: TARGET_TITLES.played, color: props.playedColor },
  { target: 'unplayed' as const, title: TARGET_TITLES.unplayed, color: props.unplayedColor },
  { target: 'romajiPlayed' as const, title: TARGET_TITLES.romajiPlayed, color: props.romajiPlayedColor },
  { target: 'romajiUnplayed' as const, title: TARGET_TITLES.romajiUnplayed, color: props.romajiUnplayedColor },
  { target: 'translation' as const, title: TARGET_TITLES.translation, color: props.translationColor },
]);

const currentTargetColor = computed(() =>
  currentTarget.value ? readTargetColor(currentTarget.value) : '#ffffff',
);

/* ---------- 弹窗预览行的内联样式 ---------- */

const previewPlayedStyle = computed(() => ({
  color: props.playedColor,
  textShadow: `0 0 16px ${props.playedColor}66`,
}));

const previewCurrentStyle = computed(() =>
  splitHeadGradientStyle(props.playedColor, props.unplayedColor, '55', 12),
);

const previewUnplayedStyle = computed(() => ({
  color: props.unplayedColor,
}));

const previewRomajiPlayedStyle = computed(() => ({
  color: props.romajiPlayedColor,
  textShadow: `0 0 12px ${props.romajiPlayedColor}44`,
}));

const previewRomajiCurrentStyle = computed(() =>
  splitHeadGradientStyle(props.romajiPlayedColor, props.romajiUnplayedColor, '44', 10),
);

const previewRomajiUnplayedStyle = computed(() => ({
  color: props.romajiUnplayedColor,
}));

const previewTranslationStyle = computed(() => ({
  color: props.translationColor,
  textShadow: `0 0 12px ${props.translationColor}44`,
}));

/** 已播/未播各占一半的字级渐变。 */
function splitHeadGradientStyle(played: string, unplayed: string, glowAlpha: string, glowSpread: number) {
  return {
    backgroundImage: `linear-gradient(90deg, ${played} 0%, ${played} 56%, ${unplayed} 56%, ${unplayed} 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
    filter: `drop-shadow(0 0 ${glowSpread}px ${played}${glowAlpha})`,
  };
}

/* ---------- 面板交互 ---------- */

/** 点击槽位色块：以该色块为锚弹出主题色同款无极取色面板。 */
function launchPicker(target: DesktopCustomColorTarget, event: MouseEvent) {
  pickerAnchor.value = event.currentTarget as HTMLElement | null;
  currentTarget.value = target;
  emit('activate', target);
}

function readTargetColor(target: DesktopCustomColorTarget): string {
  switch (target) {
    case 'played':
      return props.playedColor;
    case 'unplayed':
      return props.unplayedColor;
    case 'romajiPlayed':
      return props.romajiPlayedColor;
    case 'romajiUnplayed':
      return props.romajiUnplayedColor;
    case 'translation':
      return props.translationColor;
  }
}

function onPickerInput(hex: string) {
  if (!currentTarget.value) return;
  emit('apply', currentTarget.value, hex);
}

/* ---------- 弹窗开关与全局监听 ---------- */

function closeModal() {
  emit('update:open', false);
  currentTarget.value = null;
}

/** 点遮罩：取色面板开着时先只收面板，避免误关整个配色弹窗。 */
function handleBackdropClick() {
  if (currentTarget.value) {
    currentTarget.value = null;
    return;
  }
  closeModal();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (currentTarget.value) {
    currentTarget.value = null;
    return;
  }
  closeModal();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <transition name="dlx-overlay-pop">
      <div v-if="open" class="dlx-overlay-backdrop" @click.self="handleBackdropClick">
        <div class="dlx-overlay" role="dialog" aria-modal="true" aria-label="自定义桌面歌词配色">
          <div class="dlx-overlay-rows">
            <div
              v-for="row in colorRows"
              :key="row.target"
              class="dlx-color-row"
              :class="{ 'dlx-color-row--active': currentTarget === row.target }"
            >
              <span>{{ row.title }}</span>
              <button
                type="button"
                class="dlx-color-chip"
                :aria-label="row.title"
                @click="launchPicker(row.target, $event)"
              >
                <span class="dlx-color-fill" :style="{ backgroundColor: row.color }"></span>
              </button>
            </div>
          </div>

          <div class="dlx-overlay-preview">
            <div class="dlx-overlay-preview-line">
              <span :style="previewPlayedStyle">I'm leaving&nbsp;</span>
              <span :style="previewCurrentStyle">home&nbsp;</span>
              <span :style="previewUnplayedStyle">for the coastline</span>
            </div>
            <div v-if="showRomaji" class="dlx-overlay-preview-sub">
              <span :style="previewRomajiPlayedStyle">aɪm ˈliːvɪŋ</span>
              <span :style="previewRomajiCurrentStyle">hoʊm</span>
              <span :style="previewRomajiUnplayedStyle">fɔːr ðə ˈkoʊstlaɪn</span>
            </div>
            <div
              v-if="showTranslation"
              class="dlx-overlay-preview-sub dlx-overlay-preview-translation"
              :style="previewTranslationStyle"
            >
              我要离开家去往海岸线
            </div>
          </div>

          <div class="dlx-overlay-actions">
            <button type="button" class="dlx-pill-btn dlx-overlay-done" @click="closeModal">完成</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>

  <Teleport to="body">
    <CustomColorPicker
      :model-value="currentTargetColor"
      :is-open="currentTarget !== null"
      :trigger-ref="pickerAnchor"
      :z-index="160"
      @update:model-value="onPickerInput"
      @close="currentTarget = null"
    />
  </Teleport>
</template>

<style scoped>
.dlx-overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.dlx-overlay {
  width: min(720px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  padding: 28px;
  box-shadow: 0 26px 70px rgba(15, 23, 42, 0.22);
}

:global(.dark) .dlx-overlay {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.92);
}

.dlx-overlay-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dlx-color-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-width: 0;
  min-height: 62px;
  padding: 10px 14px 10px 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  color: rgb(31 41 55);
  font-size: 15px;
  font-weight: 700;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.dlx-color-row > span:first-child {
  min-width: 0;
  white-space: normal;
  word-break: keep-all;
}

:global(.dark) .dlx-color-row {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
}

.dlx-color-row:hover {
  border-color: rgba(236, 65, 65, 0.38);
  background: rgba(236, 65, 65, 0.06);
}

.dlx-color-row--active {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(236, 65, 65, 0.08);
}

.dlx-color-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.dlx-color-fill {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 14px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 4px 12px rgba(15, 23, 42, 0.14);
}

.dlx-overlay-preview {
  margin-top: 18px;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.12), transparent 42%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(3, 7, 18, 0.96));
  padding: 30px;
  text-align: center;
}

.dlx-overlay-preview-line {
  max-width: 100%;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.18;
  overflow-wrap: anywhere;
}

.dlx-overlay-preview-sub {
  font-size: 15px;
  line-height: 1.4;
  opacity: 0.86;
}

.dlx-overlay-preview-translation {
  margin-top: -8px;
  font-size: 16px;
}

.dlx-overlay-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.dlx-pill-btn {
  flex-shrink: 0;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  padding: 8px 14px;
  color: #ec4141;
  font-size: 12px;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.dlx-overlay-done {
  min-width: 108px;
  min-height: 44px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
}

.dlx-overlay-pop-enter-active,
.dlx-overlay-pop-leave-active {
  transition: opacity 180ms ease;
}

.dlx-overlay-pop-enter-active .dlx-overlay,
.dlx-overlay-pop-leave-active .dlx-overlay {
  transition: transform 180ms ease, opacity 180ms ease;
}

.dlx-overlay-pop-enter-from,
.dlx-overlay-pop-leave-to {
  opacity: 0;
}

.dlx-overlay-pop-enter-from .dlx-overlay,
.dlx-overlay-pop-leave-to .dlx-overlay {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 767px) {
  .dlx-overlay {
    padding: 18px;
  }

  .dlx-color-row {
    min-height: 58px;
    padding: 9px 12px 9px 14px;
  }

  .dlx-color-chip {
    width: 42px;
    height: 42px;
  }

  .dlx-overlay-preview-line {
    font-size: 26px;
  }
}
</style>
