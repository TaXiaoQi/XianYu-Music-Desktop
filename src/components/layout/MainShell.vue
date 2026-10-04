<script setup lang="ts"> // 实现
import { computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia'; // 实现

import { useAppShell } from '../../composables/useAppShell'; // 实现
import { useWindowMaterial } from '../../composables/windowMaterial';
import { useDesktopLyricsWindowBridge } from '../../composables/useDesktopLyricsWindowBridge'; // 实现
import { useUiStore } from '../../shared/stores/ui'; // 实现
import { useAnnouncement } from '../../composables/useAnnouncement';
import { useFeedbackNotification } from '../../composables/useFeedbackNotification';
import { useNicknameChangeNotification } from '../../composables/useNicknameChangeNotification';
import { useListenResetNotification } from '../../composables/useListenResetNotification';
import { useLxUpdateAlert } from '../../composables/useLxUpdateAlert';
import { useUpdateCheck } from '../../composables/useUpdateCheck'; // 更新检查
import { useOnboarding } from '../../composables/useOnboarding'; // 实现
import { useSettingsStore } from '../../features/settings/store';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { useDownloadDialog } from '../../composables/useDownloadDialog';
import { showBetaGateDialog, showBetaUnverifiedDialog } from '../../composables/useBanDialog';
import { verifyBetaAccess } from '../../utils/update';
import { appApi } from '../../services/tauri/appApi';
import { APP_VERSION } from '../../../version';

import Sidebar from './Sidebar.vue'; // 实现
import TitleBar from './TitleBar.vue'; // 实现
import PlayerFooter from './PlayerFooter.vue'; // 实现
import GlobalBackground from './GlobalBackground.vue'; // 实现
import StartupCompositionMask from './shell/StartupCompositionMask.vue';
import DragDropHint from './shell/DragDropHint.vue';
import LibraryScanToast from './shell/LibraryScanToast.vue';
import AnnouncementModalStack from './shell/AnnouncementModalStack.vue';
import GlobalDialogLayer from './shell/GlobalDialogLayer.vue';
import {
  LazyOnboardingModal,
  LazyPlayQueueSidebar,
  LazyCommentPanel,
  LazyPlayerDetail,
  LazyAddToPlaylistModal,
  LazySongInfoModal,
  LazyDownloadDialog,
  LazyUpdateModal,
  LazyLxUpdateAlertModal,
} from './shell/lazyShellOverlays';

defineProps<{
  sleep?: boolean;
}>();

const {
  isMiniMode,
  isExternalDragActive, // 实现
  libraryScanProgress, // 实现
  libraryScanPhaseLabel, // 实现
  libraryScanFolderLabel, // 实现
  libraryScanPercent, // 实现
  isFooterVisible, // 实现
  mainContainerClass, // 实现
  mainBlurStyle, // 实现
  footerContainerClass, // 实现
  footerBlurStyle, // 实现
  showAddToPlaylistModal, // 实现
  playlistAddTargetSongs, // 实现
  excludedPlaylistId,
  closeAddToPlaylistDialog, // 实现
  handleGlobalAdd, // 实现
} = useAppShell(); // 实现

const {
  isSongInfoVisible: trackInfoShown,
  currentSongInfo: trackInfoData,
  songInfoInitialAction: trackInfoEntry,
  closeSongInfo: dismissTrackInfo,
} = useSongInfoDialog(); // 实现

const {
  isDownloadDialogVisible: downloadShown,
  currentDownloadSong: downloadTarget,
  currentDownloadInitialQuality: downloadEntry,
  closeDownloadDialog: dismissDownload,
} = useDownloadDialog(); // 实现

const {
  startupCompositionMaskVisible: bootVeilShown,
  fullscreenAnimState: routeSwapMotion,
} = storeToRefs(useUiStore());
const {
  materialTransitionMaskVisible: materialVeilShown,
  materialSwitching: materialVeilActive,
} = useWindowMaterial();

useDesktopLyricsWindowBridge(); // 实现

const {
  announcementVisible: noticeShown,
  currentAnnouncement: noticeData,
  checkAnnouncement: pollNotice,
  closeAnnouncement: dismissNotice,
  handleAnnouncementAction: applyNoticeAction,
} = useAnnouncement();

const {
  feedbackVisible: feedbackShown,
  currentFeedbackNotification: feedbackData,
  checkFeedbackNotification: pollFeedback,
  closeFeedbackNotification: dismissFeedback,
} = useFeedbackNotification();

const {
  nicknameVisible: nicknameShown,
  currentNicknameNotification: nicknameData,
  checkNicknameChangeNotification: pollNickname,
  closeNicknameChangeNotification: dismissNickname,
} = useNicknameChangeNotification();

const {
  listenResetVisible: listenResetShown,
  currentListenResetNotification: listenResetData,
  checkListenResetNotification: pollListenReset,
  closeListenResetNotification: dismissListenReset,
} = useListenResetNotification();

const {
  lxUpdateAlertVisible: lxUpdateAlertShown,
  currentLxUpdateAlert: lxUpdateAlertData,
  isApplyingLxUpdate,
  startLxUpdateAlertListener,
  dismissLxUpdateAlert: dismissLxUpdateAlert,
  confirmLxUpdateAlert: applyLxUpdate,
} = useLxUpdateAlert();

const { // 解构更新状态
  updateVisible: upgradeShown,
  latestUpdate: upgradeInfo,
  closeUpdate: dismissUpgrade,
  isDownloading, // 下载中标记
  downloadProgress, // 下载进度
  downloadAndInstall, // 下载安装
  checkUpdateOnStartup: pollUpgradeOnStartup,
} = useUpdateCheck(); // 解构结束
/* --- 首次启动引导与启动期例行检查 --- */
const { showOnboarding, completeOnboarding } = useOnboarding(); // 实现
const preferenceHub = useSettingsStore();

/* --- 启动时主界面外观样式（毛玻璃强度透传） --- */
const mainSurfaceStyle = computed(() => ({ backdropFilter: mainBlurStyle.value }));
const footerSurfaceStyle = computed(() => ({ backdropFilter: footerBlurStyle.value }));

/* --- 内测资格门槛（最高优先级，开屏即检查；fail-closed：无法验证也锁定）--- */
let betaGateSettled = false;

const runBetaAccessGate = async () => {
  if (import.meta.env.DEV || betaGateSettled) return;
  if (!/-beta/i.test(APP_VERSION)) return;

  while (true) {
    const verdict = await verifyBetaAccess();
    if (verdict) {
      if (verdict.allowed) return;
      betaGateSettled = true;
      const exitConfirmed = await showBetaGateDialog(verdict.pending);
      if (exitConfirmed) await appApi.exitApp();
      return;
    }
    const retry = await showBetaUnverifiedDialog();
    if (!retry) {
      betaGateSettled = true;
      await appApi.exitApp();
      return;
    }
  }
};

const runStartupChecks = () => {
  pollNotice();
  pollFeedback();
  pollNickname();
  pollListenReset();
  if (preferenceHub.settings.checkUpdateOnStartup) {
    pollUpgradeOnStartup();
  }
};

const handleOnboardingComplete = () => {
  completeOnboarding();
  void runBetaAccessGate().then(runStartupChecks);
};

onMounted(() => {
  if (!showOnboarding.value) {
    void runBetaAccessGate().then(runStartupChecks);
  }

  void startLxUpdateAlertListener();

  const notificationTicker = setInterval(() => {
    pollFeedback(noticeShown.value);
    pollNickname(noticeShown.value || feedbackShown.value);
    pollListenReset(noticeShown.value || feedbackShown.value || nicknameShown.value);
  }, 60_000);

  onUnmounted(() => clearInterval(notificationTicker));
});
</script>

<template>
  <div
    class="relative flex h-screen w-full flex-col overflow-hidden font-sans text-gray-800 dark:text-gray-200"
    :class="{ 'material-switching': materialVeilActive }"
  >
    <template v-if="!sleep">
      <template v-if="showOnboarding">
        <LazyOnboardingModal
          v-if="!isMiniMode"
          visible
          @update:visible="showOnboarding = $event"
          @complete="handleOnboardingComplete"
        />
      </template>

      <template v-else>
        <transition
          name="window-restore"
        >
          <GlobalBackground v-if="!isMiniMode" />
        </transition>

        <transition
          name="startup-composition-mask"
        >
          <StartupCompositionMask v-if="bootVeilShown && !isMiniMode" />
        </transition>

        <transition
          name="material-transition-mask"
        >
          <div
            v-if="materialVeilShown && !isMiniMode"
            class="material-transition-mask pointer-events-none fixed inset-0 z-[9999] bg-white dark:bg-[#262626]"
          ></div>
        </transition>

        <transition
          name="drop-overlay"
        >
          <DragDropHint v-if="isExternalDragActive && !isMiniMode" />
        </transition>

        <transition
          name="scan-progress"
        >
          <LibraryScanToast
            v-if="!isMiniMode && libraryScanProgress"
            :snapshot="libraryScanProgress"
            :phase-label="libraryScanPhaseLabel"
            :folder-label="libraryScanFolderLabel"
            :percent="libraryScanPercent"
          />
        </transition>

        <div
          v-if="!isMiniMode"
          class="relative z-10 flex flex-1 overflow-hidden transition-colors duration-500"
          :class="[
            mainContainerClass,
            routeSwapMotion === 'entering' ? 'fs-entering' : '',
            routeSwapMotion === 'exiting' ? 'fs-exiting' : '',
          ]"
          :style="mainSurfaceStyle"
        >
          <Sidebar />

          <div class="flex min-w-0 flex-1 flex-col">
            <TitleBar />
            <main class="relative min-h-0 flex-1 overflow-hidden">
              <router-view
                v-slot="{ Component, route }"
              >
                <transition name="page-fade" :css="true" mode="out-in">
                  <component
                    :is="Component"
                    :key="String(route.name ?? route.path)"
                  />
                </transition>
              </router-view>
            </main>
          </div>
        </div>

        <div
          v-if="isFooterVisible && !isMiniMode"
          class="z-[60] relative transition-colors duration-500"
          :class="footerContainerClass"
          :style="footerSurfaceStyle"
        >
          <LazyPlayerDetail />

          <transition name="footer-slide">
            <PlayerFooter />
          </transition>
        </div>

        <LazyPlayQueueSidebar v-if="!isMiniMode" />
        <LazyCommentPanel v-if="!isMiniMode" />

        <LazyAddToPlaylistModal
          v-if="showAddToPlaylistModal && !isMiniMode"
          :visible="showAddToPlaylistModal"
          :selectedCount="playlistAddTargetSongs.length"
          :excluded-playlist-id="excludedPlaylistId"
          @close="closeAddToPlaylistDialog"
          @add="handleGlobalAdd"
        />

        <LazySongInfoModal
          v-if="trackInfoShown && !isMiniMode"
          :visible="trackInfoShown"
          :song="trackInfoData"
          :initial-action="trackInfoEntry"
          @close="dismissTrackInfo"
        />

        <LazyDownloadDialog
          v-if="!isMiniMode"
          :visible="downloadShown"
          :song="downloadTarget"
          :initial-quality="downloadEntry"
          @close="dismissDownload"
        />

        <AnnouncementModalStack
          v-if="!isMiniMode"
          :announcement-visible="noticeShown"
          :announcement-payload="noticeData"
          :feedback-visible="feedbackShown"
          :feedback-payload="feedbackData"
          :nickname-visible="nicknameShown"
          :nickname-payload="nicknameData"
          :listen-reset-visible="listenResetShown"
          :listen-reset-payload="listenResetData"
          @close-announcement="dismissNotice"
          @action-announcement="applyNoticeAction"
          @close-feedback="dismissFeedback"
          @close-nickname="dismissNickname"
          @close-listen-reset="dismissListenReset"
        />

        <LazyLxUpdateAlertModal
          v-if="!isMiniMode"
          :visible="lxUpdateAlertShown"
          :alert="lxUpdateAlertData"
          :is-updating="isApplyingLxUpdate"
          @close="dismissLxUpdateAlert"
          @confirm="applyLxUpdate"
        />

        <LazyUpdateModal
          v-if="upgradeShown && !isMiniMode"
          :visible="upgradeShown"
          :update="upgradeInfo"
          :is-downloading="isDownloading"
          :progress="downloadProgress"
          @close="dismissUpgrade"
          @download="downloadAndInstall"
        />
      </template>
    </template>

    <GlobalDialogLayer />
  </div>
