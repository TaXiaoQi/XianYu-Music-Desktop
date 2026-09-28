<script setup lang="ts">
import { Check, ChevronDown, Minus, Plus, RotateCcw } from 'lucide-vue-next';
import { ref } from 'vue';

import type { LyricsColorScheme } from '../../composables/lyrics';
import {
  LYRICS_SYNC_OFFSET_MAX_MS,
  LYRICS_SYNC_OFFSET_MIN_MS,
  LYRICS_SYNC_OFFSET_STEP_MS,
} from '../../features/settings/lyricsSyncOffset';
import RangeSlider from '../common/RangeSlider.vue';
import DesktopLyricsAlignmentCell from './desktopLyrics/DesktopLyricsAlignmentCell.vue';
import DesktopLyricsColorOverlay from './desktopLyrics/DesktopLyricsColorOverlay.vue';
import DesktopLyricsFontPicker from './desktopLyrics/DesktopLyricsFontPicker.vue';
import DesktopLyricsShadowSwatches from './desktopLyrics/DesktopLyricsShadowSwatches.vue';
import DesktopLyricsSliderCell from './desktopLyrics/DesktopLyricsSliderCell.vue';
import DesktopLyricsToggleCell from './desktopLyrics/DesktopLyricsToggleCell.vue';
import DesktopLyricsWindowSection from './desktopLyrics/DesktopLyricsWindowSection.vue';
import { useColorSchemeMenu } from './desktopLyrics/useColorSchemeMenu';
import {
  SCHEME_CHOICES,
  useDesktopLyricsDraft,
  type DesktopCustomColorTarget,
} from './desktopLyrics/useDesktopLyricsDraft';
import { useLyricsSyncOffset } from './desktopLyrics/useLyricsSyncOffset';
import SettingHint from './SettingHint.vue';

const {
  draft, lyricsSettings, desktopLyricsSettings, fontChoices, selectedColorScheme, isCustomShadowColor,
  previewTheme, previewPlayerVars, previewAlignClass, previewWidgetVars,
  wordPlayed, wordActive, wordUnplayed, romajiPlayed, romajiActive, romajiUnplayed,
  restoreDefaults, applyShadowStrength, applyShadowColor, applyAlignment, applyFontPreset, applyScheme, applyCustomColor,
} = useDesktopLyricsDraft();

const {
  panelOpen: syncPanelOpen, offsetMs: syncOffsetMs, offsetText: syncOffsetText,
  adjust: adjustLyricsSyncOffset, reset: resetSyncOffset, onFieldChange: onSyncOffsetFieldChange,
} = useLyricsSyncOffset();

const {
  fieldRef: schemeFieldRef, triggerRef: schemeTriggerRef, menuRef: schemeMenuRef,
  open: schemeMenuOpen, style: schemeMenuStyle, toggle: toggleColorSchemeMenu, close: closeSchemeMenu,
} = useColorSchemeMenu();

const colorOverlayOpen = ref(false);

function selectColorSchemeFromMenu(scheme: LyricsColorScheme) {
  closeSchemeMenu();
  if (scheme === 'custom') {
    applyScheme('custom');
    colorOverlayOpen.value = true;
    return;
  }
  applyScheme(scheme);
}

function markSchemeCustom() {
  applyScheme('custom');
}

function onOverlayApply(target: DesktopCustomColorTarget, hex: string) {
  applyCustomColor(target, hex);
}
</script>

