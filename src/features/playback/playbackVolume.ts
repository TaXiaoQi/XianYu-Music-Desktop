export interface PlaybackVolumeDeps {
  setBackendVolume: (volume: number) => Promise<void>;
  setManagedTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearManagedTimeout: (timerId: ReturnType<typeof setTimeout>) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
}

export interface PlaybackVolumeController {
  getCurrentVolume: () => number;
  setCurrentVolume: (volume: number) => void;
  cancelFade: () => void;
  fadeTo: (targetVolume: number, durationMs: number, startVolumeOverride?: number) => Promise<void>;
  clearRestoreTimer: () => void;
  scheduleBackendRestore: (restoreVolume: number, shouldRestore?: () => boolean) => void;
  dispose: () => void;
}

const clampVolume = (volume: number) => Math.max(0, Math.min(1, volume));

export function createPlaybackVolumeController(deps: PlaybackVolumeDeps): PlaybackVolumeController {
  const requestFrame = deps.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame = deps.cancelFrame ?? ((frameId: number) => cancelAnimationFrame(frameId));
  let currentVolume = 1;
  let fadeFrameId: number | null = null;
  let fadeResolve: (() => void) | null = null;
  let restoreTimerId: ReturnType<typeof setTimeout> | null = null;
  let restoreToken = 0;

  const cancelFade = () => {
    if (fadeFrameId !== null) {
      cancelFrame(fadeFrameId);
      fadeFrameId = null;
    }
    if (fadeResolve) {
      const resolve = fadeResolve;
      fadeResolve = null;
      resolve();
    }
  };

  const fadeTo = (targetVolume: number, durationMs: number, startVolumeOverride?: number) => new Promise<void>((resolve) => {
    cancelFade();
    const startVolume = startVolumeOverride ?? currentVolume;
    const target = clampVolume(targetVolume);
    if (Math.abs(startVolume - target) < 0.005 || durationMs <= 0) {
      currentVolume = target;
      void deps.setBackendVolume(target).catch(() => {});
      resolve();
      return;
    }

    const startTime = performance.now();
    const isFadeIn = target > startVolume;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = isFadeIn ? progress * progress : 1 - (1 - progress) * (1 - progress);
      currentVolume = startVolume + (target - startVolume) * eased;
      void deps.setBackendVolume(currentVolume).catch(() => {});
      if (progress < 1) {
        fadeFrameId = requestFrame(step);
      } else {
        fadeFrameId = null;
        fadeResolve = null;
        currentVolume = target;
        void deps.setBackendVolume(target).catch(() => {});
        resolve();
      }
    };

    fadeResolve = resolve;
    fadeFrameId = requestFrame(step);
  });

  const clearRestoreTimer = () => {
    restoreToken += 1;
    if (restoreTimerId !== null) {
      deps.clearManagedTimeout(restoreTimerId);
      restoreTimerId = null;
    }
  };

  const scheduleBackendRestore = (restoreVolume: number, shouldRestore?: () => boolean) => {
    clearRestoreTimer();
    const token = ++restoreToken;
    restoreTimerId = deps.setManagedTimeout(() => {
      restoreTimerId = null;
      if (token !== restoreToken || (shouldRestore && !shouldRestore())) return;
      currentVolume = clampVolume(restoreVolume);
      void deps.setBackendVolume(currentVolume).catch(() => {});
    }, 200);
  };

  const dispose = () => {
    cancelFade();
    clearRestoreTimer();
  };

  return {
    getCurrentVolume: () => currentVolume,
    setCurrentVolume: (volume) => { currentVolume = clampVolume(volume); },
    cancelFade,
    fadeTo,
    clearRestoreTimer,
    scheduleBackendRestore,
    dispose,
  };
}
