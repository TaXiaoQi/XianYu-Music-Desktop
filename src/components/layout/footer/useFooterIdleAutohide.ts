import { computed, ref, watch, type Ref } from 'vue';

interface IdleAutohideDeps {
  isShowingDetail: Ref<boolean>;
  isMvVideoActive: Ref<boolean>;
  isLowPower: Ref<boolean>;
  isMarqueePaused: Ref<boolean>;
  /** 右键菜单/拖拽/音量滑块等外部占用；为 true 时推迟进入 idle。 */
  isExternallyBusy: () => boolean;
}

/**
 * 底栏 idle 自动隐藏与固定：底栏态与详情态各自维护 idle/pin，
 * 2000ms 无操作后收起，鼠标进出与详情开关重置计时。
 */
export const useFooterIdleAutohide = ({
  isShowingDetail,
  isMvVideoActive,
  isLowPower,
  isMarqueePaused,
  isExternallyBusy,
}: IdleAutohideDeps) => {
  const isPinnedFooter = ref(localStorage.getItem('footer_pinned') !== 'false');
  const isPinnedDetail = ref(localStorage.getItem('footer_pinned_detail') === 'true');
  const isPinned = computed(() => isShowingDetail.value ? isPinnedDetail.value : isPinnedFooter.value);

  const isIdleFooter = ref(false);
  const isIdleDetail = ref(false);
  const isIdle = computed(() => isShowingDetail.value ? isIdleDetail.value : isIdleFooter.value);
  const isMvCollapsed = computed(() =>
    Boolean(isShowingDetail.value && isMvVideoActive.value && isIdle.value),
  );
  const isMarqueeAnimationPaused = computed(() =>
    isMarqueePaused.value || isIdle.value || isLowPower.value
  );
  let idleTimer: any = null;

  const clearIdle = () => {
    if (isShowingDetail.value) {
      isIdleDetail.value = false;
    } else {
      isIdleFooter.value = false;
    }
  };

  const togglePin = () => {
    if (isShowingDetail.value) {
      isPinnedDetail.value = !isPinnedDetail.value;
      localStorage.setItem('footer_pinned_detail', isPinnedDetail.value.toString());
      if (!isPinnedDetail.value) {
        startIdleTimer();
      } else {
        isIdleDetail.value = false;
        if (idleTimer) clearTimeout(idleTimer);
      }
    } else {
      isPinnedFooter.value = !isPinnedFooter.value;
      localStorage.setItem('footer_pinned', isPinnedFooter.value.toString());
      if (!isPinnedFooter.value) {
        startIdleTimer();
      } else {
        isIdleFooter.value = false;
        if (idleTimer) clearTimeout(idleTimer);
      }
    }
  };

  const startIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (isExternallyBusy() || isPinned.value) return;

    idleTimer = setTimeout(() => {
      if (isShowingDetail.value) {
        isIdleDetail.value = true;
      } else {
        isIdleFooter.value = true;
      }
    }, 2000);
  };

  const isPointerOverFooter = ref(false);

  const handleFooterMouseEnter = () => {
    isPointerOverFooter.value = true;
    clearIdle();
    if (idleTimer) clearTimeout(idleTimer);
  };

  const handleFooterMouseMove = () => {
    if (isIdle.value) clearIdle();
    if (idleTimer) clearTimeout(idleTimer);
  };

  const handleFooterMouseLeave = () => {
    isPointerOverFooter.value = false;
    startIdleTimer();
  };

  watch(isShowingDetail, () => {
    clearIdle();
    if (idleTimer) clearTimeout(idleTimer);
    startIdleTimer();
  });

  const disposeIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
  };

  return {
    isPinned,
    isIdle,
    isMvCollapsed,
    isMarqueeAnimationPaused,
    clearIdle,
    togglePin,
    startIdleTimer,
    isPointerOverFooter,
    handleFooterMouseEnter,
    handleFooterMouseMove,
    handleFooterMouseLeave,
    disposeIdle,
  };
};
