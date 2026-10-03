<script setup lang="ts"> // 实现
import type { DownloadedWallpaper } from "../../../composables/settings/wallpaperTypes";
import { isVideo, uploaderLabel } from "../../../composables/settings/wallpaperTypes";
// 壁纸中心「我的下载」网格卡片：批量选择勾选与直接使用按钮。
defineProps<{
    item: DownloadedWallpaper;
    selected: boolean;
    inUse: boolean;
    showBatchOps: boolean;
}>(); // 实现
const emit = defineEmits<{
    (e: "toggle"): void;
    (e: "use"): void;
}>(); // 实现
</script>
<template>
    <div
        class="group relative overflow-hidden rounded-xl border bg-white/5 transition-all"
        :class="
            selected
                ? 'border-[#EC4141]/70 shadow-[0_0_15px_rgba(236,65,65,0.2)]'
                : inUse
                  ? 'border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                  : 'border-white/10 hover:border-[#EC4141]/50'
        "
    >
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
        <button
            v-if="showBatchOps"
            @click.stop="emit('toggle')"
            class="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border backdrop-blur-sm transition"
            :class="
                selected
                    ? 'border-[#EC4141] bg-[#EC4141] text-white'
                    : 'border-white/30 bg-black/45 text-transparent hover:text-white'
            "
        >
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
            >
                <polyline points="20 6 9 17 4 12" />
            </svg>
        </button>
        <div class="aspect-[3/2] w-full overflow-hidden">
            <img
                :src="item.thumbnailUrl || item.imageUrl"
                :alt="item.title"
                loading="eager"
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
        </div>
        <div
            v-if="isVideo(item)"
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
        <div class="p-2.5">
            <h3 class="truncate text-sm font-semibold">
                {{ item.title }}
            </h3>
            <p class="mt-1 truncate text-[11px] text-white/50">
                上传者：{{ uploaderLabel(item) }}
            </p>
            <button
                v-if="!inUse"
                @click="emit('use')"
                class="mt-2 w-full rounded-full bg-[#EC4141] py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a]"
            >
                使用此壁纸
            </button>
            <div
                v-else
                class="mt-2 w-full rounded-full bg-green-500/15 py-1.5 text-center text-xs font-medium text-green-300"
            >
                当前正在使用
            </div>
        </div>
    </div>
</template>
