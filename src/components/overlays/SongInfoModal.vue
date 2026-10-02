<script setup lang="ts"> // 实现
// 歌曲信息窗口：详情/歌词双栏，支持元数据编辑、歌词编辑与外置 MusicTag 修正
import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    ref,
    watch,
    type Ref,
} from "vue";
import { convertFileSrc as toAssetPreviewUrl } from "@tauri-apps/api/core";
import { open as pickLocalFile } from "@tauri-apps/plugin-dialog";
import { Tag } from "lucide-vue-next";
import type { Song, SongDetail } from "../../types";
import type { SongInfoDialogAction } from "../../composables/useSongInfoDialog";
import { useCoverCache } from "../../composables/useCoverCache";
import { useSongDetailCache } from "../../composables/useSongDetailCache";
import { useThemeSettings } from "../../composables/useThemeSettings";
import { useToast } from "../../composables/toast";
import { usePlayer } from "../../features/playback";
import { useLibraryStore } from "../../features/library/store";
import type { LyricsStorageSource } from "../../services/tauri/contracts";
import { appApi } from "../../services/tauri/appApi";
import { downloadApi } from "../../services/tauri/downloadApi";
import { lyricsApi } from "../../services/tauri/lyricsApi";
import { blankTrackEditForm, type TrackEditForm } from "./songInfo/editForm";
import InfoColumnHeader from "./songInfo/InfoColumnHeader.vue";
import InfoHero from "./songInfo/InfoHero.vue";
import MetaSection from "./songInfo/MetaSection.vue";
import LyricsColumnHeader from "./songInfo/LyricsColumnHeader.vue";

