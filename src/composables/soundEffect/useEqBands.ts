/*
 * 均衡器频段元信息组合函数：频段常量与增益展示格式化。
 * 自 EqualizerPanel.vue 原样搬出，逻辑不变。
 * 频段顺序与 store.eqBands / Rust EQ_FREQUENCIES 一致。
 */
export function useEqBands() {
  // ===== 均衡器频段元信息（顺序与 store.eqBands / Rust EQ_FREQUENCIES 一致） =====
  const EQ_BANDS: ReadonlyArray<{ key: string; freq: string }> = [
    { key: '31', freq: '31' },
    { key: '62', freq: '62' },
    { key: '125', freq: '125' },
    { key: '250', freq: '250' },
    { key: '500', freq: '500' },
    { key: '1k', freq: '1k' },
    { key: '2k', freq: '2k' },
    { key: '4k', freq: '4k' },
    { key: '8k', freq: '8k' },
    { key: '16k', freq: '16k' },
  ];
  const formatBandGain = (v: number) => (v > 0 ? `+${v}` : `${v}`);

  return { EQ_BANDS, formatBandGain };
}
