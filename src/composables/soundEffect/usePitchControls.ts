/*
 * 音调/速度控制组合函数：升降调（百分比/半音双模式）、速度调节
 * 的进度与重置逻辑。自 EqualizerPanel.vue 原样搬出，逻辑不变。
 */
import { computed, ref } from 'vue';
import { useSoundEffectStore } from '../../features/playback/soundEffectStore';

export function usePitchControls() {
  const store = useSoundEffectStore();
  // ===== 音调/速度 =====
  const handleResetPitch = () => {
    store.resetPitch();
  };
  const handleResetPlaybackRate = () => {
    store.resetPlaybackRate();
  };
  const pitchProgress = computed(() => {
    return ((store.pitchShift - 50) / (200 - 50)) * 100;
  });
  const playbackRateProgress = computed(() => {
    return ((store.playbackRate - 50) / (200 - 50)) * 100;
  });
  // ===== 音调模式：百分比 / 半音 =====
  const pitchMode = ref<'percent' | 'semitone'>('percent');
  const SEMITONE_MIN = -12;
  const SEMITONE_MAX = 12;

  const pitchSemitones = computed({
    get: () => Math.round(12 * Math.log2(store.pitchShift / 100)),
    set: (n: number) => {
      store.pitchShift = Math.round(100 * Math.pow(2, n / 12));
    },
  });

  const semitoneProgress = computed(() => {
    return ((pitchSemitones.value - SEMITONE_MIN) / (SEMITONE_MAX - SEMITONE_MIN)) * 100;
  });

  const semitoneLabel = computed(() => {
    const n = pitchSemitones.value;
    if (n === 0) return '原调';
    return `${n > 0 ? '+' : ''}${n} 半音`;
  });

  return {
    handleResetPitch,
    handleResetPlaybackRate,
    pitchProgress,
    playbackRateProgress,
    pitchMode,
    SEMITONE_MIN,
    SEMITONE_MAX,
    pitchSemitones,
    semitoneProgress,
    semitoneLabel,
  };
}
