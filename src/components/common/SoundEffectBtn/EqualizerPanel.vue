<script setup lang="ts">
import { useSoundEffectStore, eqPresetNames, advancedEqPresetNames } from '../../../features/playback/soundEffectStore';
import { convolutions } from '../../../utils/audio/soundEffectEngine';
import { computed, ref } from 'vue';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits(['update:visible']);

const store = useSoundEffectStore();

// ===== 标签页 =====
const activeTab = ref<'reverb' | 'pitch' | 'eq' | 'fx' | 'pro'>('reverb');
const tabs = [
  { id: 'reverb', name: '混响' },
  { id: 'pitch', name: '音调变速' },
  { id: 'eq', name: '均衡器' },
  { id: 'fx', name: '音效' },
  { id: 'pro', name: '专业' },
] as const;

// ===== 混响选项 =====
const reverbItems = convolutions.map(c => ({
  label: c.label,
  name: c.name,
  active: computed(() => store.activeConvolution === c.label),
}));

const handleReverbToggle = (label: string) => {
  store.toggleConvolution(label);
};

// ===== 均衡器 =====
const handleApplyPreset = (name: string) => {
  store.applyPreset(name);
};

const handleResetEq = () => {
  store.resetEq();
};

// ===== 音调/速度 =====
const handleResetPitch = () => {
  store.resetPitch();
};

const handleResetPlaybackRate = () => {
  store.resetPlaybackRate();
};

const pitchProgress = computed(() => {
  return ((store.pitchShift - 50) / (200 - 50)) * 100;
});

const playbackRateProgress = computed(() => {
  return ((store.playbackRate - 50) / (200 - 50)) * 100;
});

// ===== 关闭 =====
const handleClose = () => {
  emit('update:visible', false);
};

// ===== 重置所有高级效果 =====
const handleResetAllAdvanced = () => {
  store.resetAllAdvanced();
};

// ===== 自定义 EQ 预设 =====
const customPresetName = ref('');
const handleSaveCustomPreset = () => {
  if (!customPresetName.value.trim()) return;
  store.saveCustomEqPreset(customPresetName.value.trim());
  customPresetName.value = '';
};

// ===== 整套预设 =====
const fullPresetName = ref('');
const handleSaveFullPreset = () => {
  if (!fullPresetName.value.trim()) return;
  store.saveFullEffectPreset(fullPresetName.value.trim());
  fullPresetName.value = '';
};

// ===== 均衡器频段元信息（顺序与 store.eqBands / Rust EQ_FREQUENCIES 一致） =====
const EQ_BANDS: ReadonlyArray<{ key: string; freq: string }> = [
  { key: '31', freq: '31' },
  { key: '62', freq: '62' },
  { key: '125', freq: '125' },
  { key: '250', freq: '250' },
  { key: '500', freq: '500' },
  { key: '1k', freq: '1k' },
  { key: '2k', freq: '2k' },
  { key: '4k', freq: '4k' },
  { key: '8k', freq: '8k' },
  { key: '16k', freq: '16k' },
];

