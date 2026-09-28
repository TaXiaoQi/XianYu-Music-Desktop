<script setup lang="ts">
import { computed, nextTick, ref, watch, type CSSProperties } from 'vue';

/**
 * 悬浮菜单外壳：负责 Teleport、弹出过渡、显示后自测尺寸、视口边缘翻转定位。
 * 视觉外观由 chromeClass 提供；dockedTo 传入触发元素时按“停靠子菜单”方式定位。
 */
const props = defineProps<{
  shown: boolean;
  atX: number;
  atY: number;
  chromeClass?: string;
  popName?: string;
  keepMetrics?: boolean;
  dockedTo?: HTMLElement | null;
}>();

const shell = ref<HTMLElement | null>(null);
const box = ref({ w: 0, h: 0 });

const SAFE_GAP = 8;
const DOCK_LIFT = -6;
const DOCK_GAP = 8;

watch(
  () => props.shown,
  async (on) => {
    if (!on) {
      if (!props.keepMetrics) {
        box.value = { w: 0, h: 0 };
      }
      return;
    }

    await nextTick();
    if (shell.value) {
      box.value = { w: shell.value.offsetWidth, h: shell.value.offsetHeight };
    }
  },
  { immediate: true },
);

const clamp = (value: number) => Math.max(SAFE_GAP, value);

// 停靠模式：贴触发元素右侧展开，横向放不下翻到左侧，纵向放不下贴底
const dockedPlace = (): CSSProperties => {
  const rect = props.dockedTo!.getBoundingClientRect();
  let top = rect.top + DOCK_LIFT;
  let left = rect.right + DOCK_GAP;
  let vOrigin = 'top';
  let hOrigin = 'left';

  if (left + box.value.w > window.innerWidth) {
    left = rect.left - box.value.w - DOCK_GAP;
    hOrigin = 'right';
  }

  if (top + box.value.h > window.innerHeight) {
    top = window.innerHeight - box.value.h - SAFE_GAP;
    vOrigin = 'bottom';
  }

  return {
    left: `${clamp(left)}px`,
    top: `${clamp(top)}px`,
    visibility: box.value.h === 0 ? 'hidden' : 'visible',
    transformOrigin: `${hOrigin} ${vOrigin}`,
  };
};

// 锚点模式：以 x/y 为起点，越界时向上/向左翻转
const anchoredPlace = (): CSSProperties => {
  let top = props.atY;
  let left = props.atX;
  let vOrigin = 'top';
  let hOrigin = 'left';

  if (top + box.value.h > window.innerHeight) {
    top = props.atY - box.value.h;
    vOrigin = 'bottom';
  }

  if (left + box.value.w > window.innerWidth) {
    left = props.atX - box.value.w;
    hOrigin = 'right';
  }

  return {
    left: `${clamp(left)}px`,
    top: `${clamp(top)}px`,
    visibility: box.value.h === 0 ? 'hidden' : 'visible',
    transformOrigin: `${hOrigin} ${vOrigin}`,
  };
};

const place = computed<CSSProperties>(() => {
  if (!props.shown) {
    return {};
  }
  return props.dockedTo ? dockedPlace() : anchoredPlace();
});

defineExpose({ shell });
</script>

<template>
  <Teleport to="body">
    <Transition v-if="popName" :name="popName" appear>
      <div
        v-if="shown"
        ref="shell"
        class="ctx-sheet"
        :class="chromeClass"
        :style="place"
        @contextmenu.prevent
      >
        <slot />
      </div>
    </Transition>
    <div
      v-else-if="shown"
      ref="shell"
      class="ctx-sheet"
      :class="chromeClass"
      :style="place"
      @contextmenu.prevent
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
/* 面板弹出 / 收起（popName 传入时生效） */
.ctx-pop-enter-active,
.ctx-pop-leave-active { will-change: opacity, transform; }
.ctx-pop-enter-active { animation: ctx-sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1); }
.ctx-pop-leave-active { animation: ctx-sheet-out 140ms cubic-bezier(0.4, 0, 0.2, 1); }

/* 条目随面板入场做错峰上浮 */
.ctx-pop-enter-active :deep(.ctx-row),
.ctx-pop-enter-active :deep(.ctx-sep),
.ctx-pop-enter-active :deep(.ctx-note) {
  animation: ctx-piece-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--row-lag, 0ms);
}

/* 菜单行基础观感（等价于旧版 tailwind 工具类组合） */
:deep(.ctx-row) {
  display: flex;
  align-items: center;
  margin: 0 0.375rem;
  padding: 0.625rem 1rem;
  border-radius: 12px;
  cursor: pointer;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
:deep(.ctx-row:hover:not(:disabled)) { background-color: rgba(15, 23, 42, 0.055); }
:deep(.ctx-row--button) { width: 100%; text-align: left; }
:deep(.ctx-row--alert) { color: #EC4141; }
:deep(.ctx-row--alert-drift:hover) { color: #d73a3a; }
:deep(.ctx-row--frozen) { opacity: 0.45; cursor: not-allowed; }

:deep(.ctx-sep) {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

@keyframes ctx-sheet-in {
  0% { opacity: 0; transform: translateY(10px) scale(0.965); }
  72% { opacity: 1; transform: translateY(-1px) scale(1.008); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes ctx-sheet-out {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(4px) scale(0.985); }
}

@keyframes ctx-piece-in {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
</style>
