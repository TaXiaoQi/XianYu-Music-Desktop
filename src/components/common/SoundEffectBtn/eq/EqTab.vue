<script setup lang="ts">
/*
 * 均衡器标签页：内置/衍生/自定义预设、垂直频段推子、
 * 动态均衡与 Bass 重低音增强。自 EqualizerPanel.vue 原样搬出。
 */
import RangeSlider from '../../RangeSlider.vue';
import { useSoundEffectStore, eqPresetNames, advancedEqPresetNames } from '../../../../features/playback/soundEffectStore';
import { useEqPresets } from '../../../../composables/soundEffect/useEqPresets';
import { useEqBands } from '../../../../composables/soundEffect/useEqBands';

const store = useSoundEffectStore();
const { handleApplyPreset, handleResetEq, customPresetName, handleSaveCustomPreset } = useEqPresets();
const { EQ_BANDS, formatBandGain } = useEqBands();
</script>
<template>
  <!-- ==================== 均衡器标签页（专业垂直推子） ==================== -->
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        均衡器
      </h3>
      <button class="fx-reset-btn" @click="handleResetEq">重置</button>
    </div>
    <div class="space-y-2">
      <div class="text-[12px] font-semibold text-gray-600 dark:text-gray-300">内置预设</div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="preset in eqPresetNames" :key="preset" class="fx-preset-btn" @click="handleApplyPreset(preset)">{{ preset }}</button>
      </div>
    </div>
    <div class="eq-faders rounded-xl border border-gray-200/70 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5">
      <div v-for="band in EQ_BANDS" :key="band.key" class="eq-fader-col">
        <div
          class="eq-fader-value"
          :class="{ positive: (store.eqBands[band.key] || 0) > 0, negative: (store.eqBands[band.key] || 0) < 0 }"
        >
          {{ formatBandGain(store.eqBands[band.key] || 0) }}<span class="eq-fader-unit">dB</span>
        </div>
        <div class="eq-fader-track">
          <span class="eq-fader-scale top">+12</span>
          <span class="eq-fader-scale mid">0</span>
          <span class="eq-fader-scale bot">−12</span>
          <RangeSlider
            variant="fader"
            :min="-12"
            :max="12"
            :step="1"
            v-model="store.eqBands[band.key]"
          />
        </div>
        <div class="eq-fader-freq">{{ band.freq }}<span class="eq-fader-freq-unit">Hz</span></div>
      </div>
    </div>
    <div class="space-y-2">
      <div class="text-[12px] font-semibold text-gray-600 dark:text-gray-300">均衡衍生预设</div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="preset in advancedEqPresetNames" :key="preset" class="fx-preset-btn fx-preset-advanced" @click="handleApplyPreset(preset)">{{ preset }}</button>
      </div>
    </div>
    <div class="space-y-2">
      <div class="text-[12px] font-semibold text-gray-600 dark:text-gray-300">自定义预设</div>
      <div class="flex items-center gap-2">
        <input type="text" class="fx-text-input" v-model="customPresetName" placeholder="预设名称" @keydown.enter="handleSaveCustomPreset">
        <button class="fx-preset-btn" @click="handleSaveCustomPreset">保存</button>
      </div>
      <div v-if="store.customEqPresets.length > 0" class="flex flex-wrap gap-1.5">
        <button v-for="p in store.customEqPresets" :key="p.name" class="fx-preset-btn fx-preset-advanced" @click="store.loadCustomEqPreset(p.name)">{{ p.name }}</button>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
        <div class="flex items-center justify-between">
          <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">动态均衡</div>
          <button class="fx-toggle" :class="{ on: store.dynamicEqEnabled }" @click="store.dynamicEqEnabled = !store.dynamicEqEnabled">
            <span class="fx-toggle-knob"></span>
          </button>
        </div>
        <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">自动压制刺耳高频（5kHz以上压缩），补强低频（80Hz增强+3dB）</div>
      </section>
      <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
        <div class="flex items-center justify-between">
          <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Bass 重低音增强</div>
          <button class="fx-toggle" :class="{ on: store.bassBoostEnabled }" @click="store.bassBoostEnabled = !store.bassBoostEnabled">
            <span class="fx-toggle-knob"></span>
          </button>
        </div>
        <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">动态跟随鼓点放大低频，DJ曲目刚需</div>
        <div v-show="store.bassBoostEnabled" class="mt-2 space-y-1.5">
          <div class="flex items-center gap-2">
            <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">增益量</span>
            <RangeSlider variant="brand" interactive min="0" max="15" v-model="store.bassBoostGain" />
            <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.bassBoostGain }}dB</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