const formatBandGain = (v: number) => (v > 0 ? `+${v}` : `${v}`);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div v-if="visible" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="handleClose">
        <div class="modal-content flex h-[70vh] w-[920px] flex-col overflow-hidden rounded-2xl bg-white/95 shadow-2xl ring-1 ring-black/5 dark:bg-[#1e1e1e]/95 dark:ring-white/10">

          <!-- 标题栏 -->
          <div class="flex h-12 shrink-0 items-center justify-between border-b border-gray-200/70 px-5 dark:border-white/10">
            <div class="flex items-center gap-2">
              <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
              <span class="text-sm font-bold text-gray-800 dark:text-gray-100">音效设置</span>
            </div>
            <button class="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-all hover:bg-black/5 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200" @click="handleClose" aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 标签页导航 -->
          <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200/70 px-5 dark:border-white/10">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="whitespace-nowrap border-b-2 px-5 py-2.5 text-[13px] font-medium transition-colors"
              :class="activeTab === tab.id
                ? 'border-[#EC4141] text-[#EC4141]'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'"
              @click="activeTab = tab.id"
            >{{ tab.name }}</button>
          </div>

          <!-- 内容区 -->
          <div class="custom-scrollbar flex-1 overflow-y-auto p-6">
            <div :key="activeTab" class="eq-tab-wrapper">

              <!-- ==================== 混响标签页 ==================== -->
              <div v-show="activeTab === 'reverb'" class="space-y-6">
                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-4">
                    <!-- 卷积混响 -->
                    <section class="space-y-3">
                      <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
                        环境混响音效
                      </h3>
                      <div class="grid grid-cols-4 gap-1.5">
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
                      </div>
                    </section>

                    <!-- 增益控制 -->
                    <div class="space-y-3 rounded-xl border border-gray-200/70 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center gap-2">
                        <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">原始增益</span>
                        <input type="range" class="fx-slider" min="0" max="300" v-model.number="store.originalGain">
                        <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.originalGain }}%</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">环境增益</span>
                        <input type="range" class="fx-slider" min="0" max="300" v-model.number="store.envGain">
                        <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.envGain }}%</span>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <!-- 空间音效 -->
                    <section class="space-y-3">
                      <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
                        空间环绕音效
                      </h3>
                      <div class="grid grid-cols-1 gap-3">
                        <!-- 3D立体环绕 -->
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
                              <input type="range" class="fx-slider" min="0" max="20" v-model.number="store.surroundIntensity">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.surroundIntensity }}</span>
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声音距离</span>
                              <input type="range" class="fx-slider" min="0" max="20" v-model.number="store.soundDistance">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.soundDistance }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- 8D环绕音效 -->
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
                              <input type="range" class="fx-slider" min="2" max="60" v-model.number="store.rotationSpeed8D">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.rotationSpeed8D }}s</span>
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声源距离</span>
                              <input type="range" class="fx-slider" min="1" max="20" v-model.number="store.virtualDistance8D">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.virtualDistance8D }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- 36D环绕音效 -->
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
                              <input type="range" class="fx-slider" min="2" max="60" v-model.number="store.rotationSpeed36D">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.rotationSpeed36D }}s</span>
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">声源距离</span>
                              <input type="range" class="fx-slider" min="1" max="20" v-model.number="store.virtualDistance36D">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.virtualDistance36D }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- 虚拟多声道 -->
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
                              <input type="range" class="fx-slider" min="1" max="20" v-model.number="store.virtualSurroundSpread">
                              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.virtualSurroundSpread }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <!-- ==================== 音调变速标签页 ==================== -->
              <div v-show="activeTab === 'pitch'" class="space-y-6">
                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-4">
                    <!-- 音调升降 -->
                    <section class="space-y-3">
                      <div class="flex items-center justify-between">
                        <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
                          音调升降调节
                        </h3>
                        <button class="fx-reset-btn" @click="handleResetPitch">重置</button>
                      </div>
                      <div class="flex items-center gap-2.5">
                        <span class="min-w-[48px] text-[14px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">{{ (store.pitchShift / 100).toFixed(2) }}x</span>
                        <input type="range" class="fx-slider flex-1" min="50" max="200" v-model.number="store.pitchShift" :style="{ '--pitch-progress': pitchProgress + '%' }">
                      </div>
                    </section>

                    <!-- 速度调节 -->
                    <section class="space-y-2">
                      <div class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
                        速度调节
                      </div>
                      <div class="flex items-center gap-2.5">
                        <span class="min-w-[48px] text-[14px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">{{ (store.playbackRate / 100).toFixed(2) }}x</span>
                        <input type="range" class="fx-slider flex-1" min="50" max="200" v-model.number="store.playbackRate" :style="{ '--pitch-progress': playbackRateProgress + '%' }">
                        <button class="fx-reset-btn" @click="handleResetPlaybackRate">重置</button>
                      </div>
                    </section>

                    <!-- 卡拉OK消人声 -->
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
                    <!-- 动态音调漂移 -->
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
                          <input type="range" class="fx-slider" min="1" max="50" v-model.number="store.pitchDriftSpeed">
                          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.pitchDriftSpeed }}</span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">漂移范围</span>
                          <input type="range" class="fx-slider" min="0" max="30" v-model.number="store.pitchDriftRange">
                          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.pitchDriftRange }}ms</span>
                        </div>
                      </div>
                    </section>

                    <!-- 颤音 -->
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
                          <input type="range" class="fx-slider" min="1" max="20" v-model.number="store.vibratoRate">
                          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.vibratoRate }}Hz</span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span>
                          <input type="range" class="fx-slider" min="0" max="10" v-model.number="store.vibratoDepth">
                          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.vibratoDepth }}ms</span>
                        </div>
                      </div>
                    </section>

                    <!-- 抖音效果器 -->
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
                          <input type="range" class="fx-slider" min="1" max="20" v-model.number="store.tremoloRate">
                          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.tremoloRate }}Hz</span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span>
                          <input type="range" class="fx-slider" min="0" max="100" v-model.number="store.tremoloDepth">
                          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.tremoloDepth }}%</span>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <!-- ==================== 均衡器标签页（专业垂直推子） ==================== -->
              <div v-show="activeTab === 'eq'" class="space-y-5">
                <div class="flex items-center justify-between">
                  <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                    <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
                    均衡器
                  </h3>
                  <button class="fx-reset-btn" @click="handleResetEq">重置</button>
                </div>

                <!-- 内置预设 -->
                <div class="space-y-2">
                  <div class="text-[12px] font-semibold text-gray-600 dark:text-gray-300">内置预设</div>
                  <div class="flex flex-wrap gap-1.5">
                    <button v-for="preset in eqPresetNames" :key="preset" class="fx-preset-btn" @click="handleApplyPreset(preset)">{{ preset }}</button>
                  </div>
                </div>

                <!-- 10 段垂直推子 -->
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
                      <input
                        type="range"
                        class="eq-fader-input"
                        min="-12"
                        max="12"
                        step="1"
                        v-model.number="store.eqBands[band.key]"
                      >
                    </div>
                    <div class="eq-fader-freq">{{ band.freq }}<span class="eq-fader-freq-unit">Hz</span></div>
                  </div>
                </div>

                <!-- 衍生预设 -->
                <div class="space-y-2">
                  <div class="text-[12px] font-semibold text-gray-600 dark:text-gray-300">均衡衍生预设</div>
                  <div class="flex flex-wrap gap-1.5">
                    <button v-for="preset in advancedEqPresetNames" :key="preset" class="fx-preset-btn fx-preset-advanced" @click="handleApplyPreset(preset)">{{ preset }}</button>
                  </div>
                </div>

                <!-- 自定义预设 -->
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

                <!-- 动态均衡 + Bass 重低音 -->
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
                        <input type="range" class="fx-slider" min="0" max="15" v-model.number="store.bassBoostGain">
                        <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.bassBoostGain }}dB</span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <!-- ==================== 音效标签页 ==================== -->
              <div v-show="activeTab === 'fx'" class="space-y-6">
                <div class="text-[13px] font-bold text-[#EC4141]">调制与延迟特效</div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <!-- 失真 -->
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
                          <input type="range" class="fx-slider" min="1" max="100" v-model.number="store.distortionAmount">
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

                    <!-- Flanger -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">镶边效果 (Flanger)</div>
                        <button class="fx-toggle" :class="{ on: store.flangerEnabled }" @click="store.flangerEnabled = !store.flangerEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">左右声道相位错位，产生空灵飘忽音效</div>
                      <div v-show="store.flangerEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">速率</span><input type="range" class="fx-slider" min="0.1" max="5" step="0.1" v-model.number="store.flangerRate"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerRate.toFixed(1) }}Hz</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span><input type="range" class="fx-slider" min="0.5" max="5" step="0.1" v-model.number="store.flangerDepth"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerDepth.toFixed(1) }}ms</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">反馈</span><input type="range" class="fx-slider" min="0" max="70" v-model.number="store.flangerFeedback"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerFeedback }}%</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">混合</span><input type="range" class="fx-slider" min="0" max="75" v-model.number="store.flangerMix"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.flangerMix }}%</span></div>
                      </div>
                    </section>

                    <!-- Phaser -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">相位效果 (Phaser)</div>
                        <button class="fx-toggle" :class="{ on: store.phaserEnabled }" @click="store.phaserEnabled = !store.phaserEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">声音周期性厚薄起伏</div>
                      <div v-show="store.phaserEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">速率</span><input type="range" class="fx-slider" min="1" max="50" v-model.number="store.phaserRate"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.phaserRate.toFixed(1) }}Hz</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">深度</span><input type="range" class="fx-slider" min="0" max="30" v-model.number="store.phaserDepth"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ (store.phaserDepth / 10).toFixed(1) }}</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">反馈</span><input type="range" class="fx-slider" min="0" max="90" v-model.number="store.phaserFeedback"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.phaserFeedback }}%</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">混合</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.phaserMix"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.phaserMix }}%</span></div>
                      </div>
                    </section>
                  </div>

                  <div class="space-y-3">
                    <!-- Delay -->
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
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">延迟时间</span><input type="range" class="fx-slider" min="50" max="2000" v-model.number="store.delayTime"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.delayTime }}ms</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">反馈</span><input type="range" class="fx-slider" min="0" max="90" v-model.number="store.delayFeedback"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.delayFeedback }}%</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">混合</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.delayMix"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.delayMix }}%</span></div>
                      </div>
                    </section>

                    <!-- 压缩器 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">压缩器 (Compressor)</div>
                        <button class="fx-toggle" :class="{ on: store.compressorEnabled }" @click="store.compressorEnabled = !store.compressorEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">统一歌曲音量，避免副歌爆音</div>
                      <div v-show="store.compressorEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><input type="range" class="fx-slider" min="-60" max="0" v-model.number="store.compressorThreshold"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorThreshold }}dB</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">压缩比</span><input type="range" class="fx-slider" min="1" max="20" v-model.number="store.compressorRatio"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorRatio }}:1</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">启动</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.compressorAttack"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorAttack }}ms</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">释放</span><input type="range" class="fx-slider" min="10" max="1000" v-model.number="store.compressorRelease"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.compressorRelease }}ms</span></div>
                      </div>
                    </section>
                  </div>
                </div>

                <div class="text-[13px] font-bold text-[#EC4141]">动态处理</div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <!-- 多段压缩器 -->
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
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">低频分频</span><input type="range" class="fx-slider" min="50" max="500" v-model.number="store.mbLowFreq"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbLowFreq }}Hz</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">中频分频</span><input type="range" class="fx-slider" min="500" max="5000" v-model.number="store.mbMidFreq"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbMidFreq }}Hz</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><input type="range" class="fx-slider" min="-60" max="0" v-model.number="store.mbThreshold"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbThreshold }}dB</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">压缩比</span><input type="range" class="fx-slider" min="1" max="20" v-model.number="store.mbRatio"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.mbRatio }}:1</span></div>
                      </div>
                    </section>

                    <!-- 限制器 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">限制器 (Limiter)</div>
                        <button class="fx-toggle" :class="{ on: store.limiterEnabled }" @click="store.limiterEnabled = !store.limiterEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">智能控制最大音量，杜绝爆音破音，安全提升整体响度</div>
                      <div v-show="store.limiterEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><input type="range" class="fx-slider" min="-10" max="0" step="0.5" v-model.number="store.limiterThreshold"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.limiterThreshold }}dB</span></div>
                      </div>
                    </section>
                  </div>

                  <div class="space-y-3">
                    <!-- 噪声门 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">噪声门 (Noise Gate)</div>
                        <button class="fx-toggle" :class="{ on: store.noiseGateEnabled }" @click="store.noiseGateEnabled = !store.noiseGateEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">自动过滤低音量的背景底噪、磁带杂音</div>
                      <div v-show="store.noiseGateEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><input type="range" class="fx-slider" min="-80" max="0" v-model.number="store.noiseGateThreshold"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.noiseGateThreshold }}dB</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">启动</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.noiseGateAttack"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.noiseGateAttack }}ms</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">释放</span><input type="range" class="fx-slider" min="10" max="1000" v-model.number="store.noiseGateRelease"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.noiseGateRelease }}ms</span></div>
                      </div>
                    </section>

                    <!-- 扩展器 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">扩展器 (Expander)</div>
                        <button class="fx-toggle" :class="{ on: store.expanderEnabled }" @click="store.expanderEnabled = !store.expanderEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">放大音乐的强弱动态对比，古典乐现场演奏氛围感更强</div>
                      <div v-show="store.expanderEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><input type="range" class="fx-slider" min="-80" max="0" v-model.number="store.expanderThreshold"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.expanderThreshold }}dB</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">扩展比</span><input type="range" class="fx-slider" min="1" max="10" step="0.5" v-model.number="store.expanderRatio"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.expanderRatio }}:1</span></div>
                      </div>
                    </section>
                  </div>
                </div>

                <div class="text-[13px] font-bold text-[#EC4141]">音色修复与增强</div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <!-- 谐波激励器 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">谐波激励器 (Exciter)</div>
                        <button class="fx-toggle" :class="{ on: store.exciterEnabled }" @click="store.exciterEnabled = !store.exciterEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">给中高频添加柔和谐波失真，让发闷的耳机/歌曲变得通透</div>
                      <div v-show="store.exciterEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">激励量</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.exciterAmount"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.exciterAmount }}%</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span><input type="range" class="fx-slider" min="1000" max="8000" step="100" v-model.number="store.exciterFrequency"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.exciterFrequency }}Hz</span></div>
                      </div>
                    </section>

                    <!-- 次谐波低音 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">次谐波低音增强</div>
                        <button class="fx-toggle" :class="{ on: store.subBassEnabled }" @click="store.subBassEnabled = !store.subBassEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">生成缺失的低频谐波，小耳机也能感受到更沉的下潜</div>
                      <div v-show="store.subBassEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">增强量</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.subBassAmount"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.subBassAmount }}%</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span><input type="range" class="fx-slider" min="50" max="250" v-model.number="store.subBassFrequency"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.subBassFrequency }}Hz</span></div>
                      </div>
                    </section>
                  </div>

                  <div class="space-y-3">
                    <!-- 去齿音 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">去齿音 (De-esser)</div>
                        <button class="fx-toggle" :class="{ on: store.deEsserEnabled }" @click="store.deEsserEnabled = !store.deEsserEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">精准压制人声里刺耳的"嘶、哧"高频齿音</div>
                      <div v-show="store.deEsserEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">阈值</span><input type="range" class="fx-slider" min="-60" max="0" v-model.number="store.deEsserThreshold"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.deEsserThreshold }}dB</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">频率</span><input type="range" class="fx-slider" min="3000" max="10000" step="100" v-model.number="store.deEsserFrequency"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.deEsserFrequency }}Hz</span></div>
                      </div>
                    </section>

                    <!-- AGC -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">自动增益 (AGC)</div>
                        <button class="fx-toggle" :class="{ on: store.agcEnabled }" @click="store.agcEnabled = !store.agcEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">自动拉平不同歌曲的音量差，切歌时不用频繁手动调音量</div>
                      <div v-show="store.agcEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">目标音量</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.agcTargetLevel"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.agcTargetLevel }}</span></div>
                      </div>
                    </section>
                  </div>
                </div>

                <div class="text-[13px] font-bold text-[#EC4141]">复古风格</div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <!-- Lo-Fi -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Lo-Fi 低保真效果</div>
                        <button class="fx-toggle" :class="{ on: store.loFiEnabled }" @click="store.loFiEnabled = !store.loFiEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">叠加降采样、位深降低、磁带底噪，适合复古松弛听歌氛围</div>
                      <div v-show="store.loFiEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">采样率</span><input type="range" class="fx-slider" min="2000" max="22050" step="500" v-model.number="store.loFiSampleRate"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ (store.loFiSampleRate / 1000).toFixed(1) }}kHz</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">位深</span><input type="range" class="fx-slider" min="4" max="16" v-model.number="store.loFiBitDepth"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.loFiBitDepth }}bit</span></div>
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">底噪</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.loFiNoise"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.loFiNoise }}%</span></div>
                      </div>
                    </section>
                  </div>

                  <div class="space-y-3">
                    <!-- 比特粉碎 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">比特粉碎 (Bitcrush)</div>
                        <button class="fx-toggle" :class="{ on: store.bitcrushEnabled }" @click="store.bitcrushEnabled = !store.bitcrushEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">降采样降位深的复古电子质感，适合芯片音乐、实验电子</div>
                      <div v-show="store.bitcrushEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">位深</span><input type="range" class="fx-slider" min="2" max="16" v-model.number="store.bitcrushBits"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.bitcrushBits }}bit</span></div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <!-- ==================== 专业标签页 ==================== -->
              <div v-show="activeTab === 'pro'" class="space-y-6">
                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-3">
                    <!-- V4A -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">V4A 全套音效</div>
                        <button class="fx-toggle" :class="{ on: store.v4aEnabled }" @click="store.v4aEnabled = !store.v4aEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">一键启用业内老牌音效合集: 动态低音 + 动态均衡 + 立体声拓宽 + 温和压缩</div>
                    </section>

                    <!-- Crossfeed -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Crossfeed 耳机互馈</div>
                        <button class="fx-toggle" :class="{ on: store.crossfeedEnabled }" @click="store.crossfeedEnabled = !store.crossfeedEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">解决耳机左右声道割裂，模拟音箱外放听感</div>
                      <div v-show="store.crossfeedEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">互馈强度</span><input type="range" class="fx-slider" min="0" max="100" v-model.number="store.crossfeedStrength"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.crossfeedStrength }}%</span></div>
                      </div>
                    </section>

                    <!-- 立体声拓宽 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">立体声拓宽</div>
                        <button class="fx-toggle" :class="{ on: store.stereoWidenEnabled }" @click="store.stereoWidenEnabled = !store.stereoWidenEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">拉宽左右声道距离，歌曲显得更宏大</div>
                      <div v-show="store.stereoWidenEnabled" class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2"><span class="w-16 shrink-0 text-[12px] text-gray-600 dark:text-gray-300">拓宽量</span><input type="range" class="fx-slider" min="0" max="30" v-model.number="store.stereoWidenAmount"><span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ store.stereoWidenAmount.toFixed(1) }}</span></div>
                      </div>
                    </section>
                  </div>

                  <div class="space-y-3">
                    <!-- 单声道合并 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">单声道合并</div>
                        <button class="fx-toggle" :class="{ on: store.monoMergeEnabled }" @click="store.monoMergeEnabled = !store.monoMergeEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">将左右声道合并为单声道输出</div>
                    </section>

                    <!-- 左右声道交换 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">左右声道交换</div>
                        <button class="fx-toggle" :class="{ on: store.channelSwapEnabled }" @click="store.channelSwapEnabled = !store.channelSwapEnabled">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">交换左右声道，修正接反的耳机/音箱</div>
                    </section>

                    <!-- AB 对比 -->
                    <section class="rounded-xl border border-gray-200/70 bg-white/40 p-3 transition-all hover:border-[#EC4141]/40 dark:border-white/10 dark:bg-white/5">
                      <div class="flex items-center justify-between">
                        <div class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">AB 一键对比</div>
                        <button class="fx-toggle" :class="{ on: store.bypassAll }" @click="store.bypassAll = !store.bypassAll">
                          <span class="fx-toggle-knob"></span>
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">开启后旁通所有音效，方便判断效果是否正向</div>
                    </section>

                    <!-- 整套预设 -->
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

                    <!-- 重置所有 -->
                    <button class="w-full rounded-xl border border-gray-200/70 bg-white/40 py-2.5 text-[13px] font-medium text-[#EC4141] transition-all hover:border-[#EC4141]/40 hover:bg-white/60 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10" @click="handleResetAllAdvanced">重置所有高级音效</button>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* =========================================================================
   通用组件样式（Tailwind 工具类无法表达的伪元素/状态）
   主色：#EC4141（与项目 SettingsTheme 一致）
   ========================================================================= */