<template>
  <div class="page-root">
    <DesktopLyricsWindowSection />

    <section class="sec-block">
      <h2 class="sec-title"><span class="sec-tick"></span>歌词同步</h2>
      <div class="sec-card">
        <button type="button" class="sy-head" @click="syncPanelOpen = !syncPanelOpen"><div><div class="sy-head-label">同步偏移</div></div>
          <div class="sy-head-side">
            <SettingHint text="正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。" :focusable="false" />
            <div class="sy-badge">{{ syncOffsetText }}</div>
            <ChevronDown :size="16" class="sy-chevron" :class="syncPanelOpen ? 'sy-chevron--open' : ''" /></div></button>

        <transition name="sy-pop">
          <div v-if="syncPanelOpen" class="sy-expand"><div class="sy-expand-body"><div class="sy-panel-row">
            <div class="sy-stepper">
              <button type="button" class="sy-step-btn" :disabled="syncOffsetMs <= LYRICS_SYNC_OFFSET_MIN_MS" aria-label="歌词偏移减少 5 毫秒" @click="adjustLyricsSyncOffset(-LYRICS_SYNC_OFFSET_STEP_MS)"><Minus :size="16" /></button>
              <RangeSlider v-model="syncOffsetMs" :min="LYRICS_SYNC_OFFSET_MIN_MS" :max="LYRICS_SYNC_OFFSET_MAX_MS" :step="LYRICS_SYNC_OFFSET_STEP_MS" variant="warm" class="min-w-0 flex-1" />
              <button type="button" class="sy-step-btn" :disabled="syncOffsetMs >= LYRICS_SYNC_OFFSET_MAX_MS" aria-label="歌词偏移增加 5 毫秒" @click="adjustLyricsSyncOffset(LYRICS_SYNC_OFFSET_STEP_MS)"><Plus :size="16" /></button></div>
            <div class="sy-fieldrow">
              <input :value="syncOffsetMs" type="number" :min="LYRICS_SYNC_OFFSET_MIN_MS" :max="LYRICS_SYNC_OFFSET_MAX_MS" :step="LYRICS_SYNC_OFFSET_STEP_MS" class="sy-field" @change="onSyncOffsetFieldChange" />
              <button type="button" class="sy-reset" @click="resetSyncOffset">重置</button></div>
          </div></div></div>
        </transition></div></section>

    <section class="sec-block">
      <h2 class="sec-title"><span class="sec-tick"></span>排版与字体</h2>

      <div class="pv-wrap">
        <div class="pv-head">
          <div class="pv-head-title">效果实时预览</div>
          <button type="button" class="pv-btn pv-btn--default" @click="restoreDefaults"><RotateCcw :size="14" />恢复默认</button></div>

        <div class="pv-card" :class="`pv-card--${previewTheme}`" :style="previewWidgetVars">
          <div class="pv-body" :style="previewPlayerVars" :class="previewAlignClass"><div class="pv-block">
            <div class="pv-line pv-line--active"><div class="pv-main">
              <span class="pv-word" :class="{ 'pv-word--romaji': lyricsSettings.showRomaji }"><span class="pv-word-main" :style="wordPlayed">I'm leaving&nbsp;</span><span v-if="lyricsSettings.showRomaji" class="pv-word-romaji" :style="romajiPlayed">aɪm ˈliːvɪŋ</span></span>
              <span class="pv-word" :class="{ 'pv-word--romaji': lyricsSettings.showRomaji }"><span class="pv-word-main" :style="wordActive">home&nbsp;</span><span v-if="lyricsSettings.showRomaji" class="pv-word-romaji" :style="romajiActive">hoʊm</span></span>
              <span class="pv-word" :class="{ 'pv-word--romaji': lyricsSettings.showRomaji }"><span class="pv-word-main" :style="wordUnplayed">for the coastline</span><span v-if="lyricsSettings.showRomaji" class="pv-word-romaji" :style="romajiUnplayed">fɔːr ðə ˈkoʊstlaɪn</span></span></div>
              <div v-if="lyricsSettings.showTranslation" class="pv-sub">我要离开家去往海岸线</div></div>

            <div v-if="desktopLyricsSettings.showDoubleLine" class="pv-line pv-line--inactive pv-line--second"><div class="pv-main pv-main--inactive">
              <span class="pv-word" :class="{ 'pv-word--romaji': lyricsSettings.showRomaji }"><span class="pv-word-main" :style="wordUnplayed">どうせ私なんかと</span><span v-if="lyricsSettings.showRomaji" class="pv-word-romaji" :style="romajiUnplayed">do u se wa ta shi na n ka to</span></span></div>
              <div v-if="lyricsSettings.showTranslation" class="pv-sub">反正像我这样的人</div></div></div></div></div></div>

        <div class="cp-panel">
        <div class="cp-grid">
          <DesktopLyricsSliderCell v-model="draft.playerFontScale" :min="0.5" :max="3" :step="0.05" aria-label="字号">字号</DesktopLyricsSliderCell>
          <DesktopLyricsSliderCell v-model="draft.subFontScale" :min="0.5" :max="3" :step="0.05" aria-label="副词字号">副词字号</DesktopLyricsSliderCell>
        </div>
        <div class="cp-grid">
          <DesktopLyricsSliderCell v-model="draft.playerLineGap" :min="0.5" :max="3" :step="0.05" aria-label="行距">行距</DesktopLyricsSliderCell>
          <DesktopLyricsSliderCell v-model="draft.textOpacity" :min="0.1" :max="1" :step="0.05" aria-label="不透明度">不透明度</DesktopLyricsSliderCell>
        </div>
        <div class="cp-grid">
          <DesktopLyricsSliderCell :model-value="draft.firstLineTextShadowStrength" :min="0" :max="100" :step="5" :percent="false" aria-label="描边阴影" @update:model-value="applyShadowStrength">描边阴影</DesktopLyricsSliderCell>
          <DesktopLyricsShadowSwatches :value="draft.textShadowColor" :custom-active="isCustomShadowColor" @select="applyShadowColor" />
        </div>
        <div class="cp-grid">
          <DesktopLyricsAlignmentCell :value="draft.playerAlignment" @select="applyAlignment" />
          <DesktopLyricsToggleCell :checked="desktopLyricsSettings.showDoubleLine" @toggle="desktopLyricsSettings.showDoubleLine = $event">双行显示</DesktopLyricsToggleCell>
        </div>
        <div class="cp-grid">
          <DesktopLyricsToggleCell :checked="lyricsSettings.showTranslation" @toggle="lyricsSettings.showTranslation = $event">显示翻译</DesktopLyricsToggleCell>
          <DesktopLyricsToggleCell :checked="lyricsSettings.showRomaji" @toggle="lyricsSettings.showRomaji = $event">显示罗马音</DesktopLyricsToggleCell>
        </div>
        <div class="cp-grid">
          <div class="cp-cell">
            <div class="cp-cell-label">字体方案</div>
            <DesktopLyricsFontPicker :options="fontChoices" :model-value="draft.playerFontPreset" @update:model-value="applyFontPreset" /></div>

          <div class="cp-cell">
            <div class="cp-cell-label">配色方案</div>
            <div ref="schemeFieldRef" class="scm-shell">
              <button ref="schemeTriggerRef" type="button" class="scm-trigger" :class="schemeMenuOpen ? 'scm-trigger--open' : ''" @click="toggleColorSchemeMenu">
                <span class="scm-current"><span class="scm-dot" :class="{ 'scm-dot--custom': selectedColorScheme.value === 'custom', 'scm-dot--auto': selectedColorScheme.value === 'auto' }" :style="selectedColorScheme.value !== 'custom' && selectedColorScheme.value !== 'auto' ? { backgroundColor: selectedColorScheme.color } : {}"></span><span class="scm-current-label">{{ selectedColorScheme.label }}</span></span>
                <ChevronDown :size="14" class="scm-chevron" /></button>

              <Teleport to="body"><transition name="scm-pop">
                  <div v-if="schemeMenuOpen" ref="schemeMenuRef" class="scm-menu" :style="schemeMenuStyle" @click.stop @mousedown.stop><div class="scm-menu-head"><span>配色方案</span><span>{{ SCHEME_CHOICES.length }} 项</span></div>
                    <div class="scm-menu-list custom-scrollbar">
                      <button v-for="option in SCHEME_CHOICES" :key="option.value" type="button" class="scm-item" :class="draft.colorScheme === option.value ? 'scm-item--current' : ''" @click="selectColorSchemeFromMenu(option.value)">
                        <span class="scm-dot shrink-0" :class="{ 'scm-dot--custom': option.value === 'custom', 'scm-dot--auto': option.value === 'auto' }" :style="option.value !== 'custom' && option.value !== 'auto' ? { backgroundColor: option.color } : {}"></span>
                        <span class="scm-item-text"><span class="scm-item-label">{{ option.label }}</span><span class="scm-item-hint">{{ option.hint }}</span></span>
                        <Check v-if="draft.colorScheme === option.value" :size="16" class="scm-check" /></button>
                    </div></div></transition></Teleport></div></div>
        </div>

        <div class="cp-grid">
          <DesktopLyricsToggleCell :checked="desktopLyricsSettings.enableWordEffect" @toggle="desktopLyricsSettings.enableWordEffect = $event">逐字效果</DesktopLyricsToggleCell>
          <DesktopLyricsToggleCell :checked="desktopLyricsSettings.enableTextOutline" @toggle="desktopLyricsSettings.enableTextOutline = $event">歌词描边</DesktopLyricsToggleCell></div>

      </div></section>

    <DesktopLyricsColorOverlay v-model:open="colorOverlayOpen" :show-romaji="lyricsSettings.showRomaji" :show-translation="lyricsSettings.showTranslation" :played-color="draft.customPlayedColor" :unplayed-color="draft.customUnplayedColor" :romaji-played-color="draft.customRomajiPlayedColor" :romaji-unplayed-color="draft.customRomajiUnplayedColor" :translation-color="draft.customTranslationColor" @activate="markSchemeCustom" @apply="onOverlayApply" /></div>