const props = defineProps<{ // 实现
    song: Song | null;
    visible: boolean;
    initialAction?: SongInfoDialogAction;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { clearCoverCaches, loadCover } = useCoverCache();
const { loadSongDetail: fetchSongDetail } = useSongDetailCache();
const { openInFinder: revealInFileManager } = usePlayer();
const { isDarkTheme } = useThemeSettings();
const { showToast } = useToast();
const libraryStore = useLibraryStore();

const stageCoverSrc = ref("");
const savedTrackSnapshot = ref<Song | null>(null);
const overlayLeaving = ref(false);
const loadedDetail = ref<SongDetail | null>(null);
const headEditing = ref(false);
const headSaving = ref(false);
const headEditError = ref("");
const infoDraft = ref<TrackEditForm>(blankTrackEditForm());
const lyricsDraft = ref("");
const lyricsBaseline = ref("");
const lyricsOrigin = ref<LyricsStorageSource>("empty");
const lyricsOriginFile = ref<string | null>(null);
const lyricsLoading = ref(false);
const lyricsSaving = ref(false);
const lyricsIssue = ref("");
const lyricsTextareaRef = ref<HTMLTextAreaElement | null>(null); // 实现
let latestFetchId = 0;

// 双栏互斥展开：pending 驱动过渡类名，360ms 后落定写入 active
interface StretchBox {
    active: Ref<boolean>;
    pending: Ref<boolean | null>;
    cancel: () => void;
    quiet: () => void;
    toggle: (evictNeighbor: () => void) => void;
}

const createStretchBox = (): StretchBox => {
    const active = ref(false);
    const pending = ref<boolean | null>(null);
    let settleTimer: number | null = null;

    const cancel = () => {
        if (settleTimer !== null) {
            window.clearTimeout(settleTimer);
            settleTimer = null;
        }
    };

    const quiet = () => {
        cancel();
        active.value = false;
        pending.value = null;
    };

    const toggle = (evictNeighbor: () => void) => {
        cancel();
        const next = !active.value;
        pending.value = next;

        // 展开本栏时立即收起对侧
        if (next) {
            evictNeighbor();
        }

        settleTimer = window.setTimeout(() => {
            active.value = pending.value === true;
            pending.value = null;
            settleTimer = null;
        }, 360);
    };

    return { active, pending, cancel, quiet, toggle };
};

const infoPaneStretch = createStretchBox();
const lyricsPaneStretch = createStretchBox();
const enlargeInfoPane = () =>
    infoPaneStretch.toggle(() => lyricsPaneStretch.quiet());
const enlargeLyricsPane = () =>
    lyricsPaneStretch.toggle(() => infoPaneStretch.quiet());

// 复位编辑相关状态（歌词缓冲与已加载详情由调用方决定是否清理）
const resetEditorState = () => {
    savedTrackSnapshot.value = null;
    headEditing.value = false;
    headSaving.value = false;
    headEditError.value = "";
    infoDraft.value = blankTrackEditForm();
    lyricsOrigin.value = "empty";
    lyricsOriginFile.value = null;
    lyricsIssue.value = "";
    lyricsSaving.value = false;
    infoPaneStretch.quiet();
    lyricsPaneStretch.quiet();
};

const clearLyricsBuffers = () => {
    lyricsDraft.value = "";
    lyricsBaseline.value = "";
};

// 先播放 200ms 退场动画再通知父级关闭
const requestDismiss = () => {
    if (overlayLeaving.value) return;
    overlayLeaving.value = true;
    window.setTimeout(() => {
        emit("close");
        overlayLeaving.value = false;
    }, 200);
};

// 拉取可编辑歌词；失败时归一化为带 error 的空结果
const readEditableLyrics = (path: string) =>
    lyricsApi
        .getSongLyricsForEdit(path)
        .then((lyrics) => ({ ...lyrics, error: "" }))
        .catch((error: unknown) => ({
            lyrics: "",
            source: "empty" as LyricsStorageSource,
            sourcePath: null,
            error: String(error),
        }));

watch(
    [() => props.visible, () => props.song?.path ?? ""],
    async ([shown, path]) => {
        const fetchId = ++latestFetchId;

        if (!shown || !path) {
            // 弹窗收起：清空所有临时状态，封面延迟释放避免闪黑
            resetEditorState();
            loadedDetail.value = null;
            clearLyricsBuffers();
            lyricsLoading.value = false;
            window.setTimeout(() => {
                if (fetchId === latestFetchId) {
                    stageCoverSrc.value = "";
                }
            }, 200);
            return;
        }

        // 切换目标歌曲：复位编辑态后并行拉取封面、详情与歌词
        resetEditorState();
        overlayLeaving.value = false;
        lyricsLoading.value = true;

        const [fetchedCover, fetchedDetail, lyricsResult] = await Promise.all([
            loadCover(path),
            fetchSongDetail(path).catch(() => null),
            readEditableLyrics(path),
        ]);

        // 请求已过期或弹窗已切走时丢弃结果
        if (
            fetchId !== latestFetchId ||
            !props.visible ||
            path !== (props.song?.path ?? "")
        ) {
            return;
        }

        stageCoverSrc.value = fetchedCover || "";
        loadedDetail.value = fetchedDetail;
        lyricsDraft.value = lyricsResult.lyrics;
        lyricsBaseline.value = lyricsResult.lyrics;
        lyricsOrigin.value = lyricsResult.source;
        lyricsOriginFile.value = lyricsResult.sourcePath;
        lyricsIssue.value = lyricsResult.error;
        lyricsLoading.value = false;
        await nextTick();
        await runInitialAction(path);
    },
    { immediate: true },
);

const lyricsDirty = computed(() => lyricsDraft.value !== lyricsBaseline.value);
const infoStretchPreview = computed(
    () => infoPaneStretch.pending.value ?? infoPaneStretch.active.value,
);
const lyricsStretchPreview = computed(
    () => lyricsPaneStretch.pending.value ?? lyricsPaneStretch.active.value,
);

// 舞台容器的过渡状态类（展开/收起进行中 vs 稳态）
const stageStateClass = computed(() => {
    const classes: string[] = [];

    if (overlayLeaving.value) {
        classes.push("scale-95", "opacity-0", "translate-y-4");
    } else {
        classes.push("scale-100", "opacity-100", "-translate-y-3");
    }

    if (infoPaneStretch.active.value)
        classes.push("song-info-stage--song-expanded");
    if (lyricsPaneStretch.active.value)
        classes.push("song-info-stage--lyrics-expanded");
    if (infoPaneStretch.pending.value === true)
        classes.push("song-info-stage--song-expanding");
    if (infoPaneStretch.pending.value === false)
        classes.push("song-info-stage--song-collapsing");
    if (lyricsPaneStretch.pending.value === true)
        classes.push("song-info-stage--lyrics-expanding");
    if (lyricsPaneStretch.pending.value === false)
        classes.push("song-info-stage--lyrics-collapsing");

    return classes;
});

// 展示用歌曲对象：以扫描详情补全基础曲库记录
const presentedSong = computed(() => {
    if (!props.song) {
        return null;
    }

    const baseTrack =
        savedTrackSnapshot.value?.path === props.song.path
            ? savedTrackSnapshot.value
            : props.song;

    return {
        ...baseTrack,
        genre: loadedDetail.value?.genre ?? baseTrack.genre,
        year: loadedDetail.value?.year ?? baseTrack.year,
        container: loadedDetail.value?.container ?? baseTrack.container,
        codec: loadedDetail.value?.codec ?? baseTrack.codec,
        file_size: loadedDetail.value?.file_size ?? baseTrack.file_size,
        track_number: loadedDetail.value?.track_number,
        disc_number: loadedDetail.value?.disc_number,
    };
});

const headlineText = computed(() => {
    const track = presentedSong.value;
    return track ? track.title || track.name : "";
});

const visibleCoverSrc = computed(
    () => infoDraft.value.coverPreview || stageCoverSrc.value,
);

const onGlobalKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && props.visible) {
        requestDismiss();
    }
};

onMounted(() => window.addEventListener("keydown", onGlobalKey));
onUnmounted(() => { // 实现
    window.removeEventListener("keydown", onGlobalKey);
    infoPaneStretch.cancel();
    lyricsPaneStretch.cancel();
});

const revealSongFolder = () => {
    if (props.song?.path) {
        void revealInFileManager(props.song.path);
        requestDismiss();
    }
};

const MUSICTAG_PATH_STORAGE_KEY = "toolbox_musictag_path";

