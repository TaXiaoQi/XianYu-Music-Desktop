<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Cast, Loader2, MonitorPlay, RefreshCw, Speaker, Tv, X } from 'lucide-vue-next';

import { useDlnaCastStore } from '../../features/playback/castStore';
import { useToast } from '../../composables/toast';

/**
 * DLNA 投屏设备弹窗。
 * - 未连接：扫描局域网 DLNA 渲染器，点击设备连接（连接后由播放链路自动投歌）。
 * - 已连接：显示当前设备与连接状态，支持断开（向电视发送 Stop）。
 */
const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

const castStore = useDlnaCastStore();
const { showToast } = useToast();

const isScanning = ref(false);
const connectingUdn = ref('');

const connected = computed(() => castStore.isCasting && castStore.device !== null);

const deviceIcon = (modelName: string) => {
  const name = modelName.toLowerCase();
  if (/tv|television|tvbox|projector|投/.test(name)) return Tv;
  if (/speaker|audio|sound|音箱|音响/.test(name)) return Speaker;
  return MonitorPlay;
};

const scan = async (timeoutMs = 2500) => {
  if (isScanning.value) return;
  isScanning.value = true;
  try {
    const list = await castStore.scanDevices(timeoutMs);
    if (list.length === 0) {
      // AP 隔离/访客网络下发现必败：短超时二次探测兜底
      const retry = await castStore.scanDevices(3000).catch(() => []);
      if (retry.length === 0) {
        showToast('未发现 DLNA 设备，请确认设备与本机在同一局域网', 'info');
      }
    }
  } catch (e) {
    console.warn('[dlna] 设备扫描失败:', e);
    showToast('设备扫描失败，请检查防火墙设置', 'error');
  } finally {
    isScanning.value = false;
  }
};

const connect = async (udn: string) => {
  const dev = castStore.devices.find(d => d.udn === udn);
  if (!dev || connectingUdn.value) return;
  connectingUdn.value = udn;
  try {
    await castStore.connect(dev);
    showToast(`已连接「${dev.friendly_name}」，播放歌曲即可投屏`, 'success');
  } catch (e) {
    console.warn('[dlna] 连接失败:', e);
    showToast(`连接「${dev.friendly_name}」失败`, 'error');
  } finally {
    connectingUdn.value = '';
  }
};

const disconnect = async () => {
  try {
    await castStore.disconnect(true);
    showToast('已断开投屏', 'info');
  } catch {
    showToast('断开投屏失败', 'error');
  }
};

const close = () => emit('update:visible', false);

watch(
  () => props.visible,
  (visible) => {
    if (visible && !connected.value && castStore.devices.length === 0) {
      void scan();
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <!-- 遮罩 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        @click="close"
      ></div>

      <!-- 弹窗卡片 -->
      <div
        class="relative bg-white/85 dark:bg-zinc-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all duration-300 border border-white/20 ring-1 ring-black/5 dark:border-white/10"
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between px-5 pt-4 pb-2">
          <div class="flex items-center gap-2">
            <Cast class="h-4 w-4 text-[#EC4141]" />
            <h3 class="text-[15px] font-bold text-gray-900 dark:text-white leading-6">DLNA 投屏</h3>
          </div>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- 已连接态 -->
        <div v-if="connected && castStore.device" class="px-5 pb-2">
          <div class="rounded-xl border border-[#EC4141]/20 bg-[#EC4141]/5 p-4">
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center w-10 h-10 rounded-full bg-[#EC4141]/10 shrink-0">
                <component :is="deviceIcon(castStore.device.model_name)" class="h-5 w-5 text-[#EC4141]" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {{ castStore.device.friendly_name }}
                </div>
                <div class="text-[11px] text-gray-500 dark:text-white/45 truncate">
                  {{ castStore.device.model_name || 'DLNA 设备' }}
                  <span v-if="castStore.tvState === 'PLAYING'" class="text-[#EC4141]"> · 播放中</span>
                  <span v-else-if="castStore.tvState === 'PAUSED_PLAYBACK'" class="text-amber-500"> · 已暂停</span>
                </div>
              </div>
            </div>
            <button
              class="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200/60 bg-white/60 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-[#EC4141]/40 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:text-[#EC4141]"
              @click="disconnect"
            >
              断开投屏
            </button>
          </div>
          <p class="mt-2 px-1 text-[11px] leading-4 text-gray-400 dark:text-white/35">
            连接后本端播放将自动投到设备，播放/暂停/进度/音量即遥控该设备。
          </p>
        </div>

        <!-- 未连接态：设备列表 -->
        <div v-else class="px-5 pb-4">
          <div class="flex items-center justify-between py-2">
            <span class="text-xs text-gray-500 dark:text-white/45">局域网设备</span>
            <button
              class="flex items-center gap-1 text-xs text-gray-500 hover:text-[#EC4141] dark:text-white/50 dark:hover:text-[#EC4141] transition-colors disabled:opacity-50"
              :disabled="isScanning"
              @click="scan()"
            >
              <RefreshCw class="h-3.5 w-3.5" :class="isScanning ? 'animate-spin' : ''" />
              重新扫描
            </button>
          </div>

          <div class="max-h-64 overflow-y-auto custom-scrollbar space-y-1.5">
            <div
              v-if="isScanning && castStore.devices.length === 0"
              class="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-white/35"
            >
              <Loader2 class="h-6 w-6 animate-spin mb-2" />
              <span class="text-xs">正在扫描局域网设备…</span>
            </div>
            <div
              v-else-if="castStore.devices.length === 0"
              class="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-white/35"
            >
              <Cast class="h-6 w-6 mb-2" />
              <span class="text-xs text-center leading-5">未发现设备<br/>请确认电视/音箱已开启 DLNA 且与本机同一网络</span>
            </div>
            <button
              v-for="dev in castStore.devices"
              :key="dev.udn"
              class="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
              :class="connectingUdn === dev.udn
                ? 'border-[#EC4141]/30 bg-[#EC4141]/5'
                : 'border-gray-200/50 bg-white/40 hover:border-[#EC4141]/30 hover:bg-white/70 dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10'"
              :disabled="!!connectingUdn"
              @click="connect(dev.udn)"
            >
              <div class="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 dark:bg-white/8 shrink-0">
                <component
                  :is="deviceIcon(dev.model_name)"
                  class="h-4.5 w-4.5 text-gray-500 dark:text-white/50"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium text-gray-800 dark:text-white/85 truncate">
                  {{ dev.friendly_name }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-white/35 truncate">
                  {{ dev.model_name || 'DLNA 设备' }}
                </div>
              </div>
              <Loader2 v-if="connectingUdn === dev.udn" class="h-4 w-4 animate-spin text-[#EC4141]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
