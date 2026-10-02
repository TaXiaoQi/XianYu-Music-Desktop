<script setup lang="ts"> // 实现
import { computed } from "vue";

import { dragSession as currentDrag } from "../../composables/dragState";
import type { FolderNode as TreeFolderNode } from "../../types";
import { useFolderTreeContent } from "./folder-tree/folderTreeContent";
import { createFolderExpandHooks } from "./folder-tree/folderExpandHooks";
import FolderArtwork from "./folder-tree/FolderArtwork.vue";
import SpinGlyph from "./folder-tree/SpinGlyph.vue";

interface FolderTreeItemProps {
    node: TreeFolderNode;
    depth: number;
    selectedPath: string;
    isRoot?: boolean;
}

const props = withDefaults(defineProps<FolderTreeItemProps>(), {
    isRoot: false,
});

const send = defineEmits<{
    select: [node: TreeFolderNode];
    toggle: [node: TreeFolderNode];
    contextmenu: [payload: { event: MouseEvent; node: TreeFolderNode }];
}>();

const { coverUrl } = useFolderTreeContent(() => props.node);
const expandFx = createFolderExpandHooks(() => props.node.child_count <= 16);

const rowSelected = computed(() => props.selectedPath === props.node.path);

const rowTargeted = computed(() => {
    if (!currentDrag.active || currentDrag.type !== "song") return false;
    return currentDrag.targetFolder?.path === props.node.path;
});

const hoverIn = () => {
    if (!currentDrag.active || currentDrag.type !== "song") return;
    if (currentDrag.targetFolder?.path === props.node.path) return;
    currentDrag.targetFolder = { name: props.node.name, path: props.node.path };
};

const hoverOut = () => {
    if (!currentDrag.active || currentDrag.type !== "song") return;
    if (currentDrag.targetFolder?.path !== props.node.path) return;
    currentDrag.targetFolder = null;
};

const pickNode = () => send("select", props.node);
const foldOrUnfold = () => send("toggle", props.node);
const openRowMenu = (event: MouseEvent) =>
    send("contextmenu", { event, node: props.node });

const toggleAriaLabel = computed(() =>
    props.node.is_expanded ? "折叠文件夹" : "展开文件夹",
);
const childStatText = computed(() =>
    props.node.child_count > 0
        ? `${props.node.child_count} 个文件夹`
        : `${props.node.song_count} 首`,
);
const statToneClass = computed(() =>
    props.node.child_count > 0
        ? "text-blue-500 dark:text-blue-400"
        : "text-gray-600 dark:text-white/60",
);
</script>

<template>
    <div class="text-gray-800 select-none dark:text-gray-200">
        <div
            class="folder-drop-target group relative flex cursor-pointer items-center rounded-md px-2 py-1.5 transition-colors"
            :data-folder-path="node.path"
            :data-folder-name="node.name"
            :class="[
                isRoot ? 'mt-1 py-2 font-semibold' : '',
                rowSelected
                    ? 'bg-blue-500/10 text-blue-500 dark:text-blue-400'
                    : 'hover:bg-black/5 dark:hover:bg-white/5',
                rowTargeted
                    ? 'z-10 bg-blue-50/50 ring-2 ring-blue-500 dark:bg-blue-900/20'
                    : '',
            ]"
            @click.stop="pickNode"
            @mousemove="hoverIn"
            @mouseleave="hoverOut"
            @contextmenu.prevent.stop="openRowMenu"
        >
            <div
                class="shrink-0 transition-all"
                :style="{ width: `${depth * 16}px` }"
            ></div>

            <button
                v-if="node.child_count > 0"
                type="button"
                class="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors text-gray-500 hover:bg-black/5 hover:text-gray-700 dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white/80"
                :aria-label="toggleAriaLabel"
                @click.stop="foldOrUnfold"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 transition-transform duration-200"
                    :class="{ 'rotate-90': node.is_expanded }"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M6.9 14.4a1 1 0 0 1 0-1.4l3-3-3-3a1 1 0 1 1 1.4-1.4l3.7 3.7a1 1 0 0 1 0 1.4l-3.7 3.7a1 1 0 0 1-1.4 0Z"
                    />
                </svg>
            </button>
            <div v-else class="h-6 w-6 mr-1 shrink-0"></div>

            <FolderArtwork :cover="coverUrl" />

            <div class="flex min-w-0 flex-1 flex-col justify-center">
                <div class="truncate text-sm font-medium leading-tight">
                    {{ node.name }}
                </div>
                <div
                    class="mt-0.5 flex items-center gap-1 truncate text-[10px]"
                    :class="statToneClass"
                >
                    <svg
                        v-if="node.child_count > 0"
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-3 w-3 shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                    >
                        <path
                            d="M2.4 6.2c0-.9.7-1.6 1.6-1.6h4.2l1.6 1.6h5.2c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H4c-.9 0-1.6-.7-1.6-1.6v-6Z"
                        />
                    </svg>
                    <SpinGlyph
                        v-if="node.is_loading"
                        class="h-3 w-3 shrink-0 animate-spin"
                    />
                    <span>{{ childStatText }}</span>
                </div>
            </div>
        </div>

        <transition
            move-class="transition-transform duration-300 ease-[ease]"
            @before-enter="expandFx.beforeEnter"
            @enter="expandFx.enter"
            @enter-cancelled="expandFx.enterDone"
            @after-enter="expandFx.enterDone"
            @leave="expandFx.leave"
            @after-leave="expandFx.leaveDone"
        >
            <div v-show="node.is_expanded" class="min-h-0 overflow-hidden">
                <div
                    v-if="node.is_loading"
                    class="flex items-center gap-2 px-2 py-2 text-xs text-gray-500 dark:text-white/50"
                    :style="{ paddingLeft: `${depth * 16 + 16}px` }"
                >
                    <SpinGlyph class="h-3 w-3 animate-spin" /><span
                        >正在加载子文件夹...</span
                    >
                </div>
                <FolderTreeItem
                    v-for="child in node.children"
                    :key="child.path"
                    :node="child"
                    :depth="depth + 1"
                    :selectedPath="selectedPath"
                    @select="(picked) => send('select', picked)"
                    @toggle="(picked) => send('toggle', picked)"
                    @contextmenu="(menu) => send('contextmenu', menu)"
                /></div
        ></transition>
    </div>
</template>