// 定位 MusicTag 可执行程序：优先复用本地记录，失效则引导重新登记
const resolveMusicTagExecutable = async (): Promise<string | null> => {
    let recordedPath = localStorage.getItem(MUSICTAG_PATH_STORAGE_KEY);

    if (recordedPath) {
        const stillOnDisk = await downloadApi.fileExists(recordedPath);
        if (!stillOnDisk) {
            localStorage.removeItem(MUSICTAG_PATH_STORAGE_KEY);
            showToast("MusicTag 路径无效，请重新选择", "error");
            recordedPath = null;
        }
    }

    if (!recordedPath) {
        const registered = await appApi.registerExternalProgram();

        if (!registered) {
            showToast("已取消选择 MusicTag", "info");
            return null;
        }

        localStorage.setItem(MUSICTAG_PATH_STORAGE_KEY, registered);
        recordedPath = registered;
    }

    return recordedPath;
};

const sendSongToMusicTag = async () => {
    const songPath = props.song?.path;
    if (!songPath) {
        showToast("当前歌曲文件路径无效", "error");
        return;
    }

    const songOnDisk = await downloadApi.fileExists(songPath);
    if (!songOnDisk) {
        showToast("当前歌曲文件路径无效", "error");
        return;
    }

    const musicTagBinary = await resolveMusicTagExecutable();
    if (!musicTagBinary) {
        return;
    }

    try {
        await appApi.openExternalProgram(musicTagBinary, [songPath]);
        showToast("已在 MusicTag 中打开当前歌曲", "success");
    } catch (error) {
        console.error("Failed to open MusicTag:", error);
        showToast("无法打开 MusicTag，请检查路径配置", "error");
    }
};

const persistLyrics = async () => {
    if (!props.song?.path || lyricsSaving.value) return;

    lyricsSaving.value = true;
    lyricsIssue.value = "";

    try {
        const saved = await lyricsApi.saveSongLyrics(
            props.song.path,
            lyricsDraft.value,
            lyricsOrigin.value,
            lyricsOriginFile.value,
        );
        lyricsBaseline.value = lyricsDraft.value;
        lyricsOrigin.value = saved.source;
        lyricsOriginFile.value = saved.sourcePath;
    } catch (error) {
        lyricsIssue.value = String(error);
    } finally {
        lyricsSaving.value = false;
    }
};

const syncDraftFromTrack = () => {
    const track = presentedSong.value;
    if (!track) {
        infoDraft.value = blankTrackEditForm();
        return;
    }

    infoDraft.value = {
        trackTitle: track.title || track.name || "",
        artistName: track.artist || "",
        albumName: track.album || "",
        trackNo: track.track_number || "",
        discNo: track.disc_number || "",
        releaseYear: track.year || "",
        newCoverPath: null,
        coverPreview: "",
    };
};

const beginHeadlineEdit = () => {
    headEditError.value = "";
    syncDraftFromTrack();
    headEditing.value = true;
};

const abortHeadlineEdit = () => {
    if (headSaving.value) return;
    headEditError.value = "";
    headEditing.value = false;
    syncDraftFromTrack();
};

const trimToNull = (value: string) => value.trim() || null;

const handleChooseCover = async () => { // 实现
    if (!headEditing.value) return;

    const picked = await pickLocalFile({
        multiple: false,
        directory: false,
        title: "选择歌曲封面",
        filters: [
            {
                name: "图片",
                extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"],
            },
        ],
    });

    if (!picked || Array.isArray(picked)) {
        return;
    }

    infoDraft.value.newCoverPath = picked;
    infoDraft.value.coverPreview = toAssetPreviewUrl(picked);
};

// 按外部指定的入口动作直接落到对应编辑态
const runInitialAction = async (path: string) => {
    if (!props.visible || props.song?.path !== path) return;

    if (props.initialAction === "cover") {
        beginHeadlineEdit();
        infoPaneStretch.active.value = true;
        lyricsPaneStretch.active.value = false;
        await nextTick();
        await handleChooseCover();
        return;
    }

    if (props.initialAction === "lyrics") {
        lyricsPaneStretch.active.value = true;
        infoPaneStretch.active.value = false;
        await nextTick();
        lyricsTextareaRef.value?.focus();
    }
};

const persistSongInfo = async () => {
    const songPath = props.song?.path;
    if (!songPath || headSaving.value) return;

    const nextTitle = infoDraft.value.trackTitle.trim();
    if (!nextTitle) {
        headEditError.value = "歌名不能为空";
        return;
    }

    headSaving.value = true;
    headEditError.value = "";

    try {
        const result = await lyricsApi.saveSongInfo(songPath, {
            title: nextTitle,
            artist: infoDraft.value.artistName.trim(),
            album: infoDraft.value.albumName.trim(),
            trackNumber: trimToNull(infoDraft.value.trackNo),
            discNumber: trimToNull(infoDraft.value.discNo),
            year: trimToNull(infoDraft.value.releaseYear),
            coverPath: infoDraft.value.newCoverPath,
        });

        savedTrackSnapshot.value = result.song;
        loadedDetail.value = result.detail;
        libraryStore.setSongRecord(result.song);

        if (infoDraft.value.newCoverPath) {
            await appApi.clearCoverCache();
            clearCoverCaches();
            stageCoverSrc.value = (await loadCover(songPath)) || "";
        }

        headEditing.value = false;
        syncDraftFromTrack();
        showToast("歌曲信息已保存", "success");
    } catch (error) {
        const message = String(error);
        headEditError.value = message;
        showToast(`保存歌曲信息失败: ${message}`, "error");
    } finally {
        headSaving.value = false;
    }
};
</script>

