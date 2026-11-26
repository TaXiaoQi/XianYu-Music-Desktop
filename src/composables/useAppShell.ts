import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";

import { usePlayer } from "../features/playback";
import { useAddToPlaylistDialog } from "../features/collections/addToPlaylistDialog";
import { usePlayerLibraryView } from "../features/library/usePlayerLibraryView";
import {
    shouldUseMiniForOpen,
    type MiniOpenPathSource,
} from "../features/miniPlayer/openLocalAudioInMini";
import { useSettings } from "../features/settings/useSettings";
import { useUiStore } from "../shared/stores/ui";

import { shouldShowPlayerFooter } from "./appShellFooterState";
import { createLibraryScanStatus } from "./appShellScanStatus";
import { createStartupRevealSequence } from "./appShellStartupReveal";
import { useAppShellTheme } from "./useAppShellTheme";
import { useAppThemeSync } from "./useAppThemeSync";
import { useDeepLinkBridge } from "./useDeepLinkBridge";
import { useExternalPathBridge } from "./useExternalPathBridge";
import { useHomeRouteSync } from "./useHomeRouteSync";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useMainWindowRenderingPower } from "./renderingPower";
import { useMiniPlayerWindowBridge, waitForMiniSurfaceShown } from "./useMiniPlayerWindowBridge";
import { useOnboarding } from "./useOnboarding";
import { usePerformanceMode } from "./usePerformanceMode";
import { usePlayerViewState } from "./usePlayerViewState";
import { useTaskbarPlayerBridge } from "./useTaskbarPlayerBridge";
import { useTrayMenuEvents } from "./useTrayMenuEvents";
import { useWindowResizeCoordinator } from "./windowResizeCoordinator";

/**
 * 外壳装配根：把播放器、主题材质、启动揭示、外部路径、
 * 全局弹窗等横切关注点编排成一个供 MainShell 消费的视图模型。
 */
