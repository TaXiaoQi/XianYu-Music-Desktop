<script setup lang="ts"> // 实现
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getStoredAuth } from "../../services/auth/authService";
import {
    useWallpaperList,
} from "../../composables/settings/useWallpaperList";
import {
    useWallpaperActions,
} from "../../composables/settings/useWallpaperActions";
import {
    useWallpaperUpload,
} from "../../composables/settings/useWallpaperUpload";
import type {
    MediaType,
    WallpaperTab,
} from "../../composables/settings/wallpaperTypes";
import WallpaperCard from "./wallpaper/WallpaperCard.vue";
import MyWallpaperCard from "./wallpaper/MyWallpaperCard.vue";
import DownloadedWallpaperCard from "./wallpaper/DownloadedWallpaperCard.vue";
import WallpaperUploadModal from "./wallpaper/WallpaperUploadModal.vue";

const props = defineProps<{
    currentPath?: string;
}>(); // 实现
const emit = defineEmits<{ // 实现
    (e: "close"): void;
    (e: "select", localPath: string, mediaType: MediaType): void;
}>(); // 实现

// --- 淡出动画 ---
const isClosing = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const handleClose = () => {
    if (isClosing.value) return;
    isClosing.value = true;
    closeTimer = setTimeout(() => {
        emit("close");
        closeTimer = null;
    }, 220);
};

const activeTab = ref<WallpaperTab>("browse");
const auth = getStoredAuth(); // 实现
const isLoggedIn = computed(() => !!auth && !!auth.user?.ciyuanxi_id); // 实现
const currentUser = computed(() => auth?.user); // 实现

const {
    wallpapers,
    isLoading,
    loadError,
    fetchWallpapers,
    myWallpapers,
    myLoading,
    myError,
    fetchMyWallpapers,
} = useWallpaperList({ isLoggedIn, currentUser });

const {
    downloadingId,
    downloadError,
    downloadedWallpapers,
    selectedDownloadIds,
    deletingDownloads,
    showBatchOps,
    loadDownloadedWallpapers,
    isDownloaded,
    isCurrentWallpaper,
    isWallpaperInUse,
    toggleDownloadSelection,
    selectAllDownloads,
    clearDownloadSelection,
    deleteSelectedDownloads,
    downloadAndUse,
    useDownloadedWallpaper,
} = useWallpaperActions({
    currentPath: () => props.currentPath,
    onSelect: (localPath, mediaType) => emit("select", localPath, mediaType),
    onCloseRequest: handleClose,
});

const {
    showUploadModal,
    isUploadClosing,
    uploadForm,
    uploadPreview,
    uploadVideoUrl,
    uploading,
    uploadError,
    openUploadModal,
    closeUploadModal,
    onFileChange,
    doUpload,
} = useWallpaperUpload({
    isLoggedIn,
    currentUser,
    onUploadSuccess: async () => {
        activeTab.value = "mine";
        await fetchMyWallpapers();
    },
});

const switchTab = (tab: WallpaperTab) => {
    activeTab.value = tab;
    showBatchOps.value = false;
    if (
        tab === "mine" &&
        isLoggedIn.value &&
        myWallpapers.value.length === 0 &&
        !myError.value
    ) {
        fetchMyWallpapers();
    }
    if (tab === "downloads") {
        selectedDownloadIds.value = [];
    }
}; // 实现

onMounted(() => { // 实现
    loadDownloadedWallpapers();
    fetchWallpapers();
}); // 实现