<template>
    <Teleport to="body">
        <div
            v-if="visible"
            class="z-[10000] fixed inset-0 flex items-center justify-center p-4 sm:p-6"
            :class="{ 'pointer-events-none': overlayLeaving }"
        >
            <div
                class="inset-0 absolute bg-black/40 backdrop-blur-sm duration-300 ease-out transition-opacity"
                :class="overlayLeaving ? 'opacity-0' : 'opacity-100'"
                @click="requestDismiss"
            ></div>

            <div
                data-tauri-drag-region
                class="song-info-window-drag-strip"
            ></div>

            <div
                class="song-info-stage"
                :class="[
                    stageStateClass,
                    isDarkTheme ? 'song-info-stage--dark' : '',
                ]"
            >
                <section class="song-info-column">
                    <InfoColumnHeader
                        :editing="headEditing"
                        :expanded="infoStretchPreview"
                        @toggle-edit="
                            headEditing
                                ? abortHeadlineEdit()
                                : beginHeadlineEdit()
                        "
                        @toggle-expand="enlargeInfoPane"
                    />

                    <div
                        class="song-info-main relative w-full dark:bg-gray-900/90 bg-white/85 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col dark:border-white/10 border border-white/40"
                    >
                        <div
                            v-if="presentedSong"
                            class="song-info-content p-6 custom-scrollbar overflow-y-auto"
                        >
                            <InfoHero
                                :song="presentedSong"
                                :draft="infoDraft"
                                :editing="headEditing"
                                :cover-src="visibleCoverSrc"
                                :title-text="headlineText"
                                @choose-cover="handleChooseCover"
                            />

                            <div
                                v-if="headEditError"
                                class="song-info-edit-error"
                            >
                                {{ headEditError }}
                            </div>

                            <MetaSection
                                :song="presentedSong"
                                :draft="infoDraft"
                                :editing="headEditing"
                            />
                        </div>
                    </div>

                    <div class="modal-external-actions song-info-footer">
                        <button
                            v-if="!headEditing"
                            class="modal-action-button modal-action-button--wide"
                            @click="revealSongFolder"
                        >
                            <svg
                                class="w-4 h-4 mr-2 dark:text-gray-400 text-gray-500"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                            >
                                <path
                                    d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                            打开文件所在目录
                        </button>
                        <button
                            v-if="!headEditing"
                            class="modal-action-button modal-action-button--wide"
                            :disabled="!props.song?.path"
                            @click="sendSongToMusicTag"
                        >
                            <Tag
                                class="w-4 h-4 mr-2 dark:text-gray-400 text-gray-500"
                            />
                            用 MusicTag 修正标签
                        </button>
                        <template v-else>
                            <button
                                type="button"
                                class="modal-action-button"
                                :disabled="headSaving"
                                @click="abortHeadlineEdit"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                class="modal-action-button modal-action-button--primary"
                                :disabled="headSaving"
                                @click="persistSongInfo"
                            >
                                {{ headSaving ? "保存中" : "保存信息" }}
                            </button>
                        </template>
                    </div>
                </section>

                <section
                    class="lyrics-editor-column"
                    :class="
                        lyricsStretchPreview
                            ? 'lyrics-editor-column--expanded'
                            : ''
                    "
                >
                    <LyricsColumnHeader
                        :song="presentedSong"
                        :cover-src="stageCoverSrc"
                        :title-text="headlineText"
                        :expanded="lyricsStretchPreview"
                        @toggle-expand="enlargeLyricsPane"
                    />

                    <aside
                        class="lyrics-editor-panel"
                        :class="
                            lyricsStretchPreview
                                ? 'lyrics-editor-panel--expanded'
                                : ''
                        "
                    >
                        <textarea
                            ref="lyricsTextareaRef"
                            v-model="lyricsDraft"
                            class="custom-scrollbar lyrics-editor-textarea"
                            :placeholder="
                                lyricsLoading
                                    ? '正在读取歌词...'
                                    : '[00:00.00] 在这里编辑 LRC 歌词'
                            "
                            :disabled="lyricsLoading"
                            spellcheck="false"
                        ></textarea>

                        <div v-if="lyricsIssue" class="lyrics-editor-error">
                            {{ lyricsIssue }}
                        </div>
                    </aside>

                    <div class="modal-external-actions lyrics-editor-actions">
                        <button
                            type="button"
                            class="modal-action-button modal-action-button--primary"
                            :disabled="!lyricsDirty || lyricsSaving"
                            @click="persistLyrics"
                        >
                            {{ lyricsSaving ? "保存中" : "保存" }}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    </Teleport>
</template>

