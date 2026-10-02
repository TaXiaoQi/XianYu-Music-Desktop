<script setup lang="ts"> // 实现
// 文件夹右键菜单：常规形态展示播放/歌单/目录等操作，管理模式追加建目录与本地删除；
// 批量选中多文件夹时切换为统计行 + 批量移除。外壳定位与动效由 MenuSurface 承担，
// 行渲染复用 CtxRow，图标以 GlyphShape 数据经 GlyphIcon 输出。
import { computed, ref } from "vue";

import { shouldShowFolderManagementActions } from "./folderContextMenuState";
import CtxRow from "./contextMenu/CtxRow.vue";
import GlyphIcon from "./contextMenu/GlyphIcon.vue";
import MenuSurface from "./contextMenu/MenuSurface.vue";
import {
    glyphFolderCreate,
    glyphFolderOpen,
    glyphPlusCircle,
    glyphPlusCross,
    glyphRescan,
    glyphRoundPlay,
    glyphTrashEject,
    glyphTrashLid,
    glyphTrashLidLines,
} from "./contextMenu/actionGlyphs";
import { GLASS_SHEET } from "./contextMenu/sheetChrome";
import { rowLag } from "./contextMenu/motion";
import { watchPointerAway } from "./contextMenu/onPointerAway";

const props = defineProps<{ // 实现
    folderPath: string;
    visible: boolean;
    x: number;
    y: number;
    isRootFolder?: boolean;
    isManagementMode?: boolean;
    selectedCount?: number;
}>();

const emit = defineEmits([
    "cancel",
    "close",
    "play",
    "addToQueue",
    "createPlaylist",
    "addToPlaylist",
    "openFolder",
    "remove",
    "refresh",
    "new-folder",
    "delete-disk",
]);

const sheet = ref<InstanceType<typeof MenuSurface> | null>(null);

// 点在面板外：同时上报取消与关闭
watchPointerAway(
    (hit) => {
        const el = sheet.value?.shell;
        return !!el && !el.contains(hit as Node);
    },
    () => {
        emit("cancel");
        emit("close");
    },
);

const mgmtUnlocked = computed(() =>
    shouldShowFolderManagementActions(!!props.isManagementMode),
);
const canDetachRoot = computed(() => !!props.isRootFolder);
const batchPicking = computed(
    () => !!props.selectedCount && props.selectedCount > 1,
);
const batchLine = computed(() => `已选择 ${props.selectedCount} 个文件夹`);

// 受权限约束的三个动作，未授权时不外发
const forwardWhenAllowed = (
    channel: "remove" | "new-folder" | "delete-disk",
    allowed: boolean,
) => {
    if (allowed) {
        emit(channel, props.folderPath);
    }
};

const WORDING = {
    play: "播放",
    enqueue: "添加到播放队列",
    makeList: "创建为歌单",
    intoList: "添加到歌单",
    showDir: "打开所在目录",
    rescan: "刷新文件夹内容",
    detach: "从音乐库移除",
    mkdir: "新建文件夹",
    wipe: "删除文件夹（本地）",
    bulkDetach: "批量移除文件夹",
    mgmtNote: "仅管理模式可用",
} as const;

const ICON_TONE = "text-gray-500 group-hover:text-gray-800";
</script>

<template>
    <Teleport to="body">
        <MenuSurface
            ref="sheet"
            :shown="visible"
            :at-x="x"
            :at-y="y"
            pop-name="ctx-pop"
            :chrome-class="GLASS_SHEET"
        >
            <template v-if="batchPicking">
                <div
                    class="ctx-note text-xs text-gray-400 px-4 py-2"
                    :style="rowLag(0)"
                >
                    {{ batchLine }}
                </div>
                <CtxRow
                    :step="1"
                    alert
                    lead-class="text-[#EC4141]"
                    :caption="WORDING.bulkDetach"
                    @pick="emit('remove')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphTrashLid"
                    /></template>
                </CtxRow>
            </template>

            <template v-else>
                <CtxRow
                    :step="0"
                    hover-group
                    :lead-class="ICON_TONE"
                    :caption="WORDING.play"
                    @pick="emit('play')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphRoundPlay"
                    /></template>
                </CtxRow>

                <CtxRow
                    :step="1"
                    hover-group
                    :lead-class="ICON_TONE"
                    :caption="WORDING.enqueue"
                    @pick="emit('addToQueue')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphPlusCross"
                    /></template>
                </CtxRow>

                <div class="ctx-sep" :style="rowLag(2)"></div>

                <CtxRow
                    :step="3"
                    hover-group
                    :lead-class="ICON_TONE"
                    :caption="WORDING.makeList"
                    @pick="emit('createPlaylist')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphFolderCreate"
                    /></template>
                </CtxRow>

                <CtxRow
                    :step="4"
                    hover-group
                    :lead-class="ICON_TONE"
                    :caption="WORDING.intoList"
                    @pick="emit('addToPlaylist')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphPlusCircle"
                    /></template>
                </CtxRow>

                <CtxRow
                    :step="5"
                    hover-group
                    :lead-class="ICON_TONE"
                    :caption="WORDING.showDir"
                    @pick="emit('openFolder')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphFolderOpen"
                    /></template>
                </CtxRow>

                <div class="ctx-sep" :style="rowLag(6)"></div>

                <CtxRow
                    :step="7"
                    hover-group
                    :lead-class="ICON_TONE"
                    :caption="WORDING.rescan"
                    @pick="emit('refresh')"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphRescan"
                    /></template>
                </CtxRow>

                <CtxRow
                    v-if="isRootFolder"
                    button
                    :step="8"
                    :caption="WORDING.detach"
                    :lead-class="canDetachRoot ? ICON_TONE : 'text-gray-400'"
                    :frozen="!canDetachRoot"
                    :hover-group="canDetachRoot"
                    @pick="forwardWhenAllowed('remove', canDetachRoot)"
                >
                    <template #lead
                        ><GlyphIcon :shape="glyphTrashEject"
                    /></template>
                </CtxRow>

                <template v-if="mgmtUnlocked">
                    <div class="ctx-sep" :style="rowLag(9)"></div>
                    <div
                        class="ctx-note text-gray-400 px-4 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em]"
                        :style="rowLag(10)"
                    >
                        {{ WORDING.mgmtNote }}
                    </div>

                    <CtxRow
                        button
                        :step="11"
                        hover-group
                        :lead-class="ICON_TONE"
                        :caption="WORDING.mkdir"
                        @pick="forwardWhenAllowed('new-folder', mgmtUnlocked)"
                    >
                        <template #lead
                            ><GlyphIcon :shape="glyphPlusCross"
                        /></template>
                    </CtxRow>

                    <CtxRow
                        button
                        :step="12"
                        :caption="WORDING.wipe"
                        lead-class="text-[#EC4141]"
                        caption-class="font-bold text-[#EC4141]"
                        @pick="forwardWhenAllowed('delete-disk', mgmtUnlocked)"
                    >
                        <template #lead
                            ><GlyphIcon :shape="glyphTrashLidLines"
                        /></template>
                    </CtxRow>
                </template>
            </template>
        </MenuSurface>
    </Teleport>
</template>
