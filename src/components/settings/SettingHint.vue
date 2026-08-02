<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
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

const tooltipId = `setting-hint-${useId()}`;
const triggerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const isVisible = ref(false);
const tooltipStyle = ref<Record<string, string>>({});

function updatePosition() {
  const trigger = triggerRef.value;
  if (!trigger || !isVisible.value) return;

  const viewportPadding = 12;
  const gap = 8;
  const rect = trigger.getBoundingClientRect();
  const tooltipWidth = Math.min(300, window.innerWidth - viewportPadding * 2);
  const tooltipHeight = tooltipRef.value?.offsetHeight ?? 0;
  const centeredLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
  const left = Math.min(
    Math.max(centeredLeft, viewportPadding),
    window.innerWidth - tooltipWidth - viewportPadding,
  );
  const fitsBelow = rect.bottom + gap + tooltipHeight <= window.innerHeight - viewportPadding;
  const top = fitsBelow || tooltipHeight === 0
    ? rect.bottom + gap
    : Math.max(viewportPadding, rect.top - tooltipHeight - gap);

  tooltipStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${tooltipWidth}px`,
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
        :style="tooltipStyle"
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

:global(.dark) .setting-hint {
  color: #9ca3af;
}

.setting-hint--warning {
  color: #f59e0b;
}

.setting-hint--warning:focus-visible {
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
}

:global(.dark) .setting-hint--warning {
  color: #fcd34d;
}

.setting-hint-popover {
  position: fixed;
  z-index: 300;
  pointer-events: none;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  color: rgb(31 41 55);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
  padding: 10px 12px;
  white-space: normal;
}

:global(.dark) .setting-hint-popover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
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
