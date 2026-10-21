<script setup lang="ts">
// 歌单删除气泡确认（Popconfirm）：锚定触发按钮的轻量确认，替代居中 Modal。
// 定位/动效复用 MenuSurface：有锚点元素时停靠其侧，无锚点（右键菜单路径）退化为坐标锚定。
import { onBeforeUnmount, ref } from "vue";

import MenuSurface from "./contextMenu/MenuSurface.vue";
import { GLASS_SHEET } from "./contextMenu/sheetChrome";
import { watchPointerAway } from "./contextMenu/onPointerAway";

const props = defineProps<{
    visible: boolean;
    text: string;
    /** 触发按钮元素：存在时停靠其侧弹出 */
    anchor: HTMLElement | null;
    /** 无锚点时的坐标兜底（右键菜单位置） */
    fallbackX: number;
    fallbackY: number;
}>();

const emit = defineEmits(["confirm", "cancel"]);

const sheet = ref<InstanceType<typeof MenuSurface> | null>(null);

// 点在气泡外：取消
watchPointerAway(
    (hit) => {
        const el = sheet.value?.shell;
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
        <MenuSurface
            ref="sheet"
            :shown="visible"
            :at-x="fallbackX"
            :at-y="fallbackY"
            :docked-to="anchor"
            pop-name="ctx-pop"
            :chrome-class="GLASS_SHEET"
        >
            <div class="max-w-[240px] px-3.5 pb-1 pt-2 text-[13px] leading-snug text-gray-600 dark:text-gray-300">
                {{ text }}
            </div>
            <div class="flex items-center justify-end gap-2 px-3 py-2">
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
        </MenuSurface>
    </Teleport>
</template>
