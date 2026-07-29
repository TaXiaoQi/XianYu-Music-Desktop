import { computed, shallowRef } from 'vue';

/**
 * 硬件能力检测结果（进程内单例缓存，避免重复探测）。
 *
 * [修复防御]: 探测逻辑只在首次调用时执行一次，结果用 shallowRef 缓存。
 * 老旧硬件判定标准（任一命中即视为低性能）：
 * 1. navigator.hardwareConcurrency <= 4（双核/4核老 CPU）
 * 2. WebGL2 不可用（集显驱动过旧）
 * 3. navigator.deviceMemory <= 4（4GB 以下内存）
 */
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
    // [修复防御]: 用临时 canvas 探测 WebGL2，探测后立即释放上下文与 canvas，避免 GPU 资源泄漏
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('webgl2');
    hasWebGL2 = !!ctx;
    // 显式释放上下文（部分老驱动需要）
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

/**
 * 根据硬件能力判定是否应进入低性能模式。
 *
 * 判定规则（保守策略，对老旧硬件更友好）：
 * - cores <= 4 → low（覆盖 Win10 最低配置的双核/4核 CPU）
 * - memory <= 4 → low（4GB 以下内存）
 * - !hasWebGL2 → low（集显驱动不支持 WebGL2，backdrop-blur 与 WebGL 渲染会软件回退）
 * - 否则 → high
 */
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

/**
 * 性能模式 composable。
 *
 * 返回：
 * - effectiveMode: 根据硬件能力自动检测出的实际模式（low/high）
 * - isLowPerformance: 是否处于低性能模式（渲染降级判断用）
 * - isHighPerformance: 是否处于高性能模式
 * - hardwareCapability: 硬件能力详情（用于设置页展示）
 */
export function usePerformanceMode() {
  // 当前项目尚未接入手动性能模式设置及对应的 Rust IPC，使用真实可用的硬件自动检测。
  const effectiveMode = computed<'low' | 'high'>(() => getAutoDetectedMode());

  const isLowPerformance = computed(() => effectiveMode.value === 'low');
  const isHighPerformance = computed(() => effectiveMode.value === 'high');

  const hardwareCapability = computed<HardwareCapability>(() => detectHardwareCapability());

  return {
    effectiveMode,
    isLowPerformance,
    isHighPerformance,
    hardwareCapability,
  };
}
