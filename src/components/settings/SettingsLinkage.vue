<script setup lang="ts">
import { onMounted, watch } from 'vue';

import { useSettings } from '../../features/settings/useSettings';
import { useDlnaCastStore } from '../../features/playback/castStore';

const { settings } = useSettings();
const dlnaCast = useDlnaCastStore();

watch(
  () => settings.value.dlnaRendererEnabled,
  () => { void dlnaCast.applyRendererSetting(); },
);
const onRendererNameChanged = () => {
  if (dlnaCast.rendererRunning) void dlnaCast.applyRendererSetting();
};

onMounted(() => {
  void dlnaCast.refreshRendererStatus();
});
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-6 px-6 pb-10 pt-2">
    <section class="space-y-3">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          DLNA 渲染器
        </h2>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          开启后本机将作为 DLNA 设备出现在局域网中，其它 App（如 QQ 音乐、网易云音乐、弦予手机版）可直接投歌到弦予播放。
        </p>
      </div>
      <section class="rounded-xl border border-gray-200/40 bg-white/20 p-5 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">接收其它设备投屏</div>
            <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/35">
              {{ dlnaCast.rendererRunning
                ? `运行中 · 端口 ${dlnaCast.rendererPort}`
                : '未运行（需与投送端在同一局域网）' }}
            </div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.dlnaRendererEnabled }"
            @click="settings.dlnaRendererEnabled = !settings.dlnaRendererEnabled"
          ></button>
        </div>
        <label class="mt-4 block">
          <span class="text-xs text-gray-500 dark:text-white/45">设备名称（投送端看到的名字）</span>
          <input
            v-model="settings.dlnaRendererName"
            type="text"
            maxlength="40"
            placeholder="弦予音乐"
            class="mt-2 w-full rounded-lg border border-black/10 bg-white/45 px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/30 dark:focus:bg-white/10"
            @change="onRendererNameChanged"
          />
        </label>
        <p class="mt-3 text-[11px] leading-5 text-gray-400 dark:text-white/35">
          首次开启时 Windows 可能弹出防火墙授权，请允许「专用网络」访问，否则设备将无法被发现。
        </p>
      </section>
    </section>

    <section class="space-y-3">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          投放到 DLNA 设备
        </h2>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          在播放底栏的投放入口中，可搜索局域网内的 DLNA 设备（电视、音箱、弦予手机版等）并把当前歌曲投放过去，投放后可遥控播放进度与音量。
        </p>
      </div>
    </section>
  </div>
</template>
