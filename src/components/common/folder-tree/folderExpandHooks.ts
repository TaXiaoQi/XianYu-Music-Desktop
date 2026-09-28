const SWAP_BEZIER = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';

export interface FolderExpandHooks {
  beforeEnter: (element: Element) => void;
  enter: (element: Element, done: () => void) => void;
  enterDone: (element: Element) => void;
  leave: (element: Element) => void;
  leaveDone: (element: Element) => void;
}

/**
 * JS transition hooks for expanding/collapsing a folder branch. Large
 * branches (many children) skip the height animation entirely.
 */
export function createFolderExpandHooks(animatable: () => boolean): FolderExpandHooks {
  const clearInlineFx = (el: HTMLElement) => {
    el.style.transition = '';
    el.style.height = '';
    el.style.opacity = '';
  };

  const beforeEnter = (element: Element) => {
    const el = element as HTMLElement;
    if (!animatable()) {
      el.style.height = 'auto';
      el.style.opacity = '1';
      return;
    }
    el.style.height = '0';
    el.style.opacity = '0';
  };

  const enter = (element: Element, done: () => void) => {
    const el = element as HTMLElement;
    if (!animatable()) {
      el.style.height = 'auto';
      el.style.opacity = '1';
      el.style.transition = '';
      done();
      return;
    }

    void el.offsetHeight; // flush layout so the height transition kicks in
    el.style.transition = SWAP_BEZIER;
    el.style.height = `${el.scrollHeight}px`;
    el.style.opacity = '1';

    const settle = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === 'height') {
        el.removeEventListener('transitionend', settle);
        done();
      }
    };
    el.addEventListener('transitionend', settle);
  };

  const enterDone = (element: Element) => {
    const el = element as HTMLElement;
    el.style.height = 'auto';
    el.style.opacity = '';
    el.style.transition = '';
  };

  const leave = (element: Element) => {
    const el = element as HTMLElement;
    if (!animatable()) {
      clearInlineFx(el);
      return;
    }
    el.style.height = `${el.offsetHeight}px`;
    void el.offsetHeight;
    requestAnimationFrame(() => {
      el.style.transition = SWAP_BEZIER;
      el.style.height = '0';
      el.style.opacity = '0';
    });
  };

  const leaveDone = (element: Element) => {
    clearInlineFx(element as HTMLElement);
  };

  return { beforeEnter, enter, enterDone, leave, leaveDone };
}