export function useAppShell() {
    const route = useRoute();
    const router = useRouter();

    const {
        init: bootstrapPlayer,
        playQueue: queuedSongs,
        currentSong: activeSong,
        isMiniMode: miniModeActive,
        showPlayerDetail: playerDetailOpen,
        handleExternalPaths: processExternalPaths,
        libraryScanProgress: scanProgress,
    } = usePlayer();

    const {
        showAddToPlaylistModal: playlistDialogVisible,
        playlistAddTargetSongs: songsQueuedForPlaylist,
        excludedPlaylistId: playlistExclusionId,
        closeAddToPlaylistDialog: dismissPlaylistDialog,
        addSelectedSongsToPlaylist: pushSongsToPlaylist,
    } = useAddToPlaylistDialog();

    const {
        hasWindowMaterial: windowMaterialReady,
        isMicaWindowMaterial: micaMaterialActive,
        whenInitialThemeSynced: afterThemeBootstrap,
        rebuildStartupMaterialBeforeShow: refreshMaterialBeforeReveal,
    } = useAppThemeSync();

    const { isLowPerformance: powerSavingPreferred } = usePerformanceMode();
    const { isMainWindowLowPower: lowPowerWindowRendering } =
        useMainWindowRenderingPower();
    const cappedEffects = computed(
        () => powerSavingPreferred.value || lowPowerWindowRendering.value,
    );

    const {
        mainBlurStyle: backdropBlurStyle,
        mainContainerClass: backdropContainerClass,
        footerBlurStyle: footerBackdropStyle,
        footerContainerClass: footerBackdropClass,
    } = useAppShellTheme({
        showPlayerDetail: playerDetailOpen,
        hasWindowMaterial: windowMaterialReady,
        isMicaWindowMaterial: micaMaterialActive,
        lowPerformance: cappedEffects,
    });

    const {
        skipNextPageTransition: suppressNextTransition,
        startupCompositionMaskVisible: revealMaskActive,
    } = storeToRefs(useUiStore());
    const { showOnboarding: onboardingFlowVisible } = useOnboarding();

    const {
        currentViewMode: homeViewMode,
        filterCondition: homeFilterCondition,
        currentFolderFilter: homeFolderFilter,
        activeRootPath: homeRootPath,
    } = usePlayerViewState();
    const { folderTree: libraryFolderTree, searchQuery: librarySearchTerm } =
        usePlayerLibraryView();

    const revealSequence = createStartupRevealSequence({
        router,
        hasWindowMaterial: windowMaterialReady,
        skipNextPageTransition: suppressNextTransition,
        maskVisible: revealMaskActive,
        whenInitialThemeSynced: afterThemeBootstrap,
        rebuildStartupMaterialBeforeShow: refreshMaterialBeforeReveal,
        onboardingActive: () => onboardingFlowVisible.value,
    });

    const uiStore = useUiStore();
    const { settings: shellSettings } = useSettings();

    /**
     * 外部路径入队后按设置决定是否切 mini 小窗：
     * 判定通过只置 isMiniMode，既有 watch(isMiniMode) 会跑完
     * 「隐藏主窗 → 建窗/复用 → 推状态快照 → 显示」全序列。
     */
    const handleExternalPathsWithMini = async (
        paths: string[],
        options?: { source?: MiniOpenPathSource },
    ) => {
        const openInMini =
            !uiStore.isMiniMode
            && shouldUseMiniForOpen({
                source: options?.source,
                pathCount: paths.length,
                enabled: shellSettings.value.openLocalAudioInMiniWindow,
            });
        if (openInMini) {
            // 先出窗、再播放：避免「先出声后出窗」；超时兜底不阻塞播放
            uiStore.isMiniMode = true;
            await waitForMiniSurfaceShown();
        }
        await processExternalPaths(paths, options);
    };

    const { isExternalDragActive: externalDropPending } = useExternalPathBridge(
        {
            handleExternalPaths: handleExternalPathsWithMini,
            beforeWindowShow: revealSequence.beforeWindowShow,
            afterWindowShow: revealSequence.afterWindowShow,
        },
    );

    useHomeRouteSync({
        route,
        router,
        currentViewMode: homeViewMode,
        filterCondition: homeFilterCondition,
        currentFolderFilter: homeFolderFilter,
        activeRootPath: homeRootPath,
        folderTree: libraryFolderTree,
        searchQuery: librarySearchTerm,
    });

    useMiniPlayerWindowBridge();
    useTaskbarPlayerBridge();
    useKeyboardShortcuts();
    useTrayMenuEvents(router);
    useDeepLinkBridge();
    useWindowResizeCoordinator();

    bootstrapPlayer();

    const footerShown = computed(() =>
        shouldShowPlayerFooter(queuedSongs.value, activeSong.value),
    );
    const {
        percent: scanPercent,
        phaseLabel: scanPhaseText,
        folderLabel: scanFolderText,
    } = createLibraryScanStatus(scanProgress);

    const submitGlobalPlaylistAdd = (playlistId: string) => {
        pushSongsToPlaylist(playlistId);
    };

    const shellViewModel = {
        isMiniMode: miniModeActive,
        showPlayerDetail: playerDetailOpen,
        isExternalDragActive: externalDropPending,
        libraryScanProgress: scanProgress,
        libraryScanPhaseLabel: scanPhaseText,
        libraryScanFolderLabel: scanFolderText,
        libraryScanPercent: scanPercent,
        isFooterVisible: footerShown,
        mainContainerClass: backdropContainerClass,
        mainBlurStyle: backdropBlurStyle,
        footerContainerClass: footerBackdropClass,
        footerBlurStyle: footerBackdropStyle,
        showAddToPlaylistModal: playlistDialogVisible,
        playlistAddTargetSongs: songsQueuedForPlaylist,
        excludedPlaylistId: playlistExclusionId,
        closeAddToPlaylistDialog: dismissPlaylistDialog,
        handleGlobalAdd: submitGlobalPlaylistAdd,
    };

    return shellViewModel;
}
