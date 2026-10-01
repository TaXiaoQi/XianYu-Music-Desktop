export const createPlaybackTimers = () => {
  const timerIds = new Set<ReturnType<typeof setTimeout>>();

  const setManagedTimeout = (callback: () => void, delay: number) => {
    const timerId = setTimeout(() => {
      timerIds.delete(timerId);
      callback();
    }, delay);
    timerIds.add(timerId);
    return timerId;
  };

  const clearManagedTimeout = (timerId: ReturnType<typeof setTimeout>) => {
    timerIds.delete(timerId);
    clearTimeout(timerId);
  };

  const clearManagedShortTimers = () => {
    timerIds.forEach(timerId => clearTimeout(timerId));
    timerIds.clear();
  };

  return { setManagedTimeout, clearManagedTimeout, clearManagedShortTimers };
};