/* ===== 水平滑块（红色渐变轨道 + 红色 thumb） =====
   与 SettingsTheme.vue 的 .flow-slider 完全一致，保持项目滑块视觉统一 */
.fx-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.62));
  outline: none;
  cursor: pointer;
}

.fx-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.fx-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.fx-slider:active::-webkit-slider-thumb {
  transform: scale(1.35);
}

.fx-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}

/* 音调/速度滑块的进度条填充（中心对齐 100%） */
.fx-slider[style*="--pitch-progress"] {
  background: linear-gradient(to right,
    rgba(236, 65, 65, 0.5) 0%,
    rgba(236, 65, 65, 0.5) var(--pitch-progress, 50%),
    rgba(0, 0, 0, 0.08) var(--pitch-progress, 50%),
    rgba(0, 0, 0, 0.08) 100%);
}

:global(html.dark) .fx-slider[style*="--pitch-progress"] {
  background: linear-gradient(to right,
    rgba(236, 65, 65, 0.55) 0%,
    rgba(236, 65, 65, 0.55) var(--pitch-progress, 50%),
    rgba(255, 255, 255, 0.12) var(--pitch-progress, 50%),
    rgba(255, 255, 255, 0.12) 100%);
}

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

/* ===== 预设按钮 ===== */
.fx-preset-btn {
  font-size: 11px;
  padding: 4px 14px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  background: rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  color: #6b7280;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(html.dark) .fx-preset-btn {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #d1d5db;
}

