import type { CSSProperties } from 'vue';

// 菜单条目入场动画的错峰步长（毫秒），step 为条目在整份菜单中的序号
const STAGGER_UNIT_MS = 14;

export const rowLag = (step: number): CSSProperties =>
  ({ '--row-lag': `${step * STAGGER_UNIT_MS}ms` } as CSSProperties);
