<script setup lang="ts">
/*
 * 音效标签页：调制与延迟特效（失真/镶边/相位/延迟/压缩器）、
 * 动态处理（多段压缩/限制器/噪声门/扩展器）、音色修复与增强
 * （激励器/次低音/去齿音/AGC）与复古风格（Lo-Fi/比特粉碎）。
 * 自 EqualizerPanel.vue 原样搬出。
 */
import RangeSlider from '../RangeSlider.vue';
import { useSoundEffectStore } from '../../../../features/playback/soundEffectStore';

const store = useSoundEffectStore();
</script>
<template>
  <!-- ==================== 音效标签页 ==================== -->
  <div class="space-y-6">
    <div class="text-[13px] font-bold text-[#EC4141]">调制与延迟特效</div>
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">失真效果 (Distortion)</div>
            <button class="fx-toggle" :class="{ on: store.distortionEnabled }" @click="store.distortionEnabled = !store.distortionEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">电子摇滚、重金属的破音质感</div>
          <div v-show="store.distortionEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">失真量</span>
              <RangeSlider variant="brand" interactive min="1" max="100" v-model="store.distortionAmount" />
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.distortionAmount }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">类型</span>
              <div class="flex flex-1 gap-1.5">
                <button class="fx-mode-btn" :class="{ active: store.distortionType === 'soft' }" @click="store.distortionType = 'soft'">软失真</button>
                <button class="fx-mode-btn" :class="{ active: store.distortionType === 'hard' }" @click="store.distortionType = 'hard'">硬失真</button>
              </div>
            </div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">镶边效果 (Flanger)</div>
            <button class="fx-toggle" :class="{ on: store.flangerEnabled }" @click="store.flangerEnabled = !store.flangerEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">左右声道相位错位，产生空灵飘忽音效</div>
          <div v-show="store.flangerEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">速率</span><RangeSlider variant="brand" interactive min="0.1" max="5" step="0.1" v-model="store.flangerRate" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerRate.toFixed(1) }}Hz</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span><RangeSlider variant="brand" interactive min="0.5" max="5" step="0.1" v-model="store.flangerDepth" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerDepth.toFixed(1) }}ms</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">反馈</span><RangeSlider variant="brand" interactive min="0" max="70" v-model="store.flangerFeedback" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerFeedback }}%</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">混合</span><RangeSlider variant="brand" interactive min="0" max="75" v-model="store.flangerMix" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerMix }}%</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">相位效果 (Phaser)</div>
            <button class="fx-toggle" :class="{ on: store.phaserEnabled }" @click="store.phaserEnabled = !store.phaserEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">声音周期性厚薄起伏</div>
          <div v-show="store.phaserEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">速率</span><RangeSlider variant="brand" interactive min="0.1" max="5" step="0.1" v-model="store.phaserRate" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.phaserRate.toFixed(1) }}Hz</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span><RangeSlider variant="brand" interactive min="0" max="30" v-model="store.phaserDepth" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ (store.phaserDepth / 10).toFixed(1) }}</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">反馈</span><RangeSlider variant="brand" interactive min="0" max="90" v-model="store.phaserFeedback" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.phaserFeedback }}%</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">混合</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.phaserMix" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.phaserMix }}%</span></div>
          </div>
        </section>
      </div>
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">延迟回声 (Delay)</div>
            <button class="fx-toggle" :class="{ on: store.delayEnabled }" @click="store.delayEnabled = !store.delayEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">单次回声 / 乒乓回声（8D标配附属效果）</div>
          <div v-show="store.delayEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">类型</span>
              <div class="flex flex-1 gap-1.5">
                <button class="fx-mode-btn" :class="{ active: store.delayType === 'single' }" @click="store.delayType = 'single'">单次</button>
                <button class="fx-mode-btn" :class="{ active: store.delayType === 'pingpong' }" @click="store.delayType = 'pingpong'">乒乓</button>
              </div>
            </div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">延迟时间</span><RangeSlider variant="brand" interactive min="50" max="2000" v-model="store.delayTime" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.delayTime }}ms</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">反馈</span><RangeSlider variant="brand" interactive min="0" max="90" v-model="store.delayFeedback" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.delayFeedback }}%</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">混合</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.delayMix" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.delayMix }}%</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">压缩器 (Compressor)</div>
            <button class="fx-toggle" :class="{ on: store.compressorEnabled }" @click="store.compressorEnabled = !store.compressorEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">统一歌曲音量，避免副歌爆音</div>
          <div v-show="store.compressorEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><RangeSlider variant="brand" interactive min="-60" max="0" v-model="store.compressorThreshold" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorThreshold }}dB</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">压缩比</span><RangeSlider variant="brand" interactive min="1" max="20" v-model="store.compressorRatio" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorRatio }}:1</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">启动</span><RangeSlider variant="brand" interactive min="1" max="100" v-model="store.compressorAttack" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorAttack }}ms</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">释放</span><RangeSlider variant="brand" interactive min="120" max="1000" v-model="store.compressorRelease" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorRelease }}ms</span></div>
          </div>
        </section>
      </div>
    </div>
    <div class="text-[13px] font-bold text-[#EC4141]">动态处理</div>
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
              多段压缩器
              <span class="rounded bg-[#EC4141]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#EC4141]">推荐</span>
            </div>
            <button class="fx-toggle" :class="{ on: store.multibandCompEnabled }" @click="store.multibandCompEnabled = !store.multibandCompEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">分低/中/高频段单独压缩，比单段压缩器精细很多</div>
          <div v-show="store.multibandCompEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">低频分频</span><RangeSlider variant="brand" interactive min="50" max="500" v-model="store.mbLowFreq" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbLowFreq }}Hz</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">中频分频</span><RangeSlider variant="brand" interactive min="1000" max="5000" v-model="store.mbMidFreq" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbMidFreq }}Hz</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><RangeSlider variant="brand" interactive min="-60" max="0" v-model="store.mbThreshold" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbThreshold }}dB</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">压缩比</span><RangeSlider variant="brand" interactive min="1" max="20" v-model="store.mbRatio" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbRatio }}:1</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">限制器 (Limiter)</div>
            <button class="fx-toggle" :class="{ on: store.limiterEnabled }" @click="store.limiterEnabled = !store.limiterEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">智能控制最大音量，杜绝爆音破音，安全提升整体响度</div>
          <div v-show="store.limiterEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><RangeSlider variant="brand" interactive min="-10" max="0" step="0.5" v-model="store.limiterThreshold" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.limiterThreshold }}dB</span></div>
          </div>
        </section>
      </div>
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">噪声门 (Noise Gate)</div>
            <button class="fx-toggle" :class="{ on: store.noiseGateEnabled }" @click="store.noiseGateEnabled = !store.noiseGateEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">自动过滤低音量的背景底噪、磁带杂音</div>
          <div v-show="store.noiseGateEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><RangeSlider variant="brand" interactive min="-80" max="0" v-model="store.noiseGateThreshold" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.noiseGateThreshold }}dB</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">启动</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.noiseGateAttack" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.noiseGateAttack }}ms</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">释放</span><RangeSlider variant="brand" interactive min="10" max="1000" v-model="store.noiseGateRelease" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.noiseGateRelease }}ms</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">扩展器 (Expander)</div>
            <button class="fx-toggle" :class="{ on: store.expanderEnabled }" @click="store.expanderEnabled = !store.expanderEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">放大音乐的强弱动态对比，古典乐现场演奏氛围感更强</div>
          <div v-show="store.expanderEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><RangeSlider variant="brand" interactive min="-80" max="0" v-model="store.expanderThreshold" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.expanderThreshold }}dB</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">扩展比</span><RangeSlider variant="brand" interactive min="1" max="10" step="0.5" v-model="store.expanderRatio" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.expanderRatio }}:1</span></div>
          </div>
        </section>
      </div>
    </div>
    <div class="text-[13px] font-bold text-[#EC4141]">音色修复与增强</div>
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">谐波激励器 (Exciter)</div>
            <button class="fx-toggle" :class="{ on: store.exciterEnabled }" @click="store.exciterEnabled = !store.exciterEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">给中高频添加柔和谐波失真，让发闷的耳机/歌曲变得通透</div>
          <div v-show="store.exciterEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">激励量</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.exciterAmount" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.exciterAmount }}%</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span><RangeSlider variant="brand" interactive min="1000" max="8000" step="100" v-model="store.exciterFrequency" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.exciterFrequency }}Hz</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">次谐波低音增强</div>
            <button class="fx-toggle" :class="{ on: store.subBassEnabled }" @click="store.subBassEnabled = !store.subBassEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">生成缺失的低频谐波，小耳机也能感受到更沉的下潜</div>
          <div v-show="store.subBassEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">增强量</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.subBassAmount" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.subBassAmount }}%</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span><RangeSlider variant="brand" interactive min="50" max="250" v-model="store.subBassFrequency" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.subBassFrequency }}Hz</span></div>
          </div>
        </section>
      </div>
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">去齿音 (De-esser)</div>
            <button class="fx-toggle" :class="{ on: store.deEsserEnabled }" @click="store.deEsserEnabled = !store.deEsserEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">精准压制人声里刺耳的"嘶、哧"高频齿音</div>
          <div v-show="store.deEsserEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><RangeSlider variant="brand" interactive min="-60" max="0" v-model="store.deEsserThreshold" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.deEsserThreshold }}dB</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span><RangeSlider variant="brand" interactive min="3000" max="10000" step="100" v-model="store.deEsserFrequency" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.deEsserFrequency }}Hz</span></div>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">自动增益 (AGC)</div>
            <button class="fx-toggle" :class="{ on: store.agcEnabled }" @click="store.agcEnabled = !store.agcEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">自动拉平不同歌曲的音量差，切歌时不用频繁手动调音量</div>
          <div v-show="store.agcEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">目标音量</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.agcTargetLevel" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.agcTargetLevel }}</span></div>
          </div>
        </section>
      </div>
    </div>
    <div class="text-[13px] font-bold text-[#EC4141]">复古风格</div>
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Lo-Fi 低保真效果</div>
            <button class="fx-toggle" :class="{ on: store.loFiEnabled }" @click="store.loFiEnabled = !store.loFiEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">叠加降采样、位深降低、磁带底噪，适合复古松弛听歌氛围</div>
          <div v-show="store.loFiEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">采样率</span><RangeSlider variant="brand" interactive min="2000" max="22050" step="500" v-model="store.loFiSampleRate" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ (store.loFiSampleRate / 1000).toFixed(1) }}kHz</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">位深</span><RangeSlider variant="brand" interactive min="4" max="16" v-model="store.loFiBitDepth" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.loFiBitDepth }}bit</span></div>
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">底噪</span><RangeSlider variant="brand" interactive min="0" max="100" v-model="store.loFiNoise" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.loFiNoise }}%</span></div>
          </div>
        </section>
      </div>
      <div class="space-y-3">
        <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">比特粉碎 (Bitcrush)</div>
            <button class="fx-toggle" :class="{ on: store.bitcrushEnabled }" @click="store.bitcrushEnabled = !store.bitcrushEnabled">
              <span class="fx-toggle-knob"></span>
            </button>
          </div>
          <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">降采样降位深的复古电子质感，适合芯片音乐、实验电子</div>
          <div v-show="store.bitcrushEnabled" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">位深</span><RangeSlider variant="brand" interactive min="2" max="16" v-model="store.bitcrushBits" /><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.bitcrushBits }}bit</span></div>
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
