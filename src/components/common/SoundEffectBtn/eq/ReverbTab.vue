<script setup lang="ts">
/*
 * 混响标签页：环境混响（卷积）、算法混响、原始/环境增益
 * 与 3D/8D/36D/虚拟多声道空间环绕。自 EqualizerPanel.vue 原样搬出。
 */
import RangeSlider from '../../RangeSlider.vue';
import { useSoundEffectStore } from '../../../../features/playback/soundEffectStore';
import {
  useReverbOptions,
} from '../../../../composables/soundEffect/useReverbOptions';

const store = useSoundEffectStore();
const {
  reverbItems,
  customConvolutionActive,
  algoReverbItems,
  customAlgoReverbActive,
  reverbNoneActive,
  handleReverbNone,
  handleReverbToggle,
  handleAlgoReverbToggle,
  handleConvolutionCustom,
  handleAlgoReverbCustom,
  handleReverbGainInput,
} = useReverbOptions();
</script>
<template>
  <!-- ==================== 混响标签页 ==================== -->
  <div class="space-y-6">
    <div class="grid grid-cols-2 gap-6">
      <div class="space-y-4">
        <section class="space-y-3">
          <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            环境混响音效
          </h3>
          <div class="grid grid-cols-4 gap-1.5">
            <label
              class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors"
              :class="reverbNoneActive
                ? 'bg-[#EC4141]/10 text-[#EC4141]'
                : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
              @click.prevent="handleReverbNone"
            >
              无
            </label>
            <label
              v-for="item in reverbItems"
              :key="item.label"
              class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors"
              :class="item.active.value
                ? 'bg-[#EC4141]/10 text-[#EC4141]'
                : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
              @click.prevent="handleReverbToggle(item.label)"
            >
              {{ item.name }}
            </label>
            <label
              class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors"
              :class="customConvolutionActive
                ? 'bg-[#EC4141]/10 text-[#EC4141]'
                : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
              @click.prevent="handleConvolutionCustom"
            >
              自定义
            </label>
          </div>
        </section>
        <section class="space-y-3">
          <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            算法混响（程序生成）
          </h3>
          <div class="flex flex-wrap gap-1.5">
            <label
              class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors"
              :class="reverbNoneActive
                ? 'bg-[#EC4141]/10 text-[#EC4141]'
                : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
              @click.prevent="handleReverbNone"
            >
              无
            </label>
            <label
              v-for="item in algoReverbItems"
              :key="item.label"
              class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors"
              :class="item.active.value
                ? 'bg-[#EC4141]/10 text-[#EC4141]'
                : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
              @click.prevent="handleAlgoReverbToggle(item.label)"
            >
              {{ item.name }}
            </label>
            <label
              class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors"
              :class="customAlgoReverbActive
                ? 'bg-[#EC4141]/10 text-[#EC4141]'
                : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
              @click.prevent="handleAlgoReverbCustom"
            >
              自定义
            </label>
          </div>
        </section>

        <div
          class="space-y-3 rounded-xl border border-gray-200/70 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5 transition-opacity"
          :class="{ 'opacity-50': reverbNoneActive }"
        >
          <div class="flex items-center gap-2">
            <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">原始增益</span>
            <RangeSlider variant="brand" interactive min="0" max="100" v-model="store.originalGain" :disabled="reverbNoneActive" @input="handleReverbGainInput" />
            <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.originalGain }}%</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">环境增益</span>
            <RangeSlider variant="brand" interactive min="0" max="100" v-model="store.envGain" :disabled="reverbNoneActive" @input="handleReverbGainInput" />
            <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.envGain }}%</span>
          </div>
        </div>
      </div>
      <div class="space-y-4">
        <section class="space-y-3">
          <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            空间环绕音效
          </h3>
          <div class="grid grid-cols-1 gap-3">
            <div class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                  3D立体环绕
                  <span class="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">耳机</span>
                </div>
                <button class="fx-toggle" :class="{ on: store.enable3DSurround }" @click="store.enable3DSurround = !store.enable3DSurround">
                  <span class="fx-toggle-knob"></span>
                </button>
              </div>
              <div v-show="store.enable3DSurround" class="mt-2 space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">环绕强度</span>
                  <RangeSlider variant="brand" interactive min="0" max="10" v-model="store.surroundIntensity" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.surroundIntensity }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">旋转速度</span>
                  <RangeSlider variant="brand" interactive min="0.5" max="20" step="0.1" v-model="store.surround3DRotation" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.surround3DRotation.toFixed(1) }}s</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声音距离</span>
                  <RangeSlider variant="brand" interactive min="0" max="20" v-model="store.soundDistance" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.soundDistance }}</span>
                </div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                  8D环绕音效
                  <span class="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">耳机</span>
                </div>
                <button class="fx-toggle" :class="{ on: store.enable8D }" @click="store.enable8D = !store.enable8D">
                  <span class="fx-toggle-knob"></span>
                </button>
              </div>
              <div v-show="store.enable8D" class="mt-2 space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">旋转速度</span>
                  <RangeSlider variant="brand" interactive min="2" max="60" v-model="store.rotationSpeed8D" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.rotationSpeed8D }}s</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声源距离</span>
                  <RangeSlider variant="brand" interactive min="1" max="20" v-model="store.virtualDistance8D" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.virtualDistance8D }}</span>
                </div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                  36D环绕音效
                  <span class="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">耳机</span>
                </div>
                <button class="fx-toggle" :class="{ on: store.enable36D }" @click="store.enable36D = !store.enable36D">
                  <span class="fx-toggle-knob"></span>
                </button>
              </div>
              <div v-show="store.enable36D" class="mt-2 space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">旋转速度</span>
                  <RangeSlider variant="brand" interactive min="2" max="60" v-model="store.rotationSpeed36D" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.rotationSpeed36D }}s</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声源距离</span>
                  <RangeSlider variant="brand" interactive min="1" max="20" v-model="store.virtualDistance36D" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.virtualDistance36D }}</span>
                </div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                  虚拟多声道
                  <span class="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">耳机</span>
                </div>
                <button class="fx-toggle" :class="{ on: store.enableVirtualSurround }" @click="store.enableVirtualSurround = !store.enableVirtualSurround">
                  <span class="fx-toggle-knob"></span>
                </button>
              </div>
              <div v-show="store.enableVirtualSurround" class="mt-2 space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声道模式</span>
                  <div class="flex flex-1 gap-1.5">
                    <button class="fx-mode-btn" :class="{ active: store.virtualSurroundMode === '7.1' }" @click="store.virtualSurroundMode = '7.1'">7.1</button>
                    <button class="fx-mode-btn" :class="{ active: store.virtualSurroundMode === '5.1' }" @click="store.virtualSurroundMode = '5.1'">5.1</button>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声场宽度</span>
                  <RangeSlider variant="brand" interactive min="3" max="20" v-model="store.virtualSurroundSpread" />
                  <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.virtualSurroundSpread }}</span>
                </div>
              </div>
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