.fx-preset-btn:hover {
  border-color: rgba(236, 65, 65, 0.4);
  color: #ec4141;
  background: rgba(255, 255, 255, 0.6);
  transform: translateY(-1px);
}

:global(html.dark) .fx-preset-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.fx-preset-btn:active {
  transform: translateY(0) scale(0.96);
}

.fx-preset-advanced {
  border-color: rgba(236, 65, 65, 0.25);
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}

/* ===== 模式选择按钮（单次/乒乓、软/硬失真等） ===== */
.fx-mode-btn {
  font-size: 11px;
  padding: 3px 14px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  background: rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  color: #6b7280;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  flex: 1;
}

:global(html.dark) .fx-mode-btn {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #d1d5db;
}

.fx-mode-btn:hover {
  border-color: rgba(236, 65, 65, 0.4);
  color: #ec4141;
}

.fx-mode-btn.active {
  background: #ec4141;
  border-color: #ec4141;
  color: #fff;
}

/* ===== 重置按钮 ===== */
.fx-reset-btn {
  font-size: 11px;
  padding: 2px 12px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  background: rgba(255, 255, 255, 0.4);
  border-radius: 5px;
  color: #ec4141;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

:global(html.dark) .fx-reset-btn {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
}

.fx-reset-btn:hover {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(255, 255, 255, 0.6);
}

:global(html.dark) .fx-reset-btn:hover {
  background: rgba(255, 255, 255, 0.1);
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

/* =========================================================================
   均衡器：10 段垂直推子
   ========================================================================= */
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

/* 0dB 中点参考线 */
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

/* 垂直 range 推子（writing-mode: vertical-lr + direction: rtl） */
.eq-fader-input {
  -webkit-appearance: none;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 6px;
  height: 140px;
  background: linear-gradient(to top, rgba(236, 65, 65, 0.15), rgba(236, 65, 65, 0.5));
  border-radius: 9999px;
  outline: none;
  cursor: pointer;
  position: relative;
  z-index: 1;
}

.eq-fader-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 10px;
  border-radius: 3px;
  background: #ec4141;
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.1s, box-shadow 0.15s;
}

.eq-fader-input::-webkit-slider-thumb:hover {
  transform: scaleY(1.15);
  box-shadow: 0 2px 6px rgba(236, 65, 65, 0.4);
}

.eq-fader-input:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: scaleY(1.25);
}

.eq-fader-input::-moz-range-thumb {
  width: 24px;
  height: 10px;
  border-radius: 3px;
  background: #ec4141;
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
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

/* =========================================================================
   动画
   ========================================================================= */

/* 标签页切换淡入 */
.eq-tab-wrapper {
  animation: eq-tab-enter 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes eq-tab-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 卡片 hover 微浮起 */
section[class*="rounded-xl"] {
  transition: border-color 0.25s ease, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease;
}

/* 减少动画（无障碍） */
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
