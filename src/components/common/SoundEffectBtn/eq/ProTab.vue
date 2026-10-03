<script setup lang="ts">
/*
 * 专业标签页：V4A 全套音效、Crossfeed 互馈、立体声拓宽、
 * 单声道合并、声道交换、AB 对比与整套预设管理。
 * 自 EqualizerPanel.vue 原样搬出。
 */
import RangeSlider from '../RangeSlider.vue';
import { useSoundEffectStore } from '../../../../features/playback/soundEffectStore';
import { useFullEffectPresets } from '../../../../composables/soundEffect/useFullEffectPresets';

const store = useSoundEffectStore();
const { fullPresetName, handleSaveFullPreset, handleResetAllAdvanced } = useFullEffectPresets();
</script>
<template>
  <!-- ==================== 专业标签页 ==================== -->
  <div class="space-y-6">
    <div class="grid grid-cols-2 gap-6">
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">V4A 全套音效</div>
            <button class="fx-toggle" :class="{ on: store.v4aEnabled }" @click="store.v4aEnabled = !store.v4aEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">一键启用业内老牌音效合集: 动态低音 + 动态均衡 + 立体声拓宽 + 温和压缩</div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Crossfeed 耳机互馈</div>
            <button class="fx-toggle" :class="{ on: store.crossfeedEnabled }" @click="store.crossfeedEnabled = !store.crossfeedEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">解决耳机左右声道割裂，模拟音箱外放听感</div>
          <div v-show="store.crossfeedEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">互馈强度</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.crossfeedStrength" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.crossfeedStrength }}%</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">立体声拓宽</div>
            <button class="fx-toggle" :class="{ on: store.stereoWidenEnabled }" @click="store.stereoWidenEnabled = !store.stereoWidenEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">拉宽左右声道距离，歌曲显得更宏大</div>
          <div v-show="store.stereoWidenEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">拓宽量</span><RangeSlider variant="brand" interactive min="0" max="3" step="0.1" v-model="store.stereoWidenAmount" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.stereoWidenAmount.toFixed(1) }}</span></div>
          </div>
        </section>
      </div>
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">单声道合并</div>
            <button class="fx-toggle" :class="{ on: store.monoMergeEnabled }" @click="store.monoMergeEnabled = !store.monoMergeEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">将左右声道合并为单声道输出</div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">左右声道交换</div>
            <button class="fx-toggle" :class="{ on: store.channelSwapEnabled }" @click="store.channelSwapEnabled = !store.channelSwapEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">交换左右声道，修正接反的耳机/音箱</div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">AB 一键对比</div>
            <button class="fx-toggle" :class="{ on: store.bypassAll }" @click="store.bypassAll = !store.bypassAll">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">开启后旁通所有音效，方便判断效果是否正向</div>
        </section>
        <section class="space-y-2">
          <div class="text-[12px] font-semibold text-gray-600 dark:text-gray-300">整套音效预设</div>
          <div class="flex items-center gap-2">
            <input type="text" class="fx-text-input" v-model="fullPresetName" placeholder="预设名称" @keydown.enter="handleSaveFullPreset">
            <button class="fx-preset-btn" @click="handleSaveFullPreset">保存</button>
          </div>
          <div v-if="store.fullEffectPresets.length > 0" class="flex flex-wrap gap-1.5">
            <button v-for="p in store.fullEffectPresets" :key="p.name" class="fx-preset-btn fx-preset-advanced" @click="store.loadFullEffectPreset(p.name)">{{ p.name }}</button>
          </div>
        </section>
        <button class="w-full rounded-xl border border-gray-200/70 bg-white/40 py-2.5 text-[13px] font-medium text-[#EC4141] transition-all hover:border-[#EC4141]/40 hover:bg-white/60 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10" @click="handleResetAllAdvanced">重置所有高级音效</button>
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
