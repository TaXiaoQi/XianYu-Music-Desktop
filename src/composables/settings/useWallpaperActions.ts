import { computed, ref } from "vue";
import { toolboxApi } from "../../services/tauri/toolboxApi";
import {
    DOWNLOADED_WALLPAPERS_KEY,
    resolveMediaType,
    type DownloadedWallpaper,
    type MediaType,
    type Wallpaper,
} from "./wallpaperTypes";

interface UseWallpaperActionsOptions {
    /** 当前应用的壁纸本地路径（用于标记「正在使用」） */
    currentPath: () => string | undefined;
    /** 选定壁纸后回传给父级（对应 emit("select")） */
    onSelect: (localPath: string, mediaType: MediaType) => void;
    /** 选定后请求关闭弹层（对应 handleClose） */
    onCloseRequest: () => void;
}

/**
 * 壁纸中心下载/删除/应用：
 * 本地下载记录的持久化、批量选择删除、下载并使用与已下载壁纸的直接应用。
 */
export function useWallpaperActions({
    currentPath,
    onSelect,
    onCloseRequest,
}: UseWallpaperActionsOptions) {
    const downloadingId = ref<number | null>(null); // 实现
    const downloadError = ref("");
    const downloadedWallpapers = ref<DownloadedWallpaper[]>([]);
    const selectedDownloadIds = ref<number[]>([]);
    const deletingDownloads = ref(false);
    const showBatchOps = ref(false);

    const isCurrentWallpaper = (localPath: string) => {
        return !!currentPath() && currentPath() === localPath;
    };

    const isWallpaperInUse = (id: number) => {
        const record = downloadedRecord(id);
        return !!record && isCurrentWallpaper(record.localPath);
    };

    const loadDownloadedWallpapers = () => {
        try {
            const raw = localStorage.getItem(DOWNLOADED_WALLPAPERS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            downloadedWallpapers.value = Array.isArray(parsed)
                ? parsed.filter(
                      (item): item is DownloadedWallpaper =>
                          !!item &&
                          typeof item.id === "number" &&
                          typeof item.localPath === "string",
                  )
                : [];
        } catch {
            downloadedWallpapers.value = [];
        }
    };

    const persistDownloadedWallpapers = () => {
        localStorage.setItem(
            DOWNLOADED_WALLPAPERS_KEY,
            JSON.stringify(downloadedWallpapers.value),
        );
    };

    const downloadedIdSet = computed(
        () => new Set(downloadedWallpapers.value.map((item) => item.id)),
    );

    const isDownloaded = (id: number) => downloadedIdSet.value.has(id);

    const downloadedRecord = (id: number) =>
        downloadedWallpapers.value.find((item) => item.id === id);

    const downloadAndUse = async (wallpaper: Wallpaper) => { // 实现
        if (downloadingId.value !== null) return;
        downloadingId.value = wallpaper.id;
        downloadError.value = "";
        try {
            const mediaType = resolveMediaType(
                wallpaper.mediaType || (wallpaper.videoUrl ? "video" : "image"),
            );
            const isVideo = mediaType === "video";
            // 文件名含 sha8：服务端 hash 变化自动产生新文件，命中即复用免下载
            const sha8 =
                isVideo && wallpaper.videoSha256
                    ? wallpaper.videoSha256.slice(0, 8)
                    : "";
            const targetName = `wallpaper_${wallpaper.id}${sha8 ? `_${sha8}` : ""}.${isVideo ? "mp4" : "jpg"}`;
            const record = downloadedRecord(wallpaper.id);
            const reuse =
                record &&
                record.localPath &&
                record.localPath.split(/[\\/]/).pop() === targetName;
            let localPath = reuse ? record!.localPath : "";
            if (!localPath) {
                const sourceUrl = isVideo
                    ? wallpaper.videoUrl || wallpaper.imageUrl
                    : wallpaper.imageUrl;
                localPath = await toolboxApi.downloadWallpaper(
                    sourceUrl,
                    targetName,
                    currentPath() || undefined,
                );
                const fresh: DownloadedWallpaper = {
                    ...wallpaper,
                    mediaType,
                    localPath,
                    downloadedAt: new Date().toISOString(),
                };
                downloadedWallpapers.value = [
                    fresh,
                    ...downloadedWallpapers.value.filter(
                        (item) => item.id !== wallpaper.id,
                    ),
                ];
                persistDownloadedWallpapers();
            }
            onSelect(
                localPath,
                resolveMediaType(
                    downloadedRecord(wallpaper.id)?.mediaType || mediaType,
                ),
            );
            onCloseRequest();
        } catch (err) {
            downloadError.value = err instanceof Error ? err.message : String(err);
        } finally {
            downloadingId.value = null;
        }
    }; // 实现
    const toggleDownloadSelection = (id: number) => {
        selectedDownloadIds.value = selectedDownloadIds.value.includes(id)
            ? selectedDownloadIds.value.filter((item) => item !== id)
            : [...selectedDownloadIds.value, id];
    };

    const selectAllDownloads = () => {
        selectedDownloadIds.value = downloadedWallpapers.value.map(
            (item) => item.id,
        );
    };

    const clearDownloadSelection = () => {
        selectedDownloadIds.value = [];
    };

    const deleteSelectedDownloads = async () => {
        if (selectedDownloadIds.value.length === 0 || deletingDownloads.value)
            return;
        const ids = new Set(selectedDownloadIds.value);
        const targets = downloadedWallpapers.value.filter((item) =>
            ids.has(item.id),
        );
        deletingDownloads.value = true;
        downloadError.value = "";
        try {
            await Promise.all(
                targets.map((item) =>
                    toolboxApi
                        .deleteWallpaperFile(item.localPath)
                        .catch(() => undefined),
                ),
            );
            downloadedWallpapers.value = downloadedWallpapers.value.filter(
                (item) => !ids.has(item.id),
            );
            selectedDownloadIds.value = [];
            persistDownloadedWallpapers();
        } catch (err) {
            downloadError.value = err instanceof Error ? err.message : String(err);
        } finally {
            deletingDownloads.value = false;
        }
    };

    const useDownloadedWallpaper = (item: DownloadedWallpaper) => {
        onSelect(item.localPath, resolveMediaType(item.mediaType));
        onCloseRequest();
    };

    return {
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
    };
}
