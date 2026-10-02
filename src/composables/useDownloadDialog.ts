import { ref, watch, onUnmounted } from "vue";
import type { DownloadQuality, Song } from "../types";
import { useSettings } from "../features/settings/useSettings";

const isDownloadDialogVisible = ref(false); // 实现
const currentDownloadSong = ref<Song | null>(null); // 实现
const currentDownloadInitialQuality = ref<DownloadQuality | null>(null);

const SK_AUDIO = "dl_dialog_audio";
const SK_LYRICS = "dl_dialog_lyrics";
const SK_COVER = "dl_dialog_cover";
const SK_INIT = "dl_dialog_initialized";

const readBool = (key: string, fallback: boolean): boolean => { // 实现
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
};

const downloadAudio = ref(readBool(SK_AUDIO, true)); // 实现
const downloadLyrics = ref(readBool(SK_LYRICS, true)); // 实现
const downloadCover = ref(readBool(SK_COVER, true)); // 实现

let selectionInitialized = localStorage.getItem(SK_INIT) === "true";
let watchRegistered = false; // 实现
let closeDialogTimer: ReturnType<typeof setTimeout> | null = null;

function initSelectionIfNeeded() { // 实现
    if (selectionInitialized) return;
    const { settings } = useSettings();
    downloadAudio.value = true;
    downloadLyrics.value = settings.value.download.downloadLyrics;
    downloadCover.value = settings.value.download.embedCover;
    selectionInitialized = true;
    localStorage.setItem(SK_INIT, "true");
}

function registerPersistenceWatchers() { // 实现
    if (watchRegistered) return;
    watch(downloadAudio, (v) => localStorage.setItem(SK_AUDIO, String(v)));
    watch(downloadLyrics, (v) => localStorage.setItem(SK_LYRICS, String(v)));
    watch(downloadCover, (v) => localStorage.setItem(SK_COVER, String(v)));
    watchRegistered = true;
}

export function useDownloadDialog() { // 实现
    registerPersistenceWatchers();

    onUnmounted(() => {
        if (closeDialogTimer) {
            clearTimeout(closeDialogTimer);
            closeDialogTimer = null;
        }
    });

    const openDownloadDialog = (
        song: Song,
        initialQuality?: DownloadQuality,
    ) => {
        currentDownloadSong.value = song;
        currentDownloadInitialQuality.value = initialQuality ?? null;
        initSelectionIfNeeded();
        isDownloadDialogVisible.value = true;
    };

    const closeDownloadDialog = () => {
        isDownloadDialogVisible.value = false;
        if (closeDialogTimer) {
            clearTimeout(closeDialogTimer);
        }
        closeDialogTimer = setTimeout(() => {
            currentDownloadSong.value = null;
            currentDownloadInitialQuality.value = null;
            closeDialogTimer = null;
        }, 300);
    };

    return {
        isDownloadDialogVisible,
        currentDownloadSong,
        currentDownloadInitialQuality,
        openDownloadDialog,
        closeDownloadDialog,
        downloadAudio,
        downloadLyrics,
        downloadCover,
    };
}
