<script lang="ts">
import type { InjectionKey } from 'vue';

/**
 * Injection key for overriding the tooltip z-index.
 * Used by parent containers (e.g. onboarding modal) that create high-z-index
 * stacking contexts, so the teleported tooltip isn't hidden behind them.
 */
export const SETTING_HINT_Z_INDEX: InjectionKey<number | undefined> = Symbol('setting-hint-z-index');
</script>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { CircleAlert } from 'lucide-vue-next';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  text: string;
  focusable?: boolean;
  severity?: 'info' | 'warning';
}>(), {
  focusable: true,
  severity: 'info',
});

const injectedZIndex = inject(SETTING_HINT_Z_INDEX, undefined);

const tooltipId = `setting-hint-${useId()}`;
const triggerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const isVisible = ref(false);
const tooltipStyle = ref<Record<string, string>>({});

const mergedTooltipStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = { ...tooltipStyle.value };
  if (injectedZIndex !== undefined) {
    style.zIndex = String(injectedZIndex);
  }
  return style;
});

function updatePosition() {
  const trigger = triggerRef.value;
  if (!trigger || !isVisible.value) return;

  const viewportPadding = 12;
  const gap = 8;
  const rect = trigger.getBoundingClientRect();
  const tooltipHeight = tooltipRef.value?.offsetHeight ?? 0;
  // Read actual rendered width (content-based via width: fit-content + max-width in CSS)
  const tooltipWidth = tooltipRef.value?.offsetWidth ?? 0;
  const centeredLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
  const left = Math.min(
    Math.max(centeredLeft, viewportPadding),
    Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding),
  );
  const fitsBelow = rect.bottom + gap + tooltipHeight <= window.innerHeight - viewportPadding;
  const top = fitsBelow || tooltipHeight === 0
    ? rect.bottom + gap
    : Math.max(viewportPadding, rect.top - tooltipHeight - gap);

  tooltipStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
  };
}

async function showTooltip() {
  isVisible.value = true;
  await nextTick();
  updatePosition();
}

function hideTooltip() {
  isVisible.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    hideTooltip();
    triggerRef.value?.blur();
  }
}

onMounted(() => {
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
});
</script>

<template>
  <span
    v-bind="$attrs"
    ref="triggerRef"
    class="setting-hint"
    :class="{ 'setting-hint--warning': props.severity === 'warning' }"
    :aria-label="props.text"
    :aria-describedby="isVisible ? tooltipId : undefined"
    :role="props.focusable ? 'button' : undefined"
    :tabindex="props.focusable ? 0 : undefined"
    @mouseenter="showTooltip"
    @mouseleave="hideTooltip"
    @focus="showTooltip"
    @blur="hideTooltip"
    @keydown="handleKeydown"
    @click.stop.prevent
  >
    <CircleAlert class="h-4 w-4" aria-hidden="true" />
  </span>

  <Teleport to="body">
    <Transition name="setting-hint-popover">
      <span
        v-if="isVisible"
        :id="tooltipId"
        ref="tooltipRef"
        class="setting-hint-popover"
        role="tooltip"
        :style="mergedTooltipStyle"
      >
        {{ props.text }}
      </span>
    </Transition>
  </Teleport>
</template>

<style scoped>
.setting-hint {
  display: inline-flex;
  height: 20px;
  width: 20px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #9ca3af;
  cursor: help;
  outline: none;
}

.setting-hint:focus-visible {
  box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.22);
}

.setting-hint--warning {
  color: #f59e0b;
}

.setting-hint--warning:focus-visible {
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
}

.setting-hint-popover {
  position: fixed;
  z-index: 300;
  pointer-events: none;
  width: fit-content;
  max-width: min(300px, calc(100vw - 24px));
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 12px;
  background: rgb(255, 255, 255);
  backdrop-filter: blur(8px);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.24);
  color: rgb(31 41 55);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
  padding: 10px 12px;
  white-space: normal;
}

.setting-hint-popover-enter-active,
.setting-hint-popover-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.setting-hint-popover-enter-from,
.setting-hint-popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

<style>
html.dark .setting-hint--warning {
  color: #fcd34d;
}

html.dark .setting-hint-popover {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgb(31, 31, 31);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.48);
  color: rgba(255, 255, 255, 0.92);
}
</style>
