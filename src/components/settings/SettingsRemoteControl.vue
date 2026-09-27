<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { useDesktopLinkStore } from '../../features/playback/desktopLinkStore';
import {
  desktopLinkApi,
  type ControlChannelStatus,
} from '../../services/tauri/desktopLinkApi';

const desktopLink = useDesktopLinkStore();

const status = ref<ControlChannelStatus | null>(null);
const busy = ref(false);

// 配对码剩余秒数（本地倒计时，来源于 status / refresh 返回值）
const expiresIn = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const enabled = computed(() => status.value?.enabled ?? false);
const address = computed(() => {
  const st = status.value;
  if (!st || !st.running || !st.lanIp) return '';
  return `${st.lanIp}:${st.port}`;
});
const pairingCode = computed(() => (expiresIn.value > 0 ? status.value?.pairingCode ?? '' : ''));
const connectedNames = computed(() =>
  desktopLink.connectedClients.map((c) => c.name).join('、'),
);

function startCountdown(seconds: number): void {
  expiresIn.value = Math.max(0, seconds);
  if (!countdownTimer) {
    countdownTimer = setInterval(() => {
      if (expiresIn.value > 0) expiresIn.value -= 1;
      if (expiresIn.value <= 0 && countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }, 1000);
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const st = await desktopLinkApi.status();
    status.value = st;
    if (st.pairingCode && st.pairingExpiresIn > 0) {
      startCountdown(st.pairingExpiresIn);
    } else {
      expiresIn.value = 0;
    }
  } catch {
    /* 控制通道未初始化时忽略 */
  }
}

async function toggleEnabled(): Promise<void> {
  if (busy.value || !status.value) return;
  busy.value = true;
  const next = !enabled.value;
  try {
    await desktopLinkApi.setEnabled(next);
    await refreshStatus();
  } catch (e) {
    console.warn('[desktop-link] 切换开关失败:', e);
  } finally {
    busy.value = false;
  }
}

async function newPairingCode(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const info = await desktopLinkApi.refreshPairingCode();
    if (status.value) status.value.pairingCode = info.pairingCode;
    startCountdown(info.expiresIn);
  } catch (e) {
    console.warn('[desktop-link] 生成配对码失败:', e);
  } finally {
    busy.value = false;
  }
}

function formatPairedAt(unixSecs: number): string {
  if (!unixSecs) return '';
  try {
    return new Date(unixSecs * 1000).toLocaleDateString();
  } catch {
    return '';
  }
}

async function forgetDevice(token: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await desktopLinkApi.forgetDevice(token);
    await refreshStatus();
  } catch (e) {
    console.warn('[desktop-link] 忘记设备失败:', e);
  } finally {
    busy.value = false;
  }
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

onMounted(() => {
  void refreshStatus();
});

onBeforeUnmount(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
});
</script>

<template>
  <section class="space-y-3">
    <div>
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        移动端遥控
      </h2>
      <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
        允许同一局域网内的弦予手机版遥控本机播放（切歌、进度、音量），状态实时同步，比 DLNA 投送更流畅；DLNA 通道仍保留用于第三方应用。
      </p>
    </div>

    <section class="rounded-xl border border-gray-200/40 bg-white/20 p-5 dark:border-gray-800/40 dark:bg-black/10">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">允许移动端遥控</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/35">
            {{ enabled
              ? (address
                ? `运行中 · 地址 ${address}`
                : '运行中（未获取到局域网地址）')
              : '未开启' }}
          </div>
        </div>
        <button
          type="button"
          class="glass-switch"
          :class="{ 'is-checked': enabled }"
          @click="toggleEnabled"
        ></button>
      </div>

      <template v-if="enabled">
        <!-- 在线连接状态 -->
        <div
          v-if="desktopLink.connectedClients.length > 0"
          class="mt-4 flex items-center gap-2 rounded-lg border border-[#EC4141]/20 bg-[#EC4141]/5 px-3 py-2"
        >
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#EC4141] opacity-60"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full bg-[#EC4141]"></span>
          </span>
          <span class="text-xs text-gray-700 dark:text-gray-200">
            {{ connectedNames }} 已连接，可遥控本机播放
          </span>
        </div>

        <!-- 配对码 -->
        <div class="mt-4 rounded-lg border border-black/5 bg-white/40 px-4 py-3 dark:border-white/5 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-500 dark:text-white/45">配对码（首次连接时在手机上输入）</span>
            <button
              type="button"
              class="rounded-lg border border-black/10 bg-white/60 px-2.5 py-1 text-[11px] text-gray-600 transition hover:border-[#EC4141]/40 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:text-[#EC4141]"
              @click="newPairingCode"
            >
              {{ pairingCode ? '刷新' : '生成配对码' }}
            </button>
          </div>
          <div v-if="pairingCode" class="mt-2 flex items-baseline gap-3">
            <span class="font-mono text-2xl font-bold tracking-[0.35em] text-gray-800 dark:text-gray-100">{{ pairingCode }}</span>
            <span class="text-[11px] tabular-nums text-gray-400 dark:text-white/35">
              {{ formatCountdown(expiresIn) }} 后失效
            </span>
          </div>
          <p v-else class="mt-2 text-[11px] leading-5 text-gray-400 dark:text-white/35">
            尚未生成配对码。点击「生成配对码」后，在手机端「设置 → 桌面联动」中选择本机并输入配对码完成绑定；绑定一次后无需重复输入。
          </p>
        </div>

        <!-- 已配对设备 -->
        <div v-if="status && status.devices.length > 0" class="mt-4">
          <div class="text-xs text-gray-500 dark:text-white/45">已配对设备（最多 3 台）</div>
          <ul class="mt-2 space-y-1.5">
            <li
              v-for="device in status.devices"
              :key="device.token"
              class="flex items-center justify-between rounded-lg border border-black/5 bg-white/40 px-3 py-2 dark:border-white/5 dark:bg-white/5"
            >
              <div class="min-w-0">
                <div class="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{{ device.deviceName }}</div>
                <div class="mt-0.5 text-[10px] text-gray-400 dark:text-white/30">
                  绑定于 {{ formatPairedAt(device.pairedAt) }}
                </div>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg px-2 py-1 text-[11px] text-gray-400 transition hover:bg-[#EC4141]/10 hover:text-[#EC4141]"
                @click="forgetDevice(device.token)"
              >
                忘记
              </button>
            </li>
          </ul>
        </div>

        <p class="mt-3 text-[11px] leading-5 text-gray-400 dark:text-white/35">
          首次开启时 Windows 可能弹出防火墙授权，请允许「专用网络」访问，否则手机将无法发现本机。
        </p>
      </template>
    </section>
  </section>
</template>
