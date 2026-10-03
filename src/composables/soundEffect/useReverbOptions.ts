/*
 * 混响选项组合函数：环境混响（卷积）/ 算法混响的候选列表、激活态
 * 与切换逻辑。自 EqualizerPanel.vue 原样搬出，逻辑不变。
 */
import { computed } from 'vue';
import { convolutions, algorithmicReverbs } from '../../utils/audio/soundEffectEngine';
import { useSoundEffectStore } from '../../features/playback/soundEffectStore';

export function useReverbOptions() {
  const store = useSoundEffectStore();
  // ===== 混响选项 =====
  const reverbItems = convolutions.map(c => ({
    label: c.label,
    name: c.name,
    active: computed(() => !store.convIsCustom && store.activeConvolution === c.label),
  }));
  const customConvolutionActive = computed(() => store.convIsCustom && store.activeConvolution != null);
  // ===== 算法混响 =====
  const algoReverbItems = algorithmicReverbs.map(ar => ({
    label: ar.label,
    name: ar.name,
    active: computed(() => !store.algoIsCustom && store.activeAlgoReverb === ar.label),
  }));
  const customAlgoReverbActive = computed(() => store.algoIsCustom && store.activeAlgoReverb != null);

  const reverbNoneActive = computed(
    () => store.activeConvolution == null && store.activeAlgoReverb == null,
  );

  const handleReverbNone = () => {
    if (reverbNoneActive.value) return;
    store.activeAlgoReverb = null;
    store.activeConvolution = null;
    store.algoIsCustom = false;
    store.convIsCustom = false;
  };

  const handleReverbToggle = (label: string) => {
    store.toggleConvolution(label);
  };
  const handleAlgoReverbToggle = (label: string) => {
    store.toggleAlgoReverb(label);
  };

  const handleConvolutionCustom = () => {
    store.toggleConvolutionCustom();
  };

  const handleAlgoReverbCustom = () => {
    store.toggleAlgoReverbCustom();
  };

  const handleReverbGainInput = () => {
    store.markCustomReverbGain();
  };

  return {
    reverbItems,
    customConvolutionActive,
    algoReverbItems,
    customAlgoReverbActive,
    reverbNoneActive,
    handleReverbNone,
    handleReverbToggle,
    handleAlgoReverbToggle,
    handleConvolutionCustom,
    handleAlgoReverbCustom,
    handleReverbGainInput,
  };
}