</template>

<style>
/* ---- 路由页切换：下方 8px 上移淡入 / 上方 6px 淡出（reduced-motion 下由 style.css 覆盖为纯透明度） ---- */
.page-fade-enter-active, .page-fade-leave-active {
  transition:
    opacity var(--motion-dur-base) var(--motion-ease-emphasized),
    transform var(--motion-dur-base) var(--motion-ease-emphasized);
}
.page-fade-leave-active { pointer-events: none; }
.page-fade-enter-from { opacity: 0; transform: translateY(8px) scale(0.996); }
.page-fade-leave-to { opacity: 0; transform: translateY(-6px) scale(0.996); }

.footer-slide-enter-active, .footer-slide-leave-active { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.footer-slide-enter-from, .footer-slide-leave-to { transform: translateY(100%); max-height: 0 !important; opacity: 0; }
.footer-slide-enter-to, .footer-slide-leave-from { transform: translateY(0); max-height: 80px !important; opacity: 1; }

.window-restore-enter-active { transition: opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.window-restore-leave-active { transition: none; }
.window-restore-enter-from { opacity: 0; transform: scale(0.95); }
.window-restore-leave-to { opacity: 0; }

.material-transition-mask-enter-active { transition: none; }
.material-transition-mask-leave-active { transition: opacity 0.2s ease; }
.material-transition-mask-leave-to { opacity: 0; }

.material-switching, .material-switching *:not(.material-transition-mask) { transition: none !important; }
</style>
