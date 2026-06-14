const RISE_SMOOTHING = 0.3;
const FALL_SMOOTHING = 0.15;

const clampLevel = (value: number) => Math.min(1, Math.max(0, value));

export const smoothVisualizerLevel = (previous: number, target: number) => {
  const safePrevious = clampLevel(previous);
  const safeTarget = clampLevel(target);
  const smoothing = safeTarget > safePrevious ? RISE_SMOOTHING : FALL_SMOOTHING;

  return clampLevel(safePrevious + (safeTarget - safePrevious) * smoothing);
};
