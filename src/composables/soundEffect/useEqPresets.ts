/*
 * 均衡器预设组合函数：内置/衍生预设套用、重置与自定义 EQ 预设保存。
 * 自 EqualizerPanel.vue 原样搬出，逻辑不变。
 */
import { ref } from 'vue';
import { useSoundEffectStore } from '../../features/playback/soundEffectStore';

export function useEqPresets() {
  const store = useSoundEffectStore();
  // ===== 均衡器 =====
  const handleApplyPreset = (name: string) => {
    store.applyPreset(name);
  };
  const handleResetEq = () => {
    store.resetEq();
  };
  // ===== 自定义 EQ 预设 =====
  const customPresetName = ref('');
  const handleSaveCustomPreset = () => {
    if (!customPresetName.value.trim()) return;
    store.saveCustomEqPreset(customPresetName.value.trim());
    customPresetName.value = '';
  };

  return {
    handleApplyPreset,
    handleResetEq,
    customPresetName,
    handleSaveCustomPreset,
  };
}