<style scoped> /* 样式 */
.song-info-stage { /* 样式 */
    /* 双栏宽度、页边距与底栏高度的全部节奏变量 */
    --lyrics-panel-width: clamp(340px, 32vw, 460px);
    --song-info-page-gap: clamp(12px, 1.3vw, 18px);
    --song-info-main-width: min(
        680px,
        calc(100% - var(--lyrics-panel-width) - var(--song-info-page-gap))
    );
    --song-info-footer-height: clamp(44px, 5.8vh, 52px);
    --song-info-footer-gap: clamp(10px, 1.2vh, 14px);
    --song-info-viewport-x: clamp(360px, 26vw, 520px);
    --song-info-viewport-y: clamp(120px, 14vh, 190px);
    --lyrics-editor-panel-bg: rgba(255, 255, 255, 0.82);
    --lyrics-editor-panel-border: rgba(255, 255, 255, 0.38);
    --lyrics-editor-panel-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
    --modal-external-header-bg: rgba(255, 255, 255, 0.62);
    --modal-external-header-border: rgba(255, 255, 255, 0.42);
    --modal-external-header-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
    --lyrics-editor-title-color: rgb(17 24 39);
    --lyrics-editor-text-color: rgb(31 41 55);
    --lyrics-editor-placeholder-color: rgb(156 163 175);
    --lyrics-editor-button-bg: rgba(255, 255, 255, 0.72);
    --lyrics-editor-button-border: rgba(148, 163, 184, 0.26);
    --lyrics-editor-button-color: rgb(55 65 81);
    --lyrics-editor-button-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
    --lyrics-editor-expand-bg: rgba(255, 255, 255, 0.68);
    --lyrics-editor-expand-border: rgba(148, 163, 184, 0.22);
    --lyrics-editor-expand-color: rgb(75 85 99);
    display: flex;
    position: relative;
    z-index: 2;
    gap: var(--song-info-page-gap);
    width: min(1360px, calc(100vw - var(--song-info-viewport-x)));
    height: min(1040px, calc(100dvh - var(--song-info-viewport-y)));
    max-height: min(1040px, calc(100dvh - var(--song-info-viewport-y)));
    transform-origin: center center;
    -webkit-user-select: text;
    user-select: text;
    transition:
        transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
        opacity 300ms ease,
        gap 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-info-stage--dark { /* 样式 */
    --lyrics-editor-panel-bg: rgba(15, 23, 42, 0.92);
    --lyrics-editor-panel-border: rgba(255, 255, 255, 0.1);
    --lyrics-editor-panel-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
    --modal-external-header-bg: rgba(15, 23, 42, 0.72);
    --modal-external-header-border: rgba(255, 255, 255, 0.1);
    --modal-external-header-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
    --lyrics-editor-title-color: rgb(248 250 252);
    --lyrics-editor-text-color: rgba(255, 255, 255, 0.86);
    --lyrics-editor-placeholder-color: rgba(148, 163, 184, 0.72);
    --lyrics-editor-button-bg: rgba(255, 255, 255, 0.06);
    --lyrics-editor-button-border: rgba(255, 255, 255, 0.1);
    --lyrics-editor-button-color: rgba(255, 255, 255, 0.82);
    --lyrics-editor-button-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
    --lyrics-editor-expand-bg: rgba(255, 255, 255, 0.06);
    --lyrics-editor-expand-border: rgba(255, 255, 255, 0.1);
    --lyrics-editor-expand-color: rgba(255, 255, 255, 0.68);
}

.song-info-window-drag-strip { /* 样式 */
    position: absolute;
    z-index: 1;
    top: 0;
    left: 0;
    right: 0;
    height: clamp(56px, 9vh, 92px);
    cursor: default;
}

.song-info-column,
.lyrics-editor-column {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
    transition:
        flex-basis 360ms cubic-bezier(0.4, 0, 0.2, 1),
        width 360ms cubic-bezier(0.4, 0, 0.2, 1),
        opacity 360ms cubic-bezier(0.4, 0, 0.2, 1),
        transform 360ms cubic-bezier(0.4, 0, 0.2, 1),
        max-height 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-info-column {
    flex: 0 1 var(--song-info-main-width);
    min-width: 0;
    animation: info-column-enter 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.lyrics-editor-column {
    flex: 1 1 var(--lyrics-panel-width);
    min-width: min(320px, 100%);
    animation: lyrics-column-enter 560ms cubic-bezier(0.16, 1, 0.3, 1) 40ms both;
}

.song-info-main,
.lyrics-editor-panel {
    flex: 1 1 0;
    height: auto;
    min-height: 0;
    max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
    transition:
        max-height 360ms cubic-bezier(0.4, 0, 0.2, 1),
        border-color 160ms ease,
        background-color 160ms ease;
}

.song-info-main {
    overflow: hidden;
}

.song-info-stage--song-expanding,
.song-info-stage--lyrics-expanding,
.song-info-stage--song-expanded,
.song-info-stage--lyrics-expanded {
    gap: 0;
}

.song-info-stage--song-collapsing,
.song-info-stage--lyrics-collapsing {
    gap: var(--song-info-page-gap);
}

.song-info-stage--lyrics-expanding .song-info-column,
.song-info-stage--lyrics-expanded .song-info-column {
    flex-basis: 0;
    width: 0;
    opacity: 0;
    transform: translateX(-18px);
    pointer-events: none;
}

.song-info-stage--lyrics-collapsing .song-info-column {
    flex-basis: var(--song-info-main-width);
    width: auto;
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
}

.song-info-stage--song-expanding .song-info-column,
.song-info-stage--song-expanded .song-info-column {
    flex-basis: 100%;
}

.song-info-stage--song-collapsing .song-info-column {
    flex-basis: var(--song-info-main-width);
}

.song-info-stage--lyrics-expanding .lyrics-editor-column,
.song-info-stage--lyrics-expanded .lyrics-editor-column {
    flex-basis: 100%;
}

.song-info-stage--song-expanding .lyrics-editor-column,
.song-info-stage--song-expanded .lyrics-editor-column {
    flex-basis: 0;
    min-width: 0;
    width: 0;
    opacity: 0;
    transform: translateX(18px);
    pointer-events: none;
}

.song-info-stage--lyrics-collapsing .lyrics-editor-column {
    flex-basis: var(--lyrics-panel-width);
}

.song-info-stage--song-collapsing .lyrics-editor-column {
    flex-basis: var(--lyrics-panel-width);
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
}

.song-info-stage--lyrics-expanding .lyrics-editor-textarea,
.song-info-stage--lyrics-collapsing .lyrics-editor-textarea,
.song-info-stage--song-expanding .song-info-content,
.song-info-stage--song-collapsing .song-info-content {
    scrollbar-width: none;
}

.song-info-stage--lyrics-expanding .lyrics-editor-textarea::-webkit-scrollbar,
.song-info-stage--lyrics-collapsing .lyrics-editor-textarea::-webkit-scrollbar,
.song-info-stage--song-expanding .song-info-content::-webkit-scrollbar,
.song-info-stage--song-collapsing .song-info-content::-webkit-scrollbar {
    width: 0;
    height: 0;
}

.song-info-stage--lyrics-expanded .lyrics-editor-column {
    max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
    height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
}

.lyrics-editor-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--lyrics-editor-panel-border);
    border-radius: 22px;
    background: var(--lyrics-editor-panel-bg);
    box-shadow: var(--lyrics-editor-panel-shadow);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    transform: translateX(0) scale(1);
    transition:
        background-color 160ms ease,
        border-color 160ms ease;
}

.lyrics-editor-panel--expanded {
    transform: translateX(0) scale(1);
}

.modal-external-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    padding: 6px 18px;
    margin-bottom: 10px;
    flex-shrink: 0;
    border: 1px solid var(--modal-external-header-border);
    border-radius: 16px;
    background: var(--modal-external-header-bg);
    box-shadow: var(--modal-external-header-shadow);
    backdrop-filter: blur(18px) saturate(145%);
    -webkit-backdrop-filter: blur(18px) saturate(145%);
}

