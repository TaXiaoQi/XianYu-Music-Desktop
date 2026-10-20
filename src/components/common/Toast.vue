<script setup lang="ts">
import { useToast as useToastCenter } from "../../composables/toast";
import ToastStatusIcon from "./toast/ToastStatusIcon.vue";

const { toasts, cancelToast } = useToastCenter();
</script>

<template>
    <!-- Teleport 到 body + 最高层级：不被应用内层叠上下文与
         z-[10000] 全屏遮罩（更新/同步删除/听歌识别）盖住 -->
    <Teleport to="body">
    <div
        class="pointer-events-none fixed bottom-24 left-1/2 z-[10001] flex -translate-x-1/2 flex-col items-center gap-2"
    >
        <TransitionGroup
            enter-active-class="duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] transition-all"
            enter-from-class="translate-y-5 scale-90 opacity-0"
            enter-to-class="translate-y-0 scale-100 opacity-100"
            leave-active-class="duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] transition-all"
            leave-from-class="translate-y-0 scale-100 opacity-100"
            leave-to-class="translate-y-5 scale-90 opacity-0"
        >
            <div
                v-for="toast in toasts"
                :key="toast.id"
                class="pointer-events-auto flex border border-white/10 bg-black/80 text-sm font-medium text-white shadow-lg backdrop-blur-md"
                :class="
                    toast.progress != null
                        ? 'min-w-[240px] flex-col gap-1.5 rounded-2xl px-4 py-2.5'
                        : 'items-center gap-2 rounded-full px-4 py-2'
                "
            >
                <div class="flex items-center gap-2">
                    <ToastStatusIcon
                        :busy="toast.progress != null"
                        :kind="toast.type"
                    />
                    <span class="max-w-[320px] truncate">{{ toast.text }}</span>
                    <button
                        v-if="toast.progress != null && toast.cancellable"
                        class="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/15 hover:text-white"
                        title="取消"
                        @click="cancelToast(toast.id)"
                    >
                        <svg viewBox="0 0 12 12" class="h-2.5 w-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                        </svg>
                    </button>
                </div>
                <div
                    v-if="toast.progress != null"
                    class="h-1 w-full overflow-hidden rounded-full bg-white/15"
                >
                    <div
                        class="h-full rounded-full bg-[#EC4141] transition-all duration-300 ease-out"
                        :style="{ width: `${toast.progress}%` }"
                    ></div>
                </div>
            </div>
        </TransitionGroup>
    </div>
    </Teleport>
</template>
