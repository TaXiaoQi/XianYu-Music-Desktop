import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

/** 侧边栏宽度持久化键（跨版本保持稳定，勿改名） */
const WIDTH_STORAGE_KEY = 'main_sidebar_width';

/** 拖拽宽度上限（逻辑像素） */
const WIDTH_CEILING = 360;

interface SidebarWidthResizerOptions {
  /** 界面是否处于英文语境（英文下限位与默认值更宽） */
  isEnglishUi: Ref<boolean>;
}

/**
 * 一级侧边栏宽度控制器：
 * 负责持久化读取、拖拽跟手、语言切换时的下限收敛与双击复位。
 */
export function useSidebarWidthResizer({ isEnglishUi }: SidebarWidthResizerOptions) {
  const floorWidth = computed(() => (isEnglishUi.value ? 210 : 180));
  const preferredWidth = computed(() => (isEnglishUi.value ? 210 : 192));

  const readStoredWidth = (): number | null => {
    try {
      const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  };

  const writeStoredWidth = (width: number) => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, width.toString());
    } catch {
      /* 存储不可用时静默降级为会话内宽度 */
    }
  };

  const clampWidth = (candidate: number) =>
    Math.min(WIDTH_CEILING, Math.max(floorWidth.value, candidate));

  const restoreWidth = (width: number) => {
    sidebarWidth.value = clampWidth(width);
    writeStoredWidth(sidebarWidth.value);
  };

  const sidebarWidth = ref(clampWidth(readStoredWidth() ?? preferredWidth.value));

  // 语言切换可能抬高下限：立即收敛并回写持久化
  watch(
    floorWidth,
    (floor) => {
      if (sidebarWidth.value < floor) {
        sidebarWidth.value = floor;
        writeStoredWidth(floor);
      }
    },
    { immediate: true },
  );

  const resizing = ref(false);
  let grabX = 0;
  let grabWidth = 0;

  const trackPointerMove = (event: PointerEvent) => {
    if (!resizing.value) {
      return;
    }
    sidebarWidth.value = clampWidth(grabWidth + (event.clientX - grabX));
  };

  const detachWindowListeners = () => {
    window.removeEventListener('pointermove', trackPointerMove);
    window.removeEventListener('pointerup', settleResize);
    window.removeEventListener('pointercancel', settleResize);
  };

  const settleResize = () => {
    if (!resizing.value) {
      return;
    }
    resizing.value = false;
    detachWindowListeners();
    writeStoredWidth(sidebarWidth.value);
  };

  const beginResize = (event: PointerEvent) => {
    event.preventDefault();
    resizing.value = true;
    grabX = event.clientX;
    grabWidth = sidebarWidth.value;
    window.addEventListener('pointermove', trackPointerMove);
    window.addEventListener('pointerup', settleResize);
    window.addEventListener('pointercancel', settleResize);
  };

  const resetToPreferredWidth = () => {
    restoreWidth(preferredWidth.value);
  };

  onBeforeUnmount(() => {
    settleResize();
  });

  return {
    sidebarWidth,
    resizing,
    beginResize,
    resetToPreferredWidth,
  };
}