.song-info-content {
    min-height: 0;
    flex: 1 1 auto;
    padding: clamp(18px, 2.2vw, 24px);
}

.song-info-hero {
    gap: clamp(16px, 2vw, 24px);
}

:deep(.song-info-cover) {
    width: clamp(96px, 10vw, 128px);
    height: clamp(96px, 10vw, 128px);
    position: relative;
    padding: 0;
    color: inherit;
    cursor: default;
    transform: translateZ(0);
    border-radius: 12px;
    overflow: hidden;
}

:deep(.song-info-cover:disabled) {
    opacity: 1;
}

:deep(.song-info-cover--editable) {
    cursor: pointer;
}

:deep(.song-info-cover--editable:hover) {
    border-color: rgba(236, 65, 65, 0.35);
}

/* 底部圆角与外层容器对齐，保证覆盖层不出现直角 */
:deep(.song-info-cover-overlay) {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    background: rgba(15, 23, 42, 0.62);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 0 0 12px 12px;
}

:deep(.song-info-name) {
    font-size: clamp(22px, 2.8vw, 30px);
    line-height: 1.18;
}

:deep(.song-info-detail-grid) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(14px, 1.8vw, 24px) clamp(12px, 1.6vw, 16px);
}

:deep(.song-info-header-title) {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

:deep(.song-info-edit-toggle) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    padding: 0;
    color: var(--lyrics-editor-button-color);
    line-height: 1;
    transition:
        color 160ms ease,
        background-color 160ms ease,
        border-color 160ms ease;
}

:deep(.song-info-edit-toggle:hover),
:deep(.song-info-edit-toggle--active) {
    background: transparent;
    color: #ec4141;
}

/* 提升为独立合成层，规避圆角裁剪在 Chromium 下的溢出缺陷 */
:deep(.song-info-edit-wrapper) {
    position: relative;
    width: 100%;
}

:deep(.song-info-edit-label) {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    letter-spacing: 0.05em;
    pointer-events: none;
    user-select: none;
    transition:
        opacity 160ms ease,
        color 160ms ease;
}

:deep(.song-info-edit-wrapper:focus-within .song-info-edit-label) {
    color: #ec4141;
}

:deep(.song-info-edit-input) {
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.64);
    padding: 9px 11px;
    color: rgb(17 24 39);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
    outline: none;
    transition:
        box-shadow 160ms ease,
        border-color 160ms ease,
        background-color 160ms ease;
}

:deep(.song-info-edit-input:focus) {
    border-color: rgba(236, 65, 65, 0.45);
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.1);
}

:deep(.song-info-edit-input--title) {
    padding: 10px 12px;
    font-size: clamp(21px, 2.6vw, 28px);
    font-weight: 800;
}

:deep(.song-info-edit-input--artist) {
    font-size: 16px;
}

:deep(.song-info-edit-input--compact) {
    height: 32px;
    padding: 6px 8px;
    font-size: 13px;
}

.song-info-edit-error { /* 样式 */
    margin-bottom: 14px;
    padding: 10px 12px;
    border: 1px solid rgba(236, 65, 65, 0.22);
    border-radius: 12px;
    background: rgba(236, 65, 65, 0.08);
    color: #ec4141;
    font-size: 12px;
    line-height: 1.5;
}

.song-info-stage--dark :deep(.song-info-edit-input) {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
}

