/*
 * 整套音效预设组合函数：整套预设保存与"重置所有高级音效"。
 * 自 EqualizerPanel.vue 原样搬出，逻辑不变。
 */
import { ref } from 'vue';
import { useSoundEffectStore } from '../../features/playback/soundEffectStore';

export function useFullEffectPresets() {
  const store = useSoundEffectStore();
  // ===== 整套预设 =====
  const fullPresetName = ref('');
  const handleSaveFullPreset = () => {
    if (!fullPresetName.value.trim()) return;
    store.saveFullEffectPreset(fullPresetName.value.trim());
    fullPresetName.value = '';
  };
  // ===== 重置所有高级效果 =====
  const handleResetAllAdvanced = () => {
    store.resetAllAdvanced();
  };

  return {
    fullPresetName,
    handleSaveFullPreset,
    handleResetAllAdvanced,
  };
}