</template>

<style scoped>
.page-root { width: 100%; display: flex; flex-direction: column; gap: 32px; animation: page-enter 300ms ease both; }
@keyframes page-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.sec-block { display: flex; flex-direction: column; gap: 12px; }
.sec-title { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; line-height: 1.25rem; font-weight: 700; color: #1f2937; }
:global(.dark) .sec-title { color: #e5e7eb; }
.sec-tick { height: 16px; width: 4px; border-radius: 9999px; background: #ec4141; }
.sec-card { display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(229, 231, 235, 0.4); }
:global(.dark) .sec-card { background: rgba(0, 0, 0, 0.1); border-color: rgba(31, 41, 55, 0.4); }

.sy-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; text-align: left; transition: background-color 160ms ease; }
.sy-head:hover { background: rgba(255, 255, 255, 0.4); }
:global(.dark) .sy-head:hover { background: rgba(255, 255, 255, 0.1); }
.sy-head-label { font-size: 0.875rem; line-height: 1.25rem; font-weight: 500; color: #1f2937; }
:global(.dark) .sy-head-label { color: #e5e7eb; }
.sy-head-side { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.sy-badge { border-radius: 9999px; background: rgba(236, 65, 65, 0.1); padding: 4px 12px; font-size: 0.75rem; line-height: 1rem; font-weight: 500; color: #ec4141; font-variant-numeric: tabular-nums; }
.sy-chevron { color: #9ca3af; transition: transform 200ms ease; }
:global(.dark) .sy-chevron { color: rgba(255, 255, 255, 0.45); }
.sy-chevron--open { transform: rotate(180deg); color: #ec4141; }

.sy-expand { overflow: hidden; }
.sy-expand-body { padding: 16px; }
.sy-panel-row { display: flex; flex-direction: column; gap: 16px; }
@media (min-width: 768px) { .sy-panel-row { flex-direction: row; align-items: center; } }
.sy-stepper { display: flex; min-width: 240px; flex: 1; align-items: center; gap: 8px; }
.sy-step-btn { display: grid; height: 32px; width: 32px; flex-shrink: 0; place-items: center; border-radius: 9999px; border: 1px solid rgba(229, 231, 235, 0.4); background: rgba(255, 255, 255, 0.2); color: #4b5563; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); }
.sy-step-btn:hover { border-color: #ec4141; background: rgba(255, 255, 255, 0.3); color: #ec4141; }
.sy-step-btn:disabled { cursor: not-allowed; opacity: 0.35; }
:global(.dark) .sy-step-btn { border-color: rgba(31, 41, 55, 0.4); background: rgba(0, 0, 0, 0.1); color: #d1d5db; }
.sy-fieldrow { display: flex; align-items: center; gap: 12px; }
.sy-field { height: 32px; width: 112px; border-radius: 8px; border: 1px solid rgba(0, 0, 0, 0.1); background: rgba(255, 255, 255, 0.45); padding: 0 12px; font-size: 0.75rem; line-height: 1rem; color: #1f2937; outline: none; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); }
.sy-field::placeholder { color: #9ca3af; }
.sy-field:focus { border-color: rgba(236, 65, 65, 0.5); background: rgba(255, 255, 255, 0.7); box-shadow: 0 0 0 2px rgba(236, 65, 65, 0.1); }
:global(.dark) .sy-field { border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.05); color: #f3f4f6; }
:global(.dark) .sy-field::placeholder { color: rgba(255, 255, 255, 0.35); }
:global(.dark) .sy-field:focus { background: rgba(255, 255, 255, 0.1); }
.sy-reset { border-radius: 12px; border: 1px solid #e5e7eb; background: #ffffff; padding: 8px 12px; font-size: 0.875rem; line-height: 1.25rem; color: #374151; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); }
.sy-reset:hover { border-color: #ec4141; color: #ec4141; }
:global(.dark) .sy-reset { border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.05); color: #e5e7eb; }

.sy-pop-enter-active, .sy-pop-leave-active { transition: opacity 200ms ease, transform 220ms ease, max-height 220ms ease; transform-origin: top center; overflow: hidden; }
.sy-pop-enter-from, .sy-pop-leave-to { opacity: 0; transform: translateY(-10px) scaleY(0.96); max-height: 0; }
.sy-pop-enter-to, .sy-pop-leave-from { opacity: 1; transform: translateY(0) scaleY(1); max-height: 260px; }

.pv-wrap { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; padding: 4px; user-select: none; }
.pv-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pv-head-title { font-size: 0.75rem; line-height: 1rem; font-weight: 600; color: #6b7280; }
:global(.dark) .pv-head-title { color: #9ca3af; }
.pv-btn { display: flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 999px; transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; }
.pv-btn--default { border: 1px solid rgba(229, 231, 235, 0.4); background: rgba(255, 255, 255, 0.2); color: rgb(75 85 99); }
.pv-btn--default:hover { border-color: rgba(236, 65, 65, 0.35); background: rgba(255, 255, 255, 0.3); color: #ec4141; }
:global(.dark) .pv-btn--default { border-color: rgba(31, 41, 55, 0.4); background: rgba(0, 0, 0, 0.1); color: rgba(255, 255, 255, 0.7); }
:global(.dark) .pv-btn--default:hover { background: rgba(255, 255, 255, 0.1); }

.pv-card { position: relative; height: 220px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 20px; padding: 28px; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.16); overflow: hidden; box-sizing: border-box; transition: background 250ms ease, border-color 250ms ease; }
.pv-card--dark { border-color: rgba(255, 255, 255, 0.08); background: radial-gradient(circle at top left, rgba(71, 85, 105, 0.15), transparent 45%), radial-gradient(circle at bottom right, rgba(15, 23, 42, 0.25), transparent 45%), linear-gradient(135deg, #1e293b, #0f172a); }
:global(.dark) .pv-card--dark { border-color: rgba(255, 255, 255, 0.06); background: radial-gradient(circle at top left, rgba(71, 85, 105, 0.22), transparent 45%), radial-gradient(circle at bottom right, rgba(0, 0, 0, 0.4), transparent 45%), linear-gradient(135deg, #0f172a, #020617); }
.pv-card--light { border-color: rgba(15, 23, 42, 0.08); background: radial-gradient(circle at top left, rgba(236, 65, 65, 0.06), transparent 45%), radial-gradient(circle at bottom right, rgba(148, 163, 184, 0.15), transparent 45%), linear-gradient(135deg, #f8fafc, #e2e8f0); }
:global(.dark) .pv-card--light { border-color: rgba(255, 255, 255, 0.08); background: radial-gradient(circle at top left, rgba(236, 65, 65, 0.08), transparent 45%), radial-gradient(circle at bottom right, rgba(255, 255, 255, 0.06), transparent 45%), linear-gradient(135deg, #e2e8f0, #cbd5e1); }

.pv-body { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.pv-block { width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(0.22rem * var(--pv-line-gap, 1)); text-align: var(--pv-text-align, center); font-family: var(--pv-font-family, system-ui, sans-serif); -webkit-text-stroke: var(--desktop-text-outline-width, 0px) var(--desktop-text-outline-color, #000000); paint-order: stroke fill; transition: -webkit-text-stroke-width 180ms ease; }
.pv-line { width: 100%; display: flex; flex-direction: column; gap: calc(0.12rem * var(--pv-line-gap, 1)); }
.pv-line--inactive { opacity: 0.74; transform: translate3d(0, 2px, 0) scale(0.992); filter: saturate(0.94); }
.pv-main { width: 100%; font-size: calc(32px * var(--pv-font-scale, 1)); font-weight: 700; line-height: 1.18; letter-spacing: 0.01em; color: var(--desktop-text-primary); overflow-wrap: anywhere; word-break: break-word; filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.55))) drop-shadow(0 0 var(--desktop-first-line-text-shadow-blur, 0px) rgb(var(--desktop-text-shadow-color, 0 0 0) / var(--desktop-first-line-text-shadow-alpha, 0))) drop-shadow(0 0 24px color-mix(in srgb, var(--desktop-accent-a) 14%, transparent)); transition: filter 200ms ease; }
.pv-main--inactive { font-size: calc(24px * var(--pv-font-scale, 1)); font-weight: 650; color: color-mix(in srgb, var(--desktop-text-primary) 76%, transparent); filter: drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48))) drop-shadow(0 0 var(--desktop-second-line-text-shadow-blur, 0px) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 18px color-mix(in srgb, var(--desktop-accent-c) 10%, transparent)); }
.pv-word { display: inline-block; white-space: pre-wrap; }
.pv-word--romaji { display: inline-flex; flex-direction: column; align-items: center; justify-content: flex-end; text-align: center; vertical-align: bottom; white-space: nowrap; }
.pv-word-main { display: inline-block; white-space: pre-wrap; }
.pv-word-romaji { display: block; margin-top: 0.08em; color: var(--desktop-romaji-unplayed-color); font-size: 0.46em; font-weight: 650; line-height: 1.05; letter-spacing: 0; white-space: pre; filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48))) drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent)); }
.pv-sub { width: 100%; font-size: calc(18px * var(--pv-sub-scale, var(--pv-font-scale, 1))); line-height: 1.36; letter-spacing: 0.03em; overflow-wrap: anywhere; word-break: break-word; color: var(--desktop-translation-color); filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48))) drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.82))) drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent)); }
.pv-line--second .pv-sub { filter: drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48))) drop-shadow(0 0 calc(var(--desktop-second-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.82))) drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent)); }

.pv-align-l { --pv-text-align: left; }
.pv-align-c { --pv-text-align: center; }
.pv-align-r { --pv-text-align: right; }

.cp-panel { display: flex; flex-direction: column; gap: 10px; border-radius: 16px; overflow: hidden; }
.cp-grid { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 12px; width: 100%; }
.cp-cell { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; min-height: 48px; padding: 7px 10px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(229, 231, 235, 0.4); transition: all 180ms ease; }
:global(.dark) .cp-cell { background: rgba(0, 0, 0, 0.1); border-color: rgba(31, 41, 55, 0.4); }
.cp-cell:hover { background: rgba(255, 255, 255, 0.3); border-color: rgba(236, 65, 65, 0.35); }
:global(.dark) .cp-cell:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(236, 65, 65, 0.35); }
.cp-cell-label { font-size: 13px; font-weight: 700; color: rgb(55 65 81); user-select: none; white-space: nowrap; flex-shrink: 0; }
:global(.dark) .cp-cell-label { color: rgba(255, 255, 255, 0.68); }

.scm-shell { position: relative; flex: 1; min-width: 0; }
.scm-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 48px; padding: 7px 10px; border: 1px solid var(--scm-select-trigger-border); border-radius: 10px; background: var(--scm-select-trigger-bg); box-shadow: var(--scm-select-trigger-shadow); transition: border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease, transform 180ms ease; }
.scm-trigger:hover, .scm-trigger--open { border-color: var(--scm-select-trigger-hot-border); box-shadow: var(--scm-select-trigger-hot-shadow); }
.scm-trigger--open { background: var(--scm-select-trigger-hot-bg); }
.scm-current { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: flex-end; gap: 8px; }
.scm-current-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: #1f2937; }
:global(.dark) .scm-current-label { color: #f3f4f6; }
.scm-chevron { margin-left: 8px; flex-shrink: 0; color: #9ca3af; }
.scm-dot { display: inline-block; width: 14px; height: 14px; border: 1.5px solid rgba(255, 255, 255, 0.88); border-radius: 999px; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.08); }
.scm-dot--custom { background: linear-gradient(135deg, #EC4141 0%, #60a5fa 50%, #34d399 100%) !important; }
.scm-dot--auto { background: linear-gradient(135deg, #8ec5ff 0%, #ff8cab 33%, #88f3c2 66%, #ffe07d 100%) !important; }
:global(.dark) .scm-dot { border-color: rgba(0, 0, 0, 0.38); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24); }

.scm-menu { overflow: hidden; border: 1px solid var(--scm-select-menu-border); border-radius: 20px; background: var(--scm-select-menu-bg); box-shadow: var(--scm-select-menu-shadow); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%); z-index: 120; }
.scm-menu-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--scm-select-menu-head-border); color: var(--scm-select-menu-head-color); font-size: 12px; font-weight: 700; letter-spacing: 0.03em; }
.scm-menu-list { max-height: 320px; overflow-y: auto; padding: 8px; }
.scm-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 1px solid transparent; border-radius: 16px; text-align: left; color: var(--scm-select-item-color); transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease, transform 160ms ease; }
.scm-item:hover { border-color: var(--scm-select-item-hover-border); background: var(--scm-select-item-hover-bg); color: var(--scm-select-item-hover-color); }
.scm-item--current { border-color: var(--scm-select-item-hot-border); background: var(--scm-select-item-hot-bg); color: var(--scm-select-item-hot-color); }
.scm-item-text { min-width: 0; flex: 1; text-align: left; }
.scm-item-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.875rem; line-height: 1.25rem; font-weight: 600; }
.scm-item-hint { margin-top: 2px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; line-height: 1rem; opacity: 0.55; }
.scm-check { flex-shrink: 0; color: #ec4141; }

.scm-pop-enter-active, .scm-pop-leave-active { transition: opacity 180ms ease, transform 200ms ease; transform-origin: top center; }
.scm-pop-enter-from, .scm-pop-leave-to { opacity: 0; transform: translateY(-8px) scale(0.98); }
</style>

<style>
:root, :host {
  --scm-select-trigger-bg: rgba(255, 255, 255, 0.2);
  --scm-select-trigger-border: rgba(229, 231, 235, 0.4);
  --scm-select-trigger-shadow: none;
  --scm-select-trigger-hot-bg: rgba(255, 255, 255, 0.3);
  --scm-select-trigger-hot-border: rgba(236, 65, 65, 0.35);
  --scm-select-trigger-hot-shadow: none;
  --scm-select-menu-bg: rgba(255, 255, 255, 0.88);
  --scm-select-menu-border: rgba(255, 255, 255, 0.5);
  --scm-select-menu-shadow: 0 24px 60px rgba(15, 23, 42, 0.16), 0 10px 24px rgba(15, 23, 42, 0.08);
  --scm-select-menu-head-color: rgba(71, 85, 105, 0.92);
  --scm-select-menu-head-border: rgba(148, 163, 184, 0.12);
  --scm-select-item-color: rgb(55 65 81);
  --scm-select-item-hover-bg: rgba(236, 65, 65, 0.06);
  --scm-select-item-hover-border: rgba(236, 65, 65, 0.16);
  --scm-select-item-hover-color: rgb(17 24 39);
  --scm-select-item-hot-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.12), rgba(236, 65, 65, 0.06));
  --scm-select-item-hot-border: rgba(236, 65, 65, 0.2);
  --scm-select-item-hot-color: #ec4141;
}

