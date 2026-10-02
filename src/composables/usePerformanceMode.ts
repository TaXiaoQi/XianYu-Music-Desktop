import { computed, shallowRef } from 'vue';
import { useSettingsStore } from '../features/settings/store';
import type { PerformanceMode } from '../types';
interface HardwareCapability { // 实现
  cores: number; // 实现
  memory: number; // 实现
  hasWebGL2: boolean; // 实现
} // 实现
let hardwareCache: HardwareCapability | null = null; // 实现
function detectHardwareCapability(): HardwareCapability { // 实现
  if (hardwareCache) return hardwareCache; // 实现
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency // 实现
    ? navigator.hardwareConcurrency // 实现
    : 4; // 实现
  const memory = typeof navigator !== 'undefined' && (navigator as Navigator & { deviceMemory?: number }).deviceMemory // 实现
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory! // 实现
    : 8; // 实现
  let hasWebGL2 = false; // 实现
  try { // 实现
    const probe = document.createElement('canvas'); // 实现
    const ctx = probe.getContext('webgl2'); // 实现
    hasWebGL2 = !!ctx; // 实现
    const loseExt = ctx?.getExtension('WEBGL_lose_context'); // 实现
    loseExt?.loseContext(); // 实现
    probe.width = 0; // 实现
    probe.height = 0; // 实现
  } catch { // 实现
    hasWebGL2 = false; // 实现
  } // 实现
  hardwareCache = { cores, memory, hasWebGL2 }; // 实现
  return hardwareCache; // 实现
} // 实现
function detectAutoMode(): 'low' | 'high' { // 实现
  const hw = detectHardwareCapability(); // 实现
  if (hw.cores <= 4) return 'low'; // 实现
  if (hw.memory <= 4) return 'low'; // 实现
  if (!hw.hasWebGL2) return 'low'; // 实现
  return 'high'; // 实现
} // 实现
const autoDetectedMode = shallowRef<'low' | 'high' | null>(null); // 实现
function getAutoDetectedMode(): 'low' | 'high' { // 实现
  if (autoDetectedMode.value === null) { // 实现
    autoDetectedMode.value = detectAutoMode(); // 实现
  } // 实现
  return autoDetectedMode.value; // 实现
} // 实现
export function usePerformanceMode() { // 实现
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
  const isLowPerformance = computed(() => effectiveMode.value === 'low'); // 实现
  const isHighPerformance = computed(() => effectiveMode.value === 'high'); // 实现
  const hardwareCapability = computed<HardwareCapability>(() => detectHardwareCapability()); // 实现
  return { // 实现
    selectedMode,
    isAutoLowPerformance: computed(() => autoLow.value === 'low'),
    effectiveMode, // 实现
    isLowPerformance, // 实现
    isHighPerformance, // 实现
    hardwareCapability, // 实现
  }; // 实现
} // 实现
