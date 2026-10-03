<script setup lang="ts"> // 实现
import type { MyWallpaper } from "../../../composables/settings/wallpaperTypes";
import { statusMeta } from "../../../composables/settings/wallpaperTypes";
// 壁纸中心「我的上传」网格卡片：审核状态徽标与状态文案展示。
defineProps<{
    wp: MyWallpaper;
    inUse: boolean;
    downloaded: boolean;
    downloading: boolean;
    anyDownloading: boolean;
}>(); // 实现
const emit = defineEmits<{
    (e: "use", wp: MyWallpaper): void;
}>(); // 实现
</script>
<template>
    <div
        class="group relative overflow-hidden rounded-xl border bg-white/5 transition-all"
        :class="
            inUse
                ? 'border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                : wp.status === 'normal'
                  ? 'border-white/10 hover:border-[#EC4141]/50'
                  : 'border-white/10'
        "
    >
        <div class="aspect-[3/2] w-full overflow-hidden">
            <img
                :src="wp.thumbnailUrl || wp.imageUrl"
                :alt="wp.title"
                loading="eager"
                class="h-full w-full object-cover"
                :class="
                    wp.status === 'rejected' || wp.status === 'disabled'
                        ? 'opacity-50 grayscale'
                        : ''
                "
            />
        </div>
        <div class="absolute left-2 top-2">
            <span
                :class="[
                    'rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm',
                    statusMeta(wp.status).cls,
                ]"
                >{{ statusMeta(wp.status).text }}</span
            >
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
        <div class="p-2.5">
            <h3 class="truncate text-sm font-semibold">
                {{ wp.title }}
            </h3>
            <p
                v-if="wp.status === 'pending'"
                class="mt-1 text-[11px] text-amber-300/80"
            >
                等待管理员审核
            </p>
            <p
                v-else-if="wp.status === 'rejected'"
                class="mt-1 text-[11px] text-red-300/80"
            >
                审核未通过
            </p>
            <p
                v-else-if="wp.status === 'normal'"
                class="mt-1 text-[11px] text-green-300/80"
            >
                已通过审核，壁纸中心可见
            </p>
            <p
                v-else-if="wp.status === 'disabled'"
                class="mt-1 text-[11px] text-gray-300/60"
            >
                已被管理员禁用
            </p>
            <div
                v-if="inUse"
                class="mt-2 w-full rounded-full bg-green-500/15 py-1.5 text-center text-xs font-medium text-green-300"
            >
                当前正在使用
            </div>
            <button
                v-else-if="wp.status === 'normal'"
                @click="emit('use', wp)"
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
