import { nextTick, onMounted, onUnmounted, ref } from 'vue';

/** 下拉定位偏好：最小宽 / 翻转阈值 / 最小高 / 最大高（像素）。 */
const PLACEMENT_PREFS = { minW: 300, flipBelow: 280, minH: 220, maxH: 420 } as const;

type PlacementPrefs = typeof PLACEMENT_PREFS;

/** 触发器矩形 → fixed 定位样式（优先向下，空间不足向上翻转）。 */
function placementOf(trigger: HTMLElement, prefs: PlacementPrefs): Record<string, string> {
  const rect = trigger.getBoundingClientRect();
  const margin = 16;
  const gap = 10;
  const width = Math.min(Math.max(rect.width, prefs.minW), window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - margin - width));
  const roomBelow = window.innerHeight - rect.bottom - margin;
  const roomAbove = rect.top - margin;
  const openUp = roomBelow < prefs.flipBelow && roomAbove > roomBelow;
  const cap = Math.max(prefs.minH, Math.min(prefs.maxH, (openUp ? roomAbove : roomBelow) - gap));
  const base = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(cap)}px`,
  } as Record<string, string>;
  return openUp
    ? { ...base, bottom: `${Math.round(window.innerHeight - rect.top + gap)}px` }
    : { ...base, top: `${Math.round(rect.bottom + gap)}px` };
}

/**
 * 配色方案下拉（Teleport 到 body 的浮层）：
 * 定位、开关、外部按下/Escape 关闭、视口变化跟随定位。
 */
export function useColorSchemeMenu() {
  const fieldRef = ref<HTMLElement | null>(null);
  const triggerRef = ref<HTMLElement | null>(null);
  const menuRef = ref<HTMLElement | null>(null);
  const open = ref(false);
  const style = ref<Record<string, string>>({});

  function relocate() {
    const trigger = triggerRef.value;
    if (trigger) style.value = placementOf(trigger, PLACEMENT_PREFS);
  }

  async function toggle() {
    open.value = !open.value;
    if (!open.value) return;

    await nextTick();
    relocate();
    const current = menuRef.value?.querySelector('.scm-item--current') as HTMLElement | null;
    current?.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    open.value = false;
  }

  function onPointerDown(event: MouseEvent) {
    const target = event.target as Node | null;
    if (!target) return;
    if (fieldRef.value?.contains(target)) return;
    if (menuRef.value?.contains(target)) return;
    close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close();
  }

  function onViewportShift() {
    if (open.value) relocate();
  }

  onMounted(() => {
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onViewportShift);
    document.addEventListener('scroll', onViewportShift, true);
  });

  onUnmounted(() => {
    window.removeEventListener('mousedown', onPointerDown);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onViewportShift);
    document.removeEventListener('scroll', onViewportShift, true);
  });

  return { fieldRef, triggerRef, menuRef, open, style, toggle, close };
}
