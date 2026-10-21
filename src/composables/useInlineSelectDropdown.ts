import { nextTick, onMounted, onScopeDispose, ref } from 'vue';

/**
 * 设置页行内下拉（fixed 定位跟随触发按钮）：
 * 面板配合 Teleport 到 body 使用，规避设置分组 overflow-hidden 的裁切；
 * 同一时间互斥只开一个，点选项或点击外部后关闭。
 */
export function useInlineSelectDropdown() {
  const openId = ref<string | null>(null);
  const triggerEls = new Map<string, HTMLElement>();
  const panelRef = ref<HTMLElement | null>(null);
  const panelStyle = ref<Record<string, string>>({});

  const registerTrigger = (id: string, el: unknown) => {
    if (el instanceof HTMLElement) triggerEls.set(id, el);
    else triggerEls.delete(id);
  };

  const toggle = (id: string) => {
    openId.value = openId.value === id ? null : id;
    if (openId.value) {
      nextTick(updatePosition);
    }
  };

  const close = () => {
    openId.value = null;
  };

  function updatePosition() {
    const trigger = openId.value ? triggerEls.get(openId.value) : null;
    const panel = panelRef.value;
    if (!trigger || !panel) return;

    const rect = trigger.getBoundingClientRect();
    // 对齐设置页语言选择器标准：面板宽度跟随触发器（内容更宽时以内容为准，
    // 下限 176px 保证选项文字 + 对勾不换行），右缘与触发器对齐。
    // 宽度先取整再参与 left 计算：首次定位与后续重定位口径一致，避免面板轻微横移
    const panelWidth = Math.round(Math.max(rect.width, panel.offsetWidth, 176));
    const panelHeight = panel.offsetHeight;
    const gap = 6;
    const viewportPadding = 12;

    let left = rect.right - panelWidth;
    left = Math.min(Math.max(left, viewportPadding), window.innerWidth - panelWidth - viewportPadding);

    const fitsBelow = rect.bottom + gap + panelHeight <= window.innerHeight - viewportPadding;
    const top = fitsBelow
      ? rect.bottom + gap
      : Math.max(viewportPadding, rect.top - panelHeight - gap);

    panelStyle.value = {
      left: `${left}px`,
      top: `${top}px`,
      width: `${panelWidth}px`,
    };
  }

  function handleOutsideClick(event: MouseEvent) {
    if (!openId.value || !panelRef.value) return;
    const target = event.target as Node;
    if (panelRef.value.contains(target)) return;
    const trigger = triggerEls.get(openId.value);
    if (trigger?.contains(target)) return;
    openId.value = null;
  }

  function handleViewportChange(event?: Event) {
    if (!openId.value) return;
    // 面板自身内容滚动不重定位：捕获阶段会收到面板内部 scroll 事件，
    // 此时重定位会因滚动条出现/亚像素取整让面板整体轻微横移
    if (event?.target instanceof Node && panelRef.value?.contains(event.target)) return;
    updatePosition();
  }

  onMounted(() => {
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
  });

  onScopeDispose(() => {
    window.removeEventListener('mousedown', handleOutsideClick);
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange, true);
  });

  return { openId, panelRef, panelStyle, registerTrigger, toggle, close, reposition: updatePosition };
}