onBeforeUnmount(() => {
    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }
});
</script> // 实现
<template>
    <Teleport to="body">
        <div
            class="wallpaper-overlay fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            :class="{ 'is-closing': isClosing }"
        >
            <div
                class="wallpaper-card flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md"
                :class="{ 'is-closing': isClosing }"
            >
                <div
                    class="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3"
                >
                    <div class="flex items-center gap-2">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 text-[#EC4141]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <rect
                                x="3"
                                y="3"
                                width="18"
                                height="18"
                                rx="2"
                                ry="2"
                            ></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span class="text-base font-bold">壁纸中心</span>
                        <span
                            v-if="activeTab === 'browse' && wallpapers.length"
                            class="text-xs text-white/40"
                            >{{ wallpapers.length }} 张</span
                        >
                    </div>
                    <button
                        @click="handleClose"
                        class="text-white/50 transition hover:text-white"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path
                                fill-rule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clip-rule="evenodd"
                            />
                        </svg>
                    </button>
                </div>

                <div
                    class="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-2"
                >
                    <div class="flex gap-1">
                        <button
                            @click="switchTab('browse')"
                            :class="[
                                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                                activeTab === 'browse'
                                    ? 'bg-white/15 text-white'
                                    : 'text-white/50 hover:text-white',
                            ]"
                        >
                            壁纸中心
                        </button>
                        <button
                            @click="switchTab('mine')"
                            :class="[
                                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                                activeTab === 'mine'
                                    ? 'bg-white/15 text-white'
                                    : 'text-white/50 hover:text-white',
                            ]"
                        >
                            我的上传
                        </button>
                        <button
                            @click="switchTab('downloads')"
                            :class="[
                                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                                activeTab === 'downloads'
                                    ? 'bg-white/15 text-white'
                                    : 'text-white/50 hover:text-white',
                            ]"
                        >
                            我的下载<span
                                v-if="downloadedWallpapers.length"
                                class="ml-1 text-[11px] text-white/40"
                                >{{ downloadedWallpapers.length }}</span
                            >
                        </button>
                    </div>
                    <button
                        v-if="activeTab === 'mine'"
                        @click="openUploadModal"
                        class="flex items-center gap-1 rounded-full bg-[#EC4141] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a]"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        上传壁纸
                    </button>
                    <div
                        v-if="
                            activeTab === 'downloads' &&
                            downloadedWallpapers.length > 0
                        "
                        class="relative"
                    >
                        <button
                            @click="showBatchOps = !showBatchOps"
                            class="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
                            :class="{ 'bg-white/15': showBatchOps }"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path
                                    d="M3 6h18M7 6V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
                                />
                            </svg>
                            <span>批量管理</span>
                            <span
                                v-if="selectedDownloadIds.length"
                                class="rounded-full bg-[#EC4141] px-1.5 text-[10px] text-white"
                                >{{ selectedDownloadIds.length }}</span
                            >
                        </button>
                        <div
                            v-if="showBatchOps"
                            class="fixed inset-0 z-[19]"
                            @click="showBatchOps = false"
                        ></div>
                        <div
                            v-if="showBatchOps"
                            class="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-white/15 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md"
                        >
                            <button
                                @click="selectAllDownloads"
                                class="flex w-full items-center gap-2 px-4 py-2 text-xs text-white/80 transition hover:bg-white/10"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                全选
                            </button>
                            <button
                                @click="clearDownloadSelection"
                                class="flex w-full items-center gap-2 px-4 py-2 text-xs text-white/80 transition hover:bg-white/10"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="15" y1="9" x2="9" y2="15" />
                                    <line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                                取消选择
                            </button>
                            <div class="my-1 border-t border-white/10"></div>
                            <button
                                @click="deleteSelectedDownloads"
                                :disabled="
                                    selectedDownloadIds.length === 0 ||
                                    deletingDownloads
                                "
                                class="flex w-full items-center gap-2 px-4 py-2 text-xs text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path
                                        d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                                    />
                                </svg>
                                {{ deletingDownloads ? "删除中…" : "删除所选" }}
                            </button>
                        </div>
                    </div>
                </div>

                <div
                    v-if="activeTab === 'mine' && !isLoggedIn"
                    class="min-h-0 flex-1 flex flex-col items-center justify-center py-20 text-white/40"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="mb-3 h-10 w-10 text-white/20"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.5"
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                    </svg>
                    <p class="text-sm">请先登录账号后再上传壁纸</p>
                </div>
                <div v-else class="min-h-0 flex-1 overflow-y-auto p-4">
                    <!-- ====== 浏览：加载中 ====== -->
                    <div
                        v-if="activeTab === 'browse' && isLoading"
                        class="flex flex-col items-center justify-center py-20 text-white/40"
                    >
                        <svg
                            class="mb-3 h-8 w-8 animate-spin"
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
                        <span class="text-sm">正在加载壁纸…</span>
                    </div>

                    <!-- ====== 浏览：加载失败 ====== -->
                    <div
                        v-else-if="activeTab === 'browse' && loadError"
                        class="flex flex-col items-center justify-center py-20 text-white/50"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="mb-3 h-10 w-10 text-white/30"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.5"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                        </svg>
                        <p class="mb-3 text-sm">{{ loadError }}</p>
                        <button
                            @click="fetchWallpapers"
                            class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold transition hover:bg-white/10"
                        >
                            重新加载
                        </button>
                    </div>

                    <!-- ====== 浏览：空列表 ====== -->
                    <div
                        v-else-if="
                            activeTab === 'browse' && wallpapers.length === 0
                        "
                        class="flex flex-col items-center justify-center py-20 text-white/40"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="mb-3 h-10 w-10 text-white/20"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.5"
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                        </svg>
                        <span class="text-sm">暂无壁纸，敬请期待</span>
                    </div>

                    <!-- ====== 浏览：壁纸网格 ====== -->
                    <div
                        v-else-if="activeTab === 'browse'"
                        class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                    >
                        <WallpaperCard
                            v-for="wallpaper in wallpapers"
                            :key="wallpaper.id"
                            :wallpaper="wallpaper"
                            :in-use="isWallpaperInUse(wallpaper.id)"
                            :downloaded="isDownloaded(wallpaper.id)"
                            :downloading="downloadingId === wallpaper.id"
                            :any-downloading="downloadingId !== null"
                            @use="downloadAndUse(wallpaper)"
                        />
                    </div>

                    <!-- ====== 我的上传：加载中 ====== -->
                    <div
                        v-if="activeTab === 'mine' && myLoading"
                        class="flex flex-col items-center justify-center py-20 text-white/40"
                    >
                        <svg
                            class="mb-3 h-8 w-8 animate-spin"
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
                        <span class="text-sm">正在加载我的上传…</span>
                    </div>

                    <!-- ====== 我的上传：错误 ====== -->
                    <div
                        v-else-if="activeTab === 'mine' && myError"
                        class="flex flex-col items-center justify-center py-20 text-white/50"
                    >
                        <p class="mb-3 text-sm">{{ myError }}</p>
                        <button
                            @click="fetchMyWallpapers"
                            class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold transition hover:bg-white/10"
                        >
                            重新加载
                        </button>
                    </div>

                    <!-- ====== 我的上传：空 ====== -->
                    <div
                        v-else-if="
                            activeTab === 'mine' && myWallpapers.length === 0
                        "
                        class="flex flex-col items-center justify-center py-20 text-white/40"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="mb-3 h-10 w-10 text-white/20"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.5"
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                        </svg>
                        <span class="mb-3 text-sm">还没有上传过壁纸</span>
                        <button
                            @click="openUploadModal"
                            class="rounded-full bg-[#EC4141] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d13a3a]"
                        >
                            上传第一张
                        </button>
                    </div>

                    <!-- ====== 我的上传：网格 ====== -->
                    <div
                        v-else-if="activeTab === 'mine'"
                        class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                    >
                        <MyWallpaperCard
                            v-for="wp in myWallpapers"
                            :key="wp.id"
                            :wp="wp"
                            :in-use="isWallpaperInUse(wp.id)"
                            :downloaded="isDownloaded(wp.id)"
                            :downloading="downloadingId === wp.id"
                            :any-downloading="downloadingId !== null"
                            @use="downloadAndUse(wp)"
                        />
                    </div>

                    <!-- ====== 我的下载 ====== -->
                    <div v-if="activeTab === 'downloads'">
                        <div
                            v-if="downloadedWallpapers.length === 0"
                            class="flex flex-col items-center justify-center py-20 text-white/40"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="mb-3 h-10 w-10 text-white/20"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="1.5"
                                    d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                                />
                            </svg>
                            <span class="text-sm">还没有下载过壁纸</span>
                        </div>
                        <template v-else>
                            <div
                                class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                            >
                                <DownloadedWallpaperCard
                                    v-for="item in downloadedWallpapers"
                                    :key="item.id"
                                    :item="item"
                                    :selected="selectedDownloadIds.includes(item.id)"
                                    :in-use="isCurrentWallpaper(item.localPath)"
                                    :show-batch-ops="showBatchOps"
                                    @toggle="toggleDownloadSelection(item.id)"
                                    @use="useDownloadedWallpaper(item)"
                                />
                            </div>
                        </template>
                    </div>

                    <div
                        v-if="downloadError"
                        class="mt-4 rounded-lg border border-[#EC4141]/30 bg-[#EC4141]/10 px-4 py-2 text-xs text-[#ff8a8a]"
                    >
                        下载失败：{{ downloadError }}
                    </div>
                </div>

                <div
                    class="shrink-0 border-t border-white/10 px-5 py-2 text-center text-[11px] text-white/30"
                >
                    <template v-if="activeTab === 'browse'"
                        >点击「下载并使用」将保存到本地，已下载壁纸会直接复用，避免重复下载</template
                    >
                    <template v-else-if="activeTab === 'mine'"
                        >用户上传的壁纸需经管理员审核通过后才会展示在壁纸中心</template
                    >
                    <template v-else
                        >我的下载支持多选删除；删除只影响本机已保存的壁纸文件</template
                    >
                </div>
            </div>

            <WallpaperUploadModal
                v-if="showUploadModal"
                :closing="isUploadClosing"
                :form="uploadForm"
                :preview="uploadPreview"
                :video-url="uploadVideoUrl"
                :error="uploadError"
                :uploading="uploading"
                @close="closeUploadModal"
                @file-change="onFileChange"
                @submit="doUpload"
            />
        </div>
    </Teleport>
</template>

<style scoped>
/* ==================== 主弹窗动画 ==================== */
.wallpaper-overlay {
    animation: wallpaper-overlay-in 0.2s ease;
    transition: opacity 0.2s ease;
}

.wallpaper-card {
    animation: wallpaper-card-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
    transition:
        opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
        transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes wallpaper-overlay-in {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes wallpaper-card-in {
    from {
        opacity: 0;
        transform: scale(0.92) translateY(8px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}

.wallpaper-overlay.is-closing {
    opacity: 0;
}

.wallpaper-card.is-closing {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
}
</style>
