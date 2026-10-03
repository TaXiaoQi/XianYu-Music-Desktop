<script setup lang="ts">
/*
 * 音调变速标签页：升降调（百分比/半音）、速度调节、音调补偿、
 * 卡拉OK消人声与动态漂移/颤音/抖音。自 EqualizerPanel.vue 原样搬出。
 */
import RangeSlider from '../RangeSlider.vue';
import { useSoundEffectStore } from '../../../../features/playback/soundEffectStore';
import { usePitchControls } from '../../../../composables/soundEffect/usePitchControls';

const store = useSoundEffectStore();
const {
  handleResetPitch,
  handleResetPlaybackRate,
  pitchProgress,
  playbackRateProgress,
  pitchMode,
  SEMITONE_MIN,
  SEMITONE_MAX,
  pitchSemitones,
  semitoneProgress,
  semitoneLabel,
} = usePitchControls();
</script>
<template>
  <!-- ==================== 音调变速标签页 ==================== -->
  <div class="space-y-6">
    <div class="grid grid-cols-2 gap-6">
      <div class="space-y-4">
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
              <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
              音调升降调节
            </h3>
            <div class="flex items-center gap-2">
              <div class="flex gap-1.5">
                <button class="fx-mode-btn" :class="{ active: pitchMode === 'percent' }" @click="pitchMode = 'percent'">百分比</button>
                <button class="fx-mode-btn" :class="{ active: pitchMode === 'semitone' }" @click="pitchMode = 'semitone'">半音</button>
              </div>
              <button class="fx-reset-btn" @click="handleResetPitch">重置</button>
            </div>
          </div>
          <div v-if="pitchMode === 'percent'" class="flex items-center gap-2.5">
            <span class="min-w-[48px] text-[14px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">{{ (store.pitchShift / 100).toFixed(2) }}x</span>
            <RangeSlider
              variant="brand"
              interactive
              class="flex-1"
              :min="50"
              :max="200"
              v-model="store.pitchShift"
              :progress="pitchProgress"
            />
          </div>
          <div v-else class="flex items-center gap-2.5">
            <span class="min-w-[48px] text-[14px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">{{ semitoneLabel }}</span>
            <RangeSlider
              variant="brand"
              interactive
              class="flex-1"
              :min="SEMITONE_MIN"
              :max="SEMITONE_MAX"
              :step="1"
              v-model="pitchSemitones"
              :progress="semitoneProgress"
            />
            <span class="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ (store.pitchShift / 100).toFixed(2) }}x</span>
          </div>
        </section>
        <section class="space-y-2">
          <div class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            速度调节
          </div>
          <div class="flex items-center gap-2.5">
            <span class="min-w-[48px] text-[14px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">{{ (store.playbackRate / 100).toFixed(2) }}x</span>
            <RangeSlider
              variant="brand"
              interactive
              class="flex-1"
              :min="50"
              :max="200"
              v-model="store.playbackRate"
              :progress="playbackRateProgress"
            />
            <button class="fx-reset-btn" @click="handleResetPlaybackRate">重置</button>
          </div>
        </section>
        <div class="flex items-center gap-2 py-0.5">
          <input type="checkbox" class="fx-check-mini" v-model="store.preservesPitch">
          <span class="text-[12px] text-gray-600 dark:text-gray-300">音调补偿（变速时保持音调）</span>
        </div>

        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-gray-100">卡拉OK消人声</div>
            <button class="fx-toggle" :class="{ on: store.vocalRemoval }" @click="store.vocalRemoval = !store.vocalRemoval">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">分离伴奏与人声轨道，去除中心声像的人声</div>
        </section>
      </div>
      <div class="space-y-4">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-gray-100">动态音调漂移</div>
            <button class="fx-toggle" :class="{ on: store.pitchDriftEnabled }" @click="store.pitchDriftEnabled = !store.pitchDriftEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">乐曲全程缓慢升降调，"空灵版本"来源</div>
          <div v-show="store.pitchDriftEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">漂移速度</span>
              <RangeSlider variant="brand" interactive min="0.1" max="5" step="0.1" v-model="store.pitchDriftSpeed" />
              <span class="w-12 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ (store.pitchDriftSpeed * 0.1).toFixed(2) }}Hz</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">漂移范围</span>
              <RangeSlider variant="brand" interactive min="0" max="30" v-model="store.pitchDriftRange" />
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.pitchDriftRange }}ms</span>
            </div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-gray-100">颤音 (Vibrato)</div>
            <button class="fx-toggle" :class="{ on: store.vibratoEnabled }" @click="store.vibratoEnabled = !store.vibratoEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div v-show="store.vibratoEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span>
              <RangeSlider variant="brand" interactive min="1" max="20" v-model="store.vibratoRate" />
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.vibratoRate }}Hz</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span>
              <RangeSlider variant="brand" interactive min="0" max="10" v-model="store.vibratoDepth" />
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.vibratoDepth }}ms</span>
            </div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-gray-100">抖音效果器 (Tremolo)</div>
            <button class="fx-toggle" :class="{ on: store.tremoloEnabled }" @click="store.tremoloEnabled = !store.tremoloEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">周期性音量起伏调制</div>
          <div v-show="store.tremoloEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span>
              <RangeSlider variant="brand" interactive min="1" max="20" v-model="store.tremoloRate" />
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.tremoloRate }}Hz</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span>
              <RangeSlider variant="brand" interactive min="0" max="100" v-model="store.tremoloDepth" />
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.tremoloDepth }}%</span>
            </div>
          </div>
        </section>
      </div>
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
/* ===== 小复选框（音调补偿/跟随鼓点） ===== */
.fx-check-mini {
  width: 13px;
  height: 13px;
  margin: 0;
  cursor: pointer;
  accent-color: #ec4141;
}
/* ===== 模式选择按钮（百分比/半音、单次/乒乓、软/硬失真等） =====
   深色文字 + 实底背景 + 中等字重，保证半透明卡片上的可读性 */
.fx-mode-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 14px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.75);
  border-radius: 6px;
  color: #374151;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  flex: 1;
}
:global(html.dark) .fx-mode-btn {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.1);
  color: #e5e7eb;
}
.fx-mode-btn:hover {
  border-color: rgba(236, 65, 65, 0.5);
  color: #ec4141;
  background: #fff;
}

:global(html.dark) .fx-mode-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.fx-mode-btn.active {
  background: #ec4141;
  border-color: #ec4141;
  color: #fff;
  box-shadow: 0 2px 6px rgba(236, 65, 65, 0.35);
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
