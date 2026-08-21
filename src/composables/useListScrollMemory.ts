import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, unref, watch, type Ref } from 'vue';
import { listScrollCache } from '../caches/imageCaches';

const RESTORE_MAX_ATTEMPTS = 120;

export function useListScrollMemory(
  keySource: string | Ref<string>,
  containerRef: Ref<HTMLElement | null>,
  options?: { disabled?: boolean },
) {
  const resolveKey = () => unref(keySource);
  /** 禁用滚动记忆（离开即销毁的容器）：不保存也不恢复，避免返回时继承旧滚动位置 */
  const isDisabled = () => options?.disabled ?? false;
  let attachedElement: HTMLElement | null = null;
  let keyChanged = false;

  const handleContainerScroll = () => {
    saveScrollPosition();
  };

  const detachScrollListener = () => {
    if (!attachedElement) {
      return;
    }

    attachedElement.removeEventListener('scroll', handleContainerScroll);
    attachedElement = null;
  };

  const attachScrollListener = () => {
    const element = containerRef.value;
    if (!element || attachedElement === element) {
      return;
    }

    detachScrollListener();
    element.addEventListener('scroll', handleContainerScroll, { passive: true });
    attachedElement = element;
  };

  const saveScrollPosition = (key = resolveKey()) => {
    if (isDisabled()) {
      return;
    }

    if (!key) {
      return;
    }

    if (!containerRef.value) {
      return;
    }

    listScrollCache.set(key, containerRef.value.scrollTop);
  };

  const restoreScrollPosition = async (key = resolveKey()) => {
    if (isDisabled()) {
      return;
    }

    if (!key) {
      return;
    }

    await nextTick();

    if (!containerRef.value) {
      return;
    }

    const savedTop = listScrollCache.get(key);
    if (savedTop === undefined) {
      return;
    }

    await new Promise<void>((resolve) => {
      let attempts = 0;

      const applyScrollPosition = () => {
        const element = containerRef.value;
        if (!element) {
          resolve();
          return;
        }

        if (savedTop > 0 && (element.clientHeight <= 0 || element.scrollHeight <= element.clientHeight)) {
          if (attempts >= RESTORE_MAX_ATTEMPTS) {
            resolve();
            return;
          }

          attempts += 1;
          requestAnimationFrame(applyScrollPosition);
          return;
        }

        element.scrollTop = savedTop;
        element.dispatchEvent(new Event('scroll'));

        if (Math.abs(element.scrollTop - savedTop) < 2 || attempts >= RESTORE_MAX_ATTEMPTS) {
          resolve();
          return;
        }

        attempts += 1;
        requestAnimationFrame(applyScrollPosition);
      };

      requestAnimationFrame(applyScrollPosition);
    });
  };

  onMounted(() => {
    attachScrollListener();
    void restoreScrollPosition();
  });

  onActivated(() => {
    attachScrollListener();
    void restoreScrollPosition();
  });

  onDeactivated(() => {
    if (!keyChanged) saveScrollPosition();
  });

  onBeforeUnmount(() => {
    if (!keyChanged) saveScrollPosition();
    detachScrollListener();
  });

  watch(containerRef, () => {
    attachScrollListener();
  });

  if (typeof keySource !== 'string') {
    watch(keySource, (newKey, oldKey) => {
      if (oldKey && oldKey !== newKey) {
        saveScrollPosition(oldKey);
        detachScrollListener();
        keyChanged = true;
      }

      if (!newKey || newKey === oldKey) {
        return;
      }

      void restoreScrollPosition(newKey);
    });
  }

  return {
    saveScrollPosition,
    restoreScrollPosition,
  };
}