/* ===== Toggle 开关（红色开启态） =====
   与 SettingsTheme.vue 的 toggle 视觉一致 */
.fx-toggle {
  position: relative;
  display: inline-flex;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.15);
  transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  border: none;
  padding: 0;
}
:global(html.dark) .fx-toggle {
  background: rgba(255, 255, 255, 0.2);
}
.fx-toggle.on {
  background: #ec4141;
}
.fx-toggle-knob {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fx-toggle.on .fx-toggle-knob {
  transform: translateX(20px);
}
/* ===== 预设按钮 ===== */
.fx-preset-btn {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 14px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.75);
  border-radius: 6px;
  color: #374151;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
:global(html.dark) .fx-preset-btn {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.1);
  color: #e5e7eb;
}
.fx-preset-btn:hover {
  border-color: rgba(236, 65, 65, 0.5);
  color: #ec4141;
  background: #fff;
  transform: translateY(-1px);
}
:global(html.dark) .fx-preset-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.fx-preset-btn:active {
  transform: translateY(0) scale(0.96);
}
.fx-preset-advanced {
  font-weight: 600;
  border-color: rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.1);
  color: #d13b3b;
}
:global(html.dark) .fx-preset-advanced {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}
/* ===== 重置按钮 ===== */
.fx-reset-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 14px;
  border: 1px solid rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.08);
  border-radius: 6px;
  color: #d13b3b;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
:global(html.dark) .fx-reset-btn {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(236, 65, 65, 0.15);
  color: #ff8b8b;
}
.fx-reset-btn:hover {
  border-color: #ec4141;
  background: rgba(236, 65, 65, 0.16);
  color: #c62f2f;
}
:global(html.dark) .fx-reset-btn:hover {
  background: rgba(236, 65, 65, 0.25);
  color: #ffa3a3;
}
.fx-reset-btn:active {
  transform: scale(0.97);
}
/* ===== 文本输入框 ===== */
.fx-text-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  color: #1f2937;
  background: rgba(255, 255, 255, 0.6);
  transition: border-color 0.15s;
}
:global(html.dark) .fx-text-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #e5e7eb;
}
.fx-text-input:focus {
  border-color: #ec4141;
}
.fx-text-input::placeholder {
  color: #9ca3af;
}
/* ===== 频段垂直推子 ===== */
.eq-faders {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 4px;
}
.eq-fader-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.eq-fader-value {
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
  min-height: 16px;
  display: flex;
  align-items: baseline;
  gap: 1px;
  transition: color 0.15s;
}
:global(html.dark) .eq-fader-value {
  color: #6b7280;
}
.eq-fader-value.positive { color: #ec4141; }
.eq-fader-value.negative { color: #c0795a; }
.eq-fader-unit {
  font-size: 9px;
  font-weight: 400;
  opacity: 0.65;
}
.eq-fader-track {
  position: relative;
  width: 32px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.eq-fader-scale {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: #9ca3af;
  opacity: 0.55;
  pointer-events: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
:global(html.dark) .eq-fader-scale {
  color: #6b7280;
}
.eq-fader-scale.top { top: -2px; }
.eq-fader-scale.mid {
  top: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.9;
  font-weight: 600;
}
.eq-fader-scale.bot { bottom: -2px; }
.eq-fader-track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(0, 0, 0, 0.1);
  pointer-events: none;
  z-index: 0;
}
:global(html.dark) .eq-fader-track::before {
  background: rgba(255, 255, 255, 0.1);
}
.eq-fader-freq {
  font-size: 11px;
  font-weight: 600;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: baseline;
  gap: 1px;
}
:global(html.dark) .eq-fader-freq {
  color: #e5e7eb;
}
.eq-fader-freq-unit {
  font-size: 9px;
  font-weight: 400;
  color: #9ca3af;
}
:global(html.dark) .eq-fader-freq-unit {
  color: #6b7280;
}
section[class*="rounded-xl"] {
  transition: border-color 0.25s ease, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
