<script setup lang="ts">
/*
 * 音效设置面板（弹窗外壳 + 标签页导航）。
 * 对外接口保持不变：props.visible / emits('update:visible')。
 * 各标签页内容原样拆分至 ./eq/ 子组件；业务逻辑拆分至
 * src/composables/soundEffect/ 下的组合函数。
 */
import { ref } from 'vue';
import ReverbTab from './eq/ReverbTab.vue';
import PitchTab from './eq/PitchTab.vue';
import EqTab from './eq/EqTab.vue';
import FxTab from './eq/FxTab.vue';
import ProTab from './eq/ProTab.vue';

defineProps<{
  visible: boolean;
}>();
const emit = defineEmits(['update:visible']);
// ===== 标签页 =====
const activeTab = ref<'reverb' | 'pitch' | 'eq' | 'fx' | 'pro'>('reverb');
const tabs = [
  { id: 'reverb', name: '混响' },
  { id: 'pitch', name: '音调变速' },
  { id: 'eq', name: '均衡器' },
  { id: 'fx', name: '音效' },
  { id: 'pro', name: '专业' },
] as const;
// ===== 关闭 =====
const handleClose = () => {
  emit('update:visible', false);
};
</script>
<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div v-if="visible" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="handleClose">
        <div class="modal-content flex h-[70vh] w-[920px] flex-col overflow-hidden rounded-2xl bg-white/95 shadow-2xl ring-1 ring-black/5 dark:bg-[#262626]/95 dark:ring-white/10">
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
          <div class="custom-scrollbar flex-1 overflow-y-auto p-6">
            <div :key="activeTab" class="eq-tab-wrapper">
              <!-- 各标签页内容已原样拆分至 ./eq/ 下的子组件 -->
              <ReverbTab v-show="activeTab === 'reverb'" />
              <PitchTab v-show="activeTab === 'pitch'" />
              <EqTab v-show="activeTab === 'eq'" />
              <FxTab v-show="activeTab === 'fx'" />
              <ProTab v-show="activeTab === 'pro'" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>
/* ===== 标签页切换动画 ===== */
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
