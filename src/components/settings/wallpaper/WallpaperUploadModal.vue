<script setup lang="ts"> // 实现
// 上传壁纸弹层：表单、文件选择与预览；状态由 useWallpaperUpload 提供。
defineProps<{
    closing: boolean;
    form: { title: string; description: string; category: string };
    preview: string;
    videoUrl: string;
    error: string;
    uploading: boolean;
}>(); // 实现
const emit = defineEmits<{
    (e: "close"): void;
    (e: "file-change", event: Event): void;
    (e: "submit"): void;
}>(); // 实现
</script>
<template>
    <div
        class="upload-overlay fixed inset-0 z-[10002] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        :class="{ 'is-closing': closing }"
        @click.self="emit('close')"
    >
        <div
            class="upload-card w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-neutral-900/95 text-white shadow-2xl"
            :class="{ 'is-closing': closing }"
        >
            <div
                class="flex items-center justify-between border-b border-white/10 px-5 py-3.5"
            >
                <span class="text-sm font-bold">上传壁纸</span>
                <button
                    @click="emit('close')"
                    :disabled="uploading"
                    class="text-white/50 transition hover:text-white disabled:opacity-40"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
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
            <div class="max-h-[70vh] overflow-y-auto p-5">
                <div class="mb-3">
                    <label class="mb-1 block text-xs text-white/60"
                        >标题
                        <span class="text-[#EC4141]">*</span></label
                    >
                    <input
                        v-model="form.title"
                        maxlength="60"
                        placeholder="给壁纸起个名字"
                        class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                    />
                </div>
                <div class="mb-3">
                    <label class="mb-1 block text-xs text-white/60"
                        >描述</label
                    >
                    <textarea
                        v-model="form.description"
                        rows="2"
                        placeholder="可选，简短描述"
                        class="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-[#EC4141]/60"
                    ></textarea>
                </div>
                <div class="mb-3">
                    <label class="mb-1 block text-xs text-white/60"
                        >分类</label
                    >
                    <input
                        v-model="form.category"
                        placeholder="留空默认为「用户上传」"
                        class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                    />
                </div>
                <div class="mb-2">
                    <label class="mb-1 block text-xs text-white/60"
                        >壁纸文件
                        <span class="text-[#EC4141]">*</span></label
                    >
                    <div
                        class="rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-2"
                    >
                        <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,.gif,image/*,video/mp4,.mp4"
                            @change="emit('file-change', $event)"
                            class="w-full text-xs text-white/70 file:mr-3 file:rounded file:border-0 file:bg-[#EC4141] file:px-3 file:py-1 file:text-xs file:font-medium file:text-white hover:file:bg-[#d13a3a]"
                        />
                        <p class="mt-1 text-[10px] text-white/40">
                            图片（JPG / PNG / WEBP / GIF，30MB 内）或
                            MP4 视频（50MB 内），图片自动压缩为 1920px
                            JPEG，视频封面自动截取首帧
                        </p>
                    </div>
                    <div
                        v-if="preview"
                        class="mt-2 overflow-hidden rounded-lg border border-white/10"
                    >
                        <img
                            :src="preview"
                            alt="预览"
                            class="max-h-40 w-full object-cover"
                        />
                    </div>
                    <div
                        v-else-if="videoUrl"
                        class="relative mt-2 overflow-hidden rounded-lg border border-white/10 bg-black"
                    >
                        <video
                            :src="videoUrl"
                            controls
                            muted
                            class="max-h-40 w-full object-contain"
                        ></video>
                        <span
                            class="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80"
                            >视频壁纸</span
                        >
                    </div>
                </div>
                <div
                    v-if="error"
                    class="mt-3 rounded-lg border border-[#EC4141]/30 bg-[#EC4141]/10 px-3 py-2 text-xs text-[#ff8a8a]"
                >
                    {{ error }}
                </div>
                <p class="mt-3 text-[11px] text-white/40">
                    上传后状态为「待审核」，管理员审核通过后才会展示在壁纸中心供所有人下载。
                </p>
            </div>
            <div
                class="flex justify-end gap-2 border-t border-white/10 px-5 py-3"
            >
                <button
                    @click="emit('close')"
                    :disabled="uploading"
                    class="rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 disabled:opacity-40"
                >
                    取消
                </button>
                <button
                    @click="emit('submit')"
                    :disabled="uploading"
                    class="rounded-lg bg-[#EC4141] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <span v-if="uploading">上传中…</span>
                    <span v-else>上传</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* ==================== 上传弹窗动画 ==================== */
.upload-overlay {
    animation: upload-overlay-in 0.15s ease;
    transition: opacity 0.15s ease;
}

.upload-card {
    animation: upload-card-in 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
    transition:
        opacity 0.15s cubic-bezier(0.34, 1.56, 0.64, 1),
        transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes upload-overlay-in {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes upload-card-in {
    from {
        opacity: 0;
        transform: scale(0.92) translateY(8px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}

.upload-overlay.is-closing {
    opacity: 0;
}

.upload-card.is-closing {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
}
</style>