.song-info-stage--dark :deep(.song-info-edit-input:focus) {
    border-color: rgba(236, 65, 65, 0.42);
    background: rgba(255, 255, 255, 0.1);
}

.song-info-stage--dark :deep(.song-info-edit-label) {
    color: rgba(255, 255, 255, 0.4);
}

.song-info-stage--dark
    :deep(.song-info-edit-wrapper:focus-within .song-info-edit-label) {
    color: #ec4141;
}

.lyrics-editor-header {
    padding-right: 18px;
}

:deep(.lyrics-editor-heading) {
    display: flex;
    align-items: center;
    gap: 18px;
    min-width: 0;
}

:deep(.lyrics-editor-expand-button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--lyrics-editor-expand-color);
    transition:
        color 160ms ease,
        background-color 160ms ease,
        border-color 160ms ease;
}

:deep(.lyrics-editor-expand-button:hover) {
    background: transparent;
    color: #ec4141;
}

.song-info-stage--dark :deep(.lyrics-editor-expand-button:hover) {
    color: #ff8b8b;
    border-color: rgba(236, 65, 65, 0.4);
}

:deep(.lyrics-editor-title) {
    flex-shrink: 0;
    color: var(--lyrics-editor-title-color);
    font-size: 18px;
    font-weight: 800;
    line-height: 1.2;
}

:deep(.lyrics-editor-inline-song) {
    display: flex;
    align-items: center;
    gap: 12px;
    animation: lyrics-summary-enter 160ms ease both;
}

:deep(.lyrics-editor-inline-song--hidden) {
    opacity: 0;
    visibility: hidden;
}

:deep(.lyrics-editor-cover) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 10px;
    background: rgba(148, 163, 184, 0.14);
}

:deep(.lyrics-editor-cover img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.lyrics-editor-textarea {
    flex: 1;
    box-sizing: border-box;
    width: 100%;
    min-height: 420px;
    resize: none;
    border: 0;
    background: transparent;
    padding: 18px;
    outline: none;
    color: var(--lyrics-editor-text-color);
    font-family:
        "Sarasa Gothic SC", "Sarasa Mono SC", "Sarasa Gothic", "Sarasa Mono",
        sans-serif;
    font-size: 13px;
    line-height: 1.7;
}

.lyrics-editor-panel--expanded .lyrics-editor-textarea {
    min-height: 0;
}

.modal-action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 88px;
    height: 44px;
    padding: 0 16px;
    border: 1px solid var(--lyrics-editor-button-border);
    border-radius: 10px;
    background: var(--lyrics-editor-button-bg);
    box-shadow: var(--lyrics-editor-button-shadow);
    color: var(--lyrics-editor-button-color);
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    backdrop-filter: blur(16px) saturate(145%);
    -webkit-backdrop-filter: blur(16px) saturate(145%);
    transition:
        box-shadow 160ms ease,
        color 160ms ease,
        background-color 160ms ease,
        border-color 160ms ease;
}

