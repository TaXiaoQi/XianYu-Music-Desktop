import { computed, shallowRef } from 'vue';
import { useSettingsStore } from '../features/settings/store';
import type { PerformanceMode } from '../types';

interface HardwareCapability {
  cores: number;
  memory: number;
  hasWebGL2: boolean;
}

let hardwareCache: HardwareCapability | null = null;

function detectHardwareCapability(): HardwareCapability {
  if (hardwareCache) return hardwareCache;

  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;

  const memory = typeof navigator !== 'undefined' && (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory!
    : 8;

  let hasWebGL2 = false;
  try {
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('webgl2');
    hasWebGL2 = !!ctx;
    const loseExt = ctx?.getExtension('WEBGL_lose_context');
    loseExt?.loseContext();
    probe.width = 0;
    probe.height = 0;
  } catch {
    hasWebGL2 = false;
  }

  hardwareCache = { cores, memory, hasWebGL2 };
  return hardwareCache;
}

function detectAutoMode(): 'low' | 'high' {
  const hw = detectHardwareCapability();
  if (hw.cores <= 4) return 'low';
  if (hw.memory <= 4) return 'low';
  if (!hw.hasWebGL2) return 'low';
  return 'high';
}

const autoDetectedMode = shallowRef<'low' | 'high' | null>(null);

function getAutoDetectedMode(): 'low' | 'high' {
  if (autoDetectedMode.value === null) {
    autoDetectedMode.value = detectAutoMode();
  }
  return autoDetectedMode.value;
}

export function usePerformanceMode() {
  const settingsStore = useSettingsStore();

  const selectedMode = computed<PerformanceMode>(() =>
    (settingsStore.settings as { performanceMode?: PerformanceMode })?.performanceMode ?? 'auto',
  );

  const autoLow = computed<'low' | 'high'>(() => getAutoDetectedMode());

  const effectiveMode = computed<'low' | 'high'>(() => {
    switch (selectedMode.value) {
      case 'full':
        return 'high';
      case 'performance':
        return 'low';
      case 'auto':
      default:
        return autoLow.value;
    }
  });

  const isLowPerformance = computed(() => effectiveMode.value === 'low');
  const isHighPerformance = computed(() => effectiveMode.value === 'high');

  const hardwareCapability = computed<HardwareCapability>(() => detectHardwareCapability());

  return {
    selectedMode,
    isAutoLowPerformance: computed(() => autoLow.value === 'low'),
    effectiveMode,
    isLowPerformance,
    isHighPerformance,
    hardwareCapability,
  };
}
