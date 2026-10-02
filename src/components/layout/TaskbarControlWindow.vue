<script setup lang="ts"> // 实现
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { nextTick, onMounted, onUnmounted, ref } from "vue";

import {
    TASKBAR_PLAYER_ACTION_EVENT,
    TASKBAR_PLAYER_READY_EVENT,
    TASKBAR_PLAYER_REQUEST_STATE_EVENT,
    TASKBAR_PLAYER_STATE_APPLIED_EVENT,
    TASKBAR_PLAYER_STATE_EVENT,
    TASKBAR_PLAYER_VISIBILITY_EVENT,
    type TaskbarPlayerAction,
    type TaskbarPlayerStatePayload,
} from "../../features/taskbarPlayer/shared";
import { windowApi } from "../../services/tauri/windowApi";
import {
    sessionApi,
    type PlaybackQueueMetaChangedPayload,
    type PlaybackSessionChangedPayload,
} from "../../services/tauri/sessionApi";
import type { Song } from "../../types";

import TaskbarDragGrip from "./taskbar/TaskbarDragGrip.vue";
import TaskbarPlaybackKeys from "./taskbar/TaskbarPlaybackKeys.vue";
import TaskbarTrackInfo from "./taskbar/TaskbarTrackInfo.vue";
import { useTaskbarWindowDrag } from "./taskbar/useTaskbarWindowDrag";

const shellWindow = getCurrentWindow();
const { isDragging, beginDrag } = useTaskbarWindowDrag(shellWindow);

const nowPlaying = ref<Song | null>(null);
const coverAddress = ref("");
const transportRunning = ref(false);
const darkChrome = ref(true);
const shellShown = ref(false);

const dispatchAction = (action: TaskbarPlayerAction["type"]) => {
    void emitTo<TaskbarPlayerAction>("main", TASKBAR_PLAYER_ACTION_EVENT, {
        type: action,
    });
};

const keepShellPinned = async () => {
    try {
        await shellWindow.setAlwaysOnTop(true);
        await windowApi.refreshCurrentWindowTopmost(true);
    } catch (error) {
        console.warn(
            "[TaskbarPlayer] Failed to refresh taskbar player topmost state:",
            error,
        );
    }
};

const revealMainWindow = async () => {
    try {
        const mainWin = await WebviewWindow.getByLabel("main");
        if (!mainWin) {
            console.warn("[TaskbarPlayer] Main window not found");
            return;
        }
        await mainWin.show();
        if (await mainWin.isMinimized()) {
            await mainWin.unminimize();
        }
        await mainWin.setFocus();
    } catch (error) {
        console.error("[TaskbarPlayer] Failed to restore main window:", error);
    }
};

let detachStateStream: (() => void) | null = null;
let detachVisibilityStream: (() => void) | null = null;
let detachMoveStream: (() => void) | null = null;
let detachSessionStream: (() => void) | null = null;
let detachQueueMetaStream: (() => void) | null = null;
let queueMetaByPath: Record<string, Song> = {};

onMounted(async () => { // 实现
    try {
        await shellWindow.setBackgroundColor([0, 0, 0, 0]);
    } catch (error) {
        console.warn(
            "[TaskbarPlayer] Failed to set transparent window background:",
            error,
        );
    }

    void keepShellPinned();

    detachStateStream = await listen<TaskbarPlayerStatePayload>(
        TASKBAR_PLAYER_STATE_EVENT,
        (event) => {
            nowPlaying.value = event.payload.currentSong;
            coverAddress.value = event.payload.coverUrl;
            transportRunning.value = event.payload.isPlaying;
            darkChrome.value = event.payload.isDarkTheme;
            void nextTick(() => {
                void emitTo("main", TASKBAR_PLAYER_STATE_APPLIED_EVENT);
            });
        },
    );

    detachVisibilityStream = await listen<{ visible: boolean }>(
        TASKBAR_PLAYER_VISIBILITY_EVENT,
        (event) => {
            shellShown.value = event.payload.visible;
            if (event.payload.visible) void keepShellPinned();
        },
    );

    detachMoveStream = await shellWindow.onMoved(() => {});

    try {
        const session = await sessionApi.getPlaybackSession();
        if (session && session.currentSongPath) {
            transportRunning.value = session.isPlaying;
            const meta = session.queueSongMeta?.[session.currentSongPath];
            if (meta) {
                nowPlaying.value = meta;
            }
            queueMetaByPath = session.queueSongMeta ?? {};
        }
    } catch {
        /* ignore - emitTo will provide full state */
    }

    detachSessionStream = await listen<PlaybackSessionChangedPayload>(
        "playback:session-changed",
        (event) => {
            const data = event.payload;
            transportRunning.value = data.isPlaying;
            if (!nowPlaying.value && data.currentSongPath) {
                const meta = queueMetaByPath[data.currentSongPath];
                if (meta) {
                    nowPlaying.value = meta;
                }
            }
        },
    );

    detachQueueMetaStream = await listen<PlaybackQueueMetaChangedPayload>(
        "playback:queue-meta-changed",
        (event) => {
            queueMetaByPath = event.payload;
        },
    );

    void emitTo("main", TASKBAR_PLAYER_READY_EVENT);
    void emitTo("main", TASKBAR_PLAYER_REQUEST_STATE_EVENT);
});

onUnmounted(() => { // 实现
    detachStateStream?.();
    detachVisibilityStream?.();
    detachMoveStream?.();
    detachSessionStream?.();
    detachQueueMetaStream?.();
});
</script>

<template>
    <div
        class="relative flex h-[40px] w-[320px] select-none items-center justify-between overflow-hidden rounded-xl border bg-transparent pl-2 pr-3.5 transition-all duration-300"
        :class="[
            isDragging
                ? 'backdrop-blur-md bg-[#121214]/65 border-white/5 shadow-2xl'
                : 'border-transparent shadow-none hover:backdrop-blur-md hover:bg-[#121214]/65 hover:border-white/5 hover:shadow-2xl',
        ]"
    >
        <TaskbarDragGrip :engaged="isDragging" @grip-press="beginDrag" />

        <TaskbarTrackInfo
            :cover-url="coverAddress"
            :song="nowPlaying"
            @cover-activated="revealMainWindow"
        />

        <TaskbarPlaybackKeys
            :playing="transportRunning"
            @key-press="dispatchAction"
        />

        <div
            class="group/exit absolute right-0 top-0 z-30 flex h-7 w-7 cursor-pointer items-center justify-center"
            title="退出播控"
            @click.stop="dispatchAction('close')"
        >
            <div
                class="flex h-4 w-4 items-center justify-center rounded-full bg-white/5 text-white/30 opacity-0 transition-all duration-300 group-hover/exit:opacity-100 hover:!bg-white/15 hover:!text-white/90 active:scale-90"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-2 w-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <line y2="18" x2="6" y1="6" x1="18"></line>
                    <line y2="18" x2="18" y1="6" x1="6"></line>
                </svg>
            </div>
        </div>
    </div>
</template>

<style>
html,
body,
#app {
    background: transparent !important;
    background-color: transparent !important;
    overflow: hidden !important;
}
</style>
