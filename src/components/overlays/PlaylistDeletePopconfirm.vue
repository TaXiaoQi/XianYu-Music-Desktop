<script setup lang="ts">
// 歌单删除气泡确认（Popconfirm）：锚定触发按钮的轻量确认，替代居中 Modal。
// 定位自实现：水平对齐锚点中心，优先在按钮上方弹出，放不下翻到下方——
// 气泡留在侧栏内，不遮主界面；无锚点（右键菜单路径）时以坐标为锚点中心。
import { nextTick, computed, onBeforeUnmount, ref, watch } from "vue";

import { watchPointerAway } from "./contextMenu/onPointerAway";

const props = defineProps<{
    visible: boolean;
    text: string;
    /** 触发按钮元素：存在时对齐其中心上下弹出 */
    anchor: HTMLElement | null;
    /** 无锚点时的坐标兜底（右键菜单位置） */
    fallbackX: number;
    fallbackY: number;
}>();

const emit = defineEmits(["confirm", "cancel"]);

const shell = ref<HTMLElement | null>(null);
const box = ref({ w: 0, h: 0 });

const SAFE_GAP = 8;

watch(
    () => props.visible,
    async (on) => {
        if (!on) {
            box.value = { w: 0, h: 0 };
            return;
        }
        await nextTick();
        if (shell.value) {
            box.value = { w: shell.value.offsetWidth, h: shell.value.offsetHeight };
        }
    },
    { immediate: true },
);

// 锚点：按钮 rect 中心，或兜底坐标点
const anchorPoint = computed(() => {
    if (props.anchor) {
        const rect = props.anchor.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom };
    }
    return { x: props.fallbackX, top: props.fallbackY, bottom: props.fallbackY };
});

const place = computed(() => {
    if (!props.visible || box.value.h === 0) {
        return { visibility: "hidden" as const };
    }
    const { w, h } = box.value;
    const point = anchorPoint.value;

    const rawLeft = point.x - w / 2;
    const left = Math.max(SAFE_GAP, Math.min(rawLeft, window.innerWidth - w - SAFE_GAP));

    // 优先按钮上方，空间不足翻到下方
    let top = point.top - h - SAFE_GAP;
    if (top < SAFE_GAP) {
        top = point.bottom + SAFE_GAP;
    }

    return {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        visibility: "visible" as const,
    };
});

// 点在气泡外：取消
watchPointerAway(
    (hit) => {
        const el = shell.value;
        return !!el && !el.contains(hit as Node);
    },
    () => {
        if (props.visible) {
            emit("cancel");
        }
    },
);

const onGlobalKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && props.visible) {
        emit("cancel");
    }
};

window.addEventListener("keydown", onGlobalKeydown);
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));
</script>

<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 -translate-y-1 scale-95"
            enter-to-class="opacity-100 translate-y-0 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
        >
            <div
                v-if="visible"
                ref="shell"
                class="fixed z-[9999] select-none rounded-[14px] border border-white/65 bg-white/85 py-2 text-sm text-gray-700 backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/80 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#252528]/90 dark:text-gray-200"
                :style="place"
                @contextmenu.prevent
            >
                <div class="max-w-[240px] px-3.5 text-[13px] leading-snug text-gray-600 dark:text-gray-300">
                    {{ text }}
                </div>
                <div class="mt-2 flex items-center justify-end gap-2 px-3">
                    <button
                        class="rounded-lg border border-gray-300/80 bg-white/70 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                        @click="emit('cancel')"
                    >
                        取消
                    </button>
                    <button
                        class="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-red-700"
                        @click="emit('confirm')"
                    >
                        删除
                    </button>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>
