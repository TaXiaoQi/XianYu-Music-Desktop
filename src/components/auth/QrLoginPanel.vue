<script setup lang="ts">
// 扫码登录二维码面板（自 src/views/Auth.vue 拆出，逻辑与样式保持原样）
defineProps<{
  qrImage: string;
  qrStatus: 'loading' | 'pending' | 'scanned' | 'expired' | 'error' | 'logged';
  qrError: string;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();
</script>

<template>
  <div class="flex flex-col items-center gap-5 pt-2 pb-2">
    <div
      class="relative grid place-items-center w-[clamp(200px,22vw,236px)] h-[clamp(200px,22vw,236px)] rounded-2xl bg-white border border-black/5 shadow-sm overflow-hidden"
    >
      <img
        v-if="qrImage"
        :src="qrImage"
        alt="登录二维码"
        class="w-full h-full object-contain p-2"
      />
      <div v-else class="text-black/40 dark:text-white/40 text-sm px-6 text-center">
        {{ qrStatus === 'loading' ? '二维码加载中…' : '二维码加载失败' }}
      </div>
      <div
        v-if="qrStatus === 'scanned'"
        class="absolute inset-0 bg-white/85 backdrop-blur flex flex-col items-center justify-center gap-2 text-center"
      >
        <span class="text-black text-lg font-semibold">已扫描</span>
        <span class="text-black/50 text-sm">等待移动端确认登录</span>
      </div>
      <div
        v-if="qrStatus === 'expired'"
        class="absolute inset-0 bg-white/85 backdrop-blur flex flex-col items-center justify-center gap-3 text-center"
      >
        <span class="text-black/70 text-sm font-medium">二维码已过期</span>
        <button
          type="button"
          class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-5 py-2 rounded-full text-sm transition cursor-pointer"
          @click="emit('refresh')"
        >
          刷新二维码
        </button>
      </div>
    </div>

    <div class="text-center">
      <p
        v-if="qrStatus === 'loading'"
        class="text-black/60 dark:text-white/60 text-sm"
      >正在生成二维码…</p>
      <p
        v-else-if="qrStatus === 'error'"
        class="text-[#EC4141] text-sm"
      >{{ qrError || '二维码获取失败' }}</p>
      <p
        v-else-if="qrStatus === 'scanned'"
        class="text-black/60 dark:text-white/60 text-sm"
      >二维码已扫描，等待移动端确认登录</p>
      <p
        v-else
        class="text-black/60 dark:text-white/60 text-sm"
      >请使用 <strong class="text-black dark:text-white">「弦予音乐」App</strong> 首页右上角扫码入口扫描</p>
    </div>

    <div class="flex items-center gap-3">
      <button
        type="button"
        class="text-black/50 dark:text-white/50 hover:text-[#EC4141] text-xs flex items-center gap-1 transition cursor-pointer"
        @click="emit('refresh')"
      >刷新二维码</button>
      <span class="text-black/30 dark:text-white/30 text-xs">有效期 5 分钟</span>
    </div>
  </div>
</template>