html[class~="dark"] {
  --scm-select-trigger-bg: rgba(0, 0, 0, 0.1);
  --scm-select-trigger-border: rgba(31, 41, 55, 0.4);
  --scm-select-trigger-shadow: none;
  --scm-select-trigger-hot-bg: rgba(255, 255, 255, 0.1);
  --scm-select-trigger-hot-border: rgba(236, 65, 65, 0.35);
  --scm-select-trigger-hot-shadow: none;
  --scm-select-menu-bg: rgba(43, 43, 43, 0.88);
  --scm-select-menu-border: rgba(255, 255, 255, 0.08);
  --scm-select-menu-shadow: 0 24px 60px rgba(0, 0, 0, 0.34), 0 10px 24px rgba(0, 0, 0, 0.24);
  --scm-select-menu-head-color: rgba(255, 255, 255, 0.58);
  --scm-select-menu-head-border: rgba(255, 255, 255, 0.06);
  --scm-select-item-color: rgba(255, 255, 255, 0.84);
  --scm-select-item-hover-bg: rgba(236, 65, 65, 0.1);
  --scm-select-item-hover-border: rgba(236, 65, 65, 0.22);
  --scm-select-item-hover-color: rgba(255, 255, 255, 0.98);
  --scm-select-item-hot-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.08));
  --scm-select-item-hot-border: rgba(236, 65, 65, 0.28);
  --scm-select-item-hot-color: #ff9a9a;
}
</style>
