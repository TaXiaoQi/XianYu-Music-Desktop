<script setup lang="ts"> // 实现
import type { Wallpaper } from "../../../composables/settings/wallpaperTypes";
import { isVideo, uploaderLabel } from "../../../composables/settings/wallpaperTypes";
// 壁纸中心「广场」网格卡片：状态徽标、视频角标与下载/使用按钮。
defineProps<{
    wallpaper: Wallpaper;
    inUse: boolean;
    downloaded: boolean;
    downloading: boolean;
    anyDownloading: boolean;
}>(); // 实现
const emit = defineEmits<{
    (e: "use", wallpaper: Wallpaper): void;
}>(); // 实现
</script>
<template>
    <div
        class="group relative overflow-hidden rounded-xl border bg-white/5 transition-all"
        :class="
            inUse
                ? 'border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                : 'border-white/10 hover:border-[#EC4141]/50 hover:shadow-[0_0_15px_rgba(236,65,65,0.25)]'
        "
    >
        <div class="aspect-[3/2] w-full overflow-hidden">
            <img
                :src="wallpaper.thumbnailUrl || wallpaper.imageUrl"
                :alt="wallpaper.title"
                loading="eager"
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
        </div>
        <div
            v-if="inUse"
            class="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
        >
            <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
            >
                <polyline points="20 6 9 17 4 12" />
            </svg>
            正在使用
        </div>
        <div
            v-else-if="downloaded"
            class="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm"
        >
            已下载
        </div>
        <div
            v-if="isVideo(wallpaper)"
            class="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm"
        >
            <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
            >
                <path d="M8 5v14l11-7z" />
            </svg>
            视频
        </div>
        <div
            v-if="downloading"
            class="absolute inset-0 flex items-center justify-center bg-black/50"
        >
            <svg
                class="h-6 w-6 animate-spin text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                ></circle>
                <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
            </svg>
        </div>
        <div class="p-2.5">
            <h3 class="truncate text-sm font-semibold">
                {{ wallpaper.title }}
            </h3>
            <p class="mt-0.5 truncate text-[11px] text-white/50">
                上传者：{{ uploaderLabel(wallpaper) }}
            </p>
            <p
                v-if="wallpaper.description"
                class="mt-0.5 line-clamp-2 text-xs text-white/60"
            >
                {{ wallpaper.description }}
            </p>
            <div
                v-if="inUse"
                class="mt-2 w-full rounded-full bg-green-500/15 py-1.5 text-center text-xs font-medium text-green-300"
            >
                当前正在使用
            </div>
            <button
                v-else
                @click="emit('use', wallpaper)"
                :disabled="anyDownloading"
                class="mt-2 w-full rounded-full bg-[#EC4141] py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60"
            >
                <span v-if="downloading">下载中…</span>
                <span v-else>{{
                    downloaded ? "使用已下载" : "下载并使用"
                }}</span>
            </button>
        </div>
    </div>
</template>
