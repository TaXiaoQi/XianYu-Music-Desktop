const ATTACK_RATIO = 0.3;
const RELEASE_RATIO = 0.15;

function confineToUnitInterval(level: number): number {
  if (level < 0) return 0;
  if (level > 1) return 1;
  return level;
}

export function smoothVisualizerLevel(previous: number, target: number): number {
  const nextLevel = confineToUnitInterval(previous);
  const goalLevel = confineToUnitInterval(target);
  const ratio = goalLevel > nextLevel ? ATTACK_RATIO : RELEASE_RATIO;

  return confineToUnitInterval(nextLevel + (goalLevel - nextLevel) * ratio);
}
