<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select', localPath: string): void;
}>();

interface Wallpaper {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  category: string;
}

const WALLPAPER_API = 'https://xy.zh2026.cn/chaoguan/public/api/wallpapers.php';

const wallpapers = ref<Wallpaper[]>([]);
const isLoading = ref(true);
const loadError = ref('');
const downloadingId = ref<number | null>(null);
const downloadError = ref('');

const fetchWallpapers = async () => {
  isLoading.value = true;
  loadError.value = '';
  try {
    const response = await fetch(WALLPAPER_API, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.code === 200 && Array.isArray(data.data)) {
      wallpapers.value = data.data;
    } else {
      throw new Error(data.msg || '接口返回异常');
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '获取壁纸列表失败';
  } finally {
    isLoading.value = false;
  }
};

const downloadAndUse = async (wallpaper: Wallpaper) => {
  if (downloadingId.value !== null) return;
  downloadingId.value = wallpaper.id;
  downloadError.value = '';
  try {
    const filename = `wallpaper_${wallpaper.id}.jpg`;
    const localPath = await invoke<string>('download_wallpaper', {
      url: wallpaper.imageUrl,
      filename,
    });
    emit('select', localPath);
    emit('close');
  } catch (err) {
    downloadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    downloadingId.value = null;
  }
};

onMounted(() => {
  fetchWallpapers();
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div class="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md">
        <!-- 头部 -->
        <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div class="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[#EC4141]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span class="text-base font-bold">壁纸中心</span>
            <span v-if="wallpapers.length" class="text-xs text-white/40">{{ wallpapers.length }} 张</span>
          </div>
          <button @click="emit('close')" class="text-white/50 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>

        <!-- 内容区 -->
        <div class="flex-1 overflow-y-auto p-6">
          <!-- 加载中 -->
          <div v-if="isLoading" class="flex flex-col items-center justify-center py-20 text-white/40">
            <svg class="mb-3 h-8 w-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">正在加载壁纸…</span>
          </div>

          <!-- 加载失败 -->
          <div v-else-if="loadError" class="flex flex-col items-center justify-center py-20 text-white/50">
            <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p class="mb-3 text-sm">{{ loadError }}</p>
            <button @click="fetchWallpapers" class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold transition hover:bg-white/10">
              重新加载
            </button>
          </div>

          <!-- 空列表 -->
          <div v-else-if="wallpapers.length === 0" class="flex flex-col items-center justify-center py-20 text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="text-sm">暂无壁纸，敬请期待</span>
          </div>

          <!-- 壁纸网格 -->
          <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            <div
              v-for="wallpaper in wallpapers"
              :key="wallpaper.id"
              class="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-all hover:border-[#EC4141]/50 hover:shadow-[0_0_15px_rgba(236,65,65,0.25)]"
            >
              <div class="aspect-[16/10] w-full overflow-hidden">
                <img
                  :src="wallpaper.thumbnailUrl"
                  :alt="wallpaper.title"
                  loading="eager"
                  class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              </div>
              <!-- 悬浮信息层 -->
              <div class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <div class="p-3">
                  <h3 class="truncate text-sm font-semibold">{{ wallpaper.title }}</h3>
                  <p v-if="wallpaper.description" class="mt-0.5 line-clamp-2 text-xs text-white/60">{{ wallpaper.description }}</p>
                  <button
                    @click="downloadAndUse(wallpaper)"
                    :disabled="downloadingId !== null"
                    class="mt-2 w-full rounded-full bg-[#EC4141] py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span v-if="downloadingId === wallpaper.id">下载中…</span>
                    <span v-else>使用此壁纸</span>
                  </button>
                </div>
              </div>
              <!-- 下载中遮罩 -->
              <div v-if="downloadingId === wallpaper.id" class="absolute inset-0 flex items-center justify-center bg-black/50">
                <svg class="h-6 w-6 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>
          </div>

          <!-- 下载错误提示 -->
          <div v-if="downloadError" class="mt-4 rounded-lg border border-[#EC4141]/30 bg-[#EC4141]/10 px-4 py-2 text-xs text-[#ff8a8a]">
            下载失败：{{ downloadError }}
          </div>
        </div>

        <!-- 底部说明 -->
        <div class="border-t border-white/10 px-6 py-3 text-center text-[11px] text-white/30">
          点击「使用此壁纸」将下载到本地并应用为背景，可在上方调整模糊 / 遮罩 / 缩放
        </div>
      </div>
    </div>
  </Teleport>
</template>