@keyframes lyrics-summary-enter {
    from {
        opacity: 0;
        transform: translateY(-6px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes info-column-enter {
    from {
        transform: translateX(-24px);
    }
    to {
        transform: translateX(0);
    }
}

@keyframes lyrics-column-enter {
    from {
        transform: translateX(24px);
    }
    to {
        transform: translateX(0);
    }
}

@media (prefers-reduced-motion: reduce) { /* 样式 */
    .song-info-stage,
    .song-info-column,
    .lyrics-editor-column,
    .lyrics-editor-panel {
        transition-duration: 0ms;
    }

    .song-info-column,
    .lyrics-editor-column {
        animation: none;
    }

    :deep(.lyrics-editor-inline-song) {
        animation: none;
    }
}

.lyrics-editor-textarea::placeholder {
    color: var(--lyrics-editor-placeholder-color);
}

.lyrics-editor-error {
    margin: 0 18px 12px;
    padding: 10px 12px;
    border: 1px solid rgba(236, 65, 65, 0.22);
    border-radius: 12px;
    background: rgba(236, 65, 65, 0.08);
    color: #ec4141;
    font-size: 12px;
    line-height: 1.5;
}

.modal-external-actions {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + var(--song-info-footer-gap));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: var(--song-info-footer-height);
    background: transparent;
    pointer-events: auto;
}

.lyrics-editor-actions {
    gap: clamp(10px, 1.4vw, 20px);
}

.modal-action-button--wide {
    min-width: 184px;
}

.modal-action-button:hover:not(:disabled) {
    color: #ec4141;
    border-color: rgba(236, 65, 65, 0.38);
}

.modal-action-button:disabled {
    opacity: 0.48;
    cursor: not-allowed;
}

.modal-action-button--primary {
    background: #ec4141;
    color: #fff;
    border-color: transparent;
}

.song-info-stage--dark .modal-action-button--primary {
    background: #ec4141;
    color: #fff;
}

:deep(.song-info-edit-input--with-label) {
    padding-left: 56px;
}

/* 文本选中与图片拖拽行为的细化控制 */
:deep(.no-text-select) {
    -webkit-user-select: none;
    user-select: none;
}

:deep(.selectable-text) {
    -webkit-user-select: text;
    user-select: text;
}

.modal-external-header,
.modal-external-actions,
.modal-action-button {
    -webkit-user-select: none;
    user-select: none;
}

:deep(.song-info-header-title),
:deep(.song-info-edit-toggle),
:deep(.lyrics-editor-expand-button),
:deep(.lyrics-editor-inline-song),
:deep(.song-info-cover),
:deep(.song-info-cover-overlay),
:deep(.song-info-detail-grid),
:deep(.song-info-time-grid) {
    -webkit-user-select: none;
    user-select: none;
}

.song-info-stage :deep(input),
.song-info-stage :deep(textarea),
.song-info-stage :deep([contenteditable="true"]),
.song-info-stage :deep(.selectable-text) {
    -webkit-user-select: text;
    user-select: text;
}

:deep(.song-info-cover img) {
    border-radius: 12px;
    -webkit-user-drag: none;
    user-drag: none;
}

:deep(.lyrics-editor-cover img) {
    -webkit-user-drag: none;
    user-drag: none;
}

@media (max-width: 1100px) { /* 样式 */
    .song-info-stage {
        --song-info-footer-height: clamp(42px, 6vh, 48px);
        --song-info-footer-gap: 10px;
        --song-info-viewport-x: clamp(180px, 24vw, 280px);
        --song-info-viewport-y: clamp(120px, 20vh, 190px);
        flex-direction: column;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        width: min(100%, calc(100vw - var(--song-info-viewport-x)));
        height: calc(100dvh - var(--song-info-viewport-y));
        max-height: calc(100dvh - var(--song-info-viewport-y));
    }

    .song-info-stage::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
    }

    .modal-external-actions {
        position: static;
        justify-content: center;
        margin-top: var(--song-info-footer-gap);
    }

    .song-info-stage--lyrics-expanding .song-info-column,
    .song-info-stage--lyrics-expanded .song-info-column {
        position: absolute;
        inset: 0;
    }

    .song-info-column,
    .lyrics-editor-column,
    .song-info-main,
    .lyrics-editor-panel {
        max-height: none;
    }

    .song-info-main {
        flex: 0 0 auto;
        height: auto;
        overflow: visible;
    }

    .song-info-content {
        overflow: visible;
    }

    .song-info-column,
    .song-info-stage--lyrics-collapsing .song-info-column {
        flex: 0 0 auto;
        width: 100%;
        height: auto;
    }

    .lyrics-editor-column,
    .song-info-stage--lyrics-collapsing .lyrics-editor-column {
        flex: 0 0 min(440px, calc(100dvh - var(--song-info-viewport-y)));
        width: 100%;
        min-width: 0;
        min-height: 360px;
    }

    .song-info-stage--lyrics-expanding .lyrics-editor-column,
    .song-info-stage--lyrics-expanded .lyrics-editor-column {
        flex-basis: auto;
        max-height: calc(100dvh - var(--song-info-viewport-y));
        height: calc(100dvh - var(--song-info-viewport-y));
    }

    .lyrics-editor-textarea {
        min-height: 280px;
    }

    .lyrics-editor-panel--expanded .lyrics-editor-textarea {
        min-height: 0;
    }

    :deep(.lyrics-editor-heading) {
        gap: 12px;
    }
}

@media (max-width: 760px) { /* 样式 */
    .song-info-stage {
        --song-info-viewport-x: clamp(96px, 20vw, 132px);
        --song-info-viewport-y: clamp(72px, 16vh, 112px);
        --song-info-footer-height: 42px;
        border-radius: 18px;
    }

    .song-info-hero {
        flex-direction: row;
        align-items: center;
        gap: 14px;
    }

    :deep(.song-info-cover) {
        width: 84px;
        height: 84px;
    }

    :deep(.song-info-name) {
        font-size: 22px;
    }

    :deep(.song-info-detail-grid) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .song-info-footer,
    .lyrics-editor-actions {
        gap: 8px;
    }

    .modal-action-button {
        min-width: 76px;
        height: 38px;
        padding-inline: 11px;
        font-size: 13px;
    }

    .modal-action-button--wide {
        min-width: 152px;
    }
}

@media (max-width: 520px) { /* 样式 */
    .song-info-stage {
        --song-info-viewport-x: 64px;
        --song-info-viewport-y: 56px;
        --song-info-footer-height: 42px;
        border-radius: 16px;
    }

    .song-info-content {
        padding: 12px;
    }

    .song-info-hero {
        gap: 10px;
    }

    :deep(.song-info-cover) {
        width: 64px;
        height: 64px;
    }

    :deep(.song-info-detail-grid),
    :deep(.song-info-time-grid) {
        grid-template-columns: 1fr;
    }

    .modal-action-button--wide {
        min-width: 0;
    }

    .modal-external-header {
        min-height: 48px;
        padding: 5px 14px;
    }

    :deep(.lyrics-editor-expand-button) {
        width: 32px;
        height: 32px;
    }
}

@media (max-height: 720px) { /* 样式 */
    .song-info-stage {
        --song-info-footer-height: 42px;
        --song-info-viewport-y: clamp(88px, 18vh, 140px);
    }

    .modal-external-header {
        min-height: 48px;
        padding-block: 5px;
    }

    .lyrics-editor-textarea {
        min-height: 220px;
        padding-block: 14px;
    }

    :deep(.song-info-cover) {
        width: clamp(84px, 12vh, 112px);
        height: clamp(84px, 12vh, 112px);
    }
}
</style>
