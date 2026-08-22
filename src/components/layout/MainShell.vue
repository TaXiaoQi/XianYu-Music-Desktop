<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';

import { useAppShell } from '../../composables/useAppShell';
import { useWindowMaterial } from '../../composables/windowMaterial';
import { useDesktopLyricsWindowBridge } from '../../composables/useDesktopLyricsWindowBridge';
import { useUiStore } from '../../shared/stores/ui';
import { useAnnouncement } from '../../composables/useAnnouncement';
import { useFeedbackNotification } from '../../composables/useFeedbackNotification';
import { useNicknameChangeNotification } from '../../composables/useNicknameChangeNotification';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { useOnboarding } from '../../composables/useOnboarding';
import { useSettingsStore } from '../../features/settings/store';
import Sidebar from './Sidebar.vue';
import TitleBar from './TitleBar.vue';
import PlayerFooter from './PlayerFooter.vue';
import GlobalBackground from './GlobalBackground.vue';

const OnboardingModal = defineAsyncComponent(() => import('../onboarding/OnboardingModal.vue'));
const PlayQueueSidebar = defineAsyncComponent(() => import('../player/PlayQueueSidebar.vue'));
const CommentPanel = defineAsyncComponent(() => import('../overlays/CommentPanel.vue'));
const PlayerDetail = defineAsyncComponent(() => import('../player/PlayerDetail.vue'));
const AddToPlaylistModal = defineAsyncComponent(() => import('../overlays/AddToPlaylistModal.vue'));
const Toast = defineAsyncComponent(() => import('../common/Toast.vue'));
const SettingsConflictDialog = defineAsyncComponent(() => import('../common/SettingsConflictDialog.vue'));
const ProfileLimitDialog = defineAsyncComponent(() => import('../common/ProfileLimitDialog.vue'));
const BanDialog = defineAsyncComponent(() => import('../common/BanDialog.vue'));
const CiyuanxiDialog = defineAsyncComponent(() => import('../common/CiyuanxiDialog.vue'));
const ChangePasswordDialog = defineAsyncComponent(() => import('../common/ChangePasswordDialog.vue'));
const DeleteAccountDialog = defineAsyncComponent(() => import('../common/DeleteAccountDialog.vue'));
const SongInfoModal = defineAsyncComponent(() => import('../overlays/SongInfoModal.vue'));
const DownloadDialog = defineAsyncComponent(() => import('../overlays/DownloadDialog.vue'));
const AnnouncementModal = defineAsyncComponent(() => import('../overlays/AnnouncementModal.vue'));
const UpdateModal = defineAsyncComponent(() => import('../overlays/UpdateModal.vue'));
const CustomSkinModal = defineAsyncComponent(() => import('../settings/CustomSkinModal.vue'));

defineProps<{
  sleep?: boolean;
}>();

const {
  isMiniMode,
  isExternalDragActive,
  libraryScanProgress,
  libraryScanPhaseLabel,
  libraryScanFolderLabel,
  libraryScanPercent,
  isFooterVisible,
  mainContainerClass,
  mainBlurStyle,
  footerContainerClass,
  footerBlurStyle,
  showAddToPlaylistModal,
  playlistAddTargetSongs,
  excludedPlaylistId,
  closeAddToPlaylistDialog,
  handleGlobalAdd,
} = useAppShell();

import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
const {
  isSongInfoVisible,
  currentSongInfo,
  songInfoInitialAction,
  closeSongInfo,
} = useSongInfoDialog();
import { useDownloadDialog } from '../../composables/useDownloadDialog';
const {
  isDownloadDialogVisible,
  currentDownloadSong,
  currentDownloadInitialQuality,
  closeDownloadDialog,
} = useDownloadDialog();
const { skipNextPageTransition, startupCompositionMaskVisible, fullscreenAnimState } = storeToRefs(useUiStore());
const uiStore = useUiStore();
const { materialTransitionMaskVisible, materialSwitching } = useWindowMaterial();

useDesktopLyricsWindowBridge();

// Announcement logic
const {
  announcementVisible,
  currentAnnouncement,
  checkAnnouncement,
  closeAnnouncement,
  handleAnnouncementAction,
} = useAnnouncement();

// Feedback completion notification logic（反馈处理完成后，通过公告弹窗通知用户）
const {
  feedbackVisible,
  currentFeedbackNotification,
  checkFeedbackNotification,
  closeFeedbackNotification,
} = useFeedbackNotification();

// Nickname change notification logic（后台管理员修改昵称后，通过公告弹窗通知用户并同步本地昵称）
const {
  nicknameVisible,
  currentNicknameNotification,
  checkNicknameChangeNotification,
  closeNicknameChangeNotification,
} = useNicknameChangeNotification();

// Update check logic（启动时自动检查，由全局单例管理弹窗）
const {
  updateVisible,
  latestUpdate,
  closeUpdate,
  isDownloading,
  downloadProgress,
  downloadAndInstall,
  checkUpdateOnStartup,
} = useUpdateCheck();

// --- 首次启动引导 ---
const { showOnboarding, completeOnboarding } = useOnboarding();

const settingsStore = useSettingsStore();

const handleOnboardingComplete = () => {
  completeOnboarding();
  checkAnnouncement();
  checkFeedbackNotification();
  checkNicknameChangeNotification();
  if (settingsStore.settings.checkUpdateOnStartup) {
    checkUpdateOnStartup();
  }
};

onMounted(() => {
  if (!showOnboarding.value) {
    // 初始化流程拥有首次启动的最高展示优先级，完成后再检查其他启动弹窗。
    checkAnnouncement();
    checkFeedbackNotification();
    checkNicknameChangeNotification();
    if (settingsStore.settings.checkUpdateOnStartup) {
      checkUpdateOnStartup();
    }
  }
  // 定时轮询反馈完成通知与昵称变更通知（后台操作后，客户端约在一分钟内收到）
  const feedbackTimer = setInterval(() => {
    checkFeedbackNotification(announcementVisible.value);
    checkNicknameChangeNotification(announcementVisible.value || feedbackVisible.value);
  }, 60_000);
  onUnmounted(() => clearInterval(feedbackTimer));
});
</script>

<template>
  <div
    class="flex flex-col h-screen w-full text-gray-800 dark:text-gray-200 relative overflow-hidden font-sans"
    :class="{ 'material-switching': materialSwitching }"
  >
    <template v-if="!sleep">
    <template v-if="showOnboarding">
      <OnboardingModal
        v-if="!isMiniMode"
        visible
        @update:visible="showOnboarding = $event"
        @complete="handleOnboardingComplete"
      />
    </template>

    <template v-else>
    <transition name="window-restore">
      <GlobalBackground v-if="!isMiniMode" />
    </transition>

    <transition name="startup-composition-mask">
      <div
        v-if="startupCompositionMaskVisible && !isMiniMode"
        class="startup-composition-mask fixed inset-0 z-[10000] pointer-events-none overflow-hidden"
      >
        <div class="startup-composition-mask__grain"></div>
        <div class="startup-composition-mask__shell">
          <div class="startup-composition-mask__sidebar">
            <div class="startup-composition-mask__brand">
              <div class="startup-composition-mask__brand-dot"></div>
              <div class="startup-composition-mask__brand-line"></div>
            </div>
            <div class="startup-composition-mask__nav">
              <div v-for="index in 6" :key="index" class="startup-composition-mask__nav-line"></div>
            </div>
          </div>
          <div class="startup-composition-mask__main">
            <div class="startup-composition-mask__topbar"></div>
            <div class="startup-composition-mask__content">
              <div class="startup-composition-mask__panel startup-composition-mask__panel--large"></div>
              <div class="startup-composition-mask__panel"></div>
              <div class="startup-composition-mask__panel"></div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="material-transition-mask">
      <div
        v-if="materialTransitionMaskVisible && !isMiniMode"
        class="material-transition-mask fixed inset-0 z-[9999] pointer-events-none bg-white dark:bg-[#262626]"
      ></div>
    </transition>

    <transition name="drop-overlay">
      <div
        v-if="isExternalDragActive && !isMiniMode"
        class="absolute inset-0 z-[140] pointer-events-none flex items-center justify-center bg-black/15 backdrop-blur-sm"
      >
        <div class="rounded-[28px] border border-white/35 bg-white/75 px-8 py-6 text-center shadow-[0_24px_60px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-black/65">
          <div class="text-lg font-semibold text-gray-900 dark:text-white">松开即可导入或播放</div>
          <div class="mt-2 text-sm text-gray-600 dark:text-white/70">音频文件将直接播放，文件夹将导入音乐库</div>
        </div>
      </div>
    </transition>

    <transition name="scan-progress">
      <div
        v-if="libraryScanProgress && !isMiniMode"
        class="hidden absolute right-4 top-14 z-[145] w-[320px] overflow-hidden rounded-[22px] border border-white/45 bg-white/82 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-black/70"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#ec4141]/80">
              {{ libraryScanPhaseLabel }}
            </div>
            <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {{ libraryScanProgress.message || '正在处理音乐库' }}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-white/55">
              <span v-if="libraryScanFolderLabel">{{ libraryScanFolderLabel }}</span>
              <span v-if="libraryScanProgress.total > 0">
                {{ libraryScanProgress.current }}/{{ libraryScanProgress.total }}
              </span>
              <span class="truncate max-w-[220px]" :title="libraryScanProgress.folder_path">
                {{ libraryScanProgress.folder_path }}
              </span>
            </div>
          </div>
          <div
            class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            :class="libraryScanProgress.failed ? 'bg-rose-500' : libraryScanProgress.done ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'"
          ></div>
        </div>

        <div class="mt-3 h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
          <div
            class="h-full rounded-full bg-gradient-to-r from-[#ec4141] via-[#ff8364] to-[#f7b267] transition-[width] duration-300 ease-out"
            :class="{ 'scan-progress-bar-indeterminate': libraryScanProgress.total <= 0 && !libraryScanProgress.done }"
            :style="{ width: `${libraryScanPercent}%` }"
          ></div>
        </div>
      </div>
    </transition>

    <div
      v-if="!isMiniMode"
      class="flex-1 flex overflow-hidden relative z-10 transition-colors duration-500"
      :class="[
        mainContainerClass,
        fullscreenAnimState === 'entering' ? 'fs-entering' : '',
        fullscreenAnimState === 'exiting' ? 'fs-exiting' : '',
      ]"
      :style="{ backdropFilter: mainBlurStyle }"
    >
      <Sidebar />

      <div class="flex-1 flex flex-col min-w-0">
        <TitleBar />
        <main class="flex-1 overflow-hidden relative min-h-0">
          <router-view v-slot="{ Component, route }">
            <!-- 顺序转场（先淡出后淡进）。始终使用同一个 <transition> 容器，
                 绝不切换 'template 分支 / transition 分支' 两种结构，否则
                 skipNextPageTransition 翻转时会把整个页面子树重挂载，在页面
                 异步列表（音乐库扫描/歌单加载）更新进行中把子 vnode 的 el 置空，
                 触发 patchKeyedChildren 卸载时读取 null 的 parentNode 崩溃。
                 skip 期间必须把 mode 置空（不 hold 旧树、不走 out-in 的进出 Frag
                 管理），否则启动重绘的两次连续路由替换会经 out-in 产生 patch 竞态
                 （此前 :name='' + :css=false 仍会走 out-in，双导航下
                 parentNode / subTree / insertBefore 崩溃屡发）。
                 css 保持开启并用纯 CSS 入场动画（page-enter-in）给首进入口补一个
                 淡入：该动画只改合成属性、不参与 Vue 的 DOM 重排，天然不会把
                 异步列表行 el 置 null，在手感上也避免首帧硬切/整页突然出现。 -->
            <transition
              :name="skipNextPageTransition ? 'page-enter' : 'page-fade'"
              :css="true"
              :mode="skipNextPageTransition ? undefined : 'out-in'"
            >
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
      v-if="!isMiniMode && isFooterVisible"
      class="relative z-[60] transition-colors duration-500"
      :class="footerContainerClass"
      :style="{ backdropFilter: footerBlurStyle }"
    >
      <PlayerDetail />

      <transition name="footer-slide">
        <PlayerFooter />
      </transition>
    </div>

    <PlayQueueSidebar v-if="!isMiniMode" />
    <CommentPanel v-if="!isMiniMode" />

    <AddToPlaylistModal
      v-if="!isMiniMode && showAddToPlaylistModal"
      :visible="showAddToPlaylistModal"
      :selectedCount="playlistAddTargetSongs.length"
      :excluded-playlist-id="excludedPlaylistId"
      @close="closeAddToPlaylistDialog"
      @add="handleGlobalAdd"
    />

    <SongInfoModal
      v-if="!isMiniMode && isSongInfoVisible"
      :visible="isSongInfoVisible"
      :song="currentSongInfo"
      :initial-action="songInfoInitialAction"
      @close="closeSongInfo"
    />

    <DownloadDialog
      v-if="!isMiniMode"
      :visible="isDownloadDialogVisible"
      :song="currentDownloadSong"
      :initial-quality="currentDownloadInitialQuality"
      @close="closeDownloadDialog"
    />

    <AnnouncementModal
      v-if="!isMiniMode && announcementVisible"
      :visible="announcementVisible"
      :announcement="currentAnnouncement"
      @close="closeAnnouncement"
      @action="handleAnnouncementAction"
    />

    <AnnouncementModal
      v-if="!isMiniMode && feedbackVisible"
      :visible="feedbackVisible"
      :announcement="currentFeedbackNotification"
      @close="closeFeedbackNotification"
    />

    <AnnouncementModal
      v-if="!isMiniMode && nicknameVisible"
      :visible="nicknameVisible"
      :announcement="currentNicknameNotification"
      @close="closeNicknameChangeNotification"
    />

    <UpdateModal
      v-if="!isMiniMode && updateVisible"
      :visible="updateVisible"
      :update="latestUpdate"
      :is-downloading="isDownloading"
      :progress="downloadProgress"
      @close="closeUpdate"
      @download="downloadAndInstall"
    />
    </template>
    </template>

    <Toast />
    <SettingsConflictDialog />
    <ProfileLimitDialog />
    <BanDialog />
    <CiyuanxiDialog />
    <ChangePasswordDialog />
    <DeleteAccountDialog />
    <CustomSkinModal v-if="uiStore.showCustomSkinModal" @close="uiStore.showCustomSkinModal = false" />
  </div>
</template>

<style>
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

/* 淡出期间离场页面不拦截点击与滚动 */
.page-fade-leave-active {
  pointer-events: none;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 首进入口：纯 CSS 入场动画。只定义 enter-active（入场淡入），不定义任何
   leave 规则 —— 旧树由 Vue 在下一帧直接移除，不进入 out-in 状态机。 */
.page-enter-enter-active {
  animation: page-enter-in 0.22s ease;
}

@keyframes page-enter-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.footer-slide-enter-active,
.footer-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.footer-slide-enter-from,
.footer-slide-leave-to {
  transform: translateY(100%);
  max-height: 0 !important;
  opacity: 0;
}

.footer-slide-enter-to,
.footer-slide-leave-from {
  transform: translateY(0);
  max-height: 80px !important;
  opacity: 1;
}

.window-restore-enter-active {
  transition: opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.window-restore-leave-active {
  transition: none;
}

.window-restore-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.window-restore-leave-to {
  opacity: 0;
}

.startup-composition-mask-enter-active,
.startup-composition-mask-leave-active {
  transition: opacity 0.22s ease;
}

.startup-composition-mask-enter-from,
.startup-composition-mask-leave-to {
  opacity: 0;
}

/* 材质卸载过渡遮罩：瞬间出现，平滑淡出 */
.material-transition-mask-enter-active {
  transition: none;
}

.material-transition-mask-leave-active {
  transition: opacity 0.2s ease;
}

.material-transition-mask-leave-to {
  opacity: 0;
}

/*
 * 材质切换期间禁用所有子元素的 CSS 过渡（排除遮罩自身）。
 * 防止 GlobalBackground / Sidebar / 主容器 / Footer 的 transition-colors duration-500
 * 在切换期间产生半透明背景，导致文字透出重叠。
 */
.material-switching,
.material-switching *:not(.material-transition-mask) {
  transition: none !important;
}

.startup-composition-mask {
  background:
    radial-gradient(circle at 18% 14%, rgba(236, 65, 65, 0.10), transparent 30%),
    linear-gradient(135deg, #f7f7f8 0%, #eeeeef 100%);
}

:global(.dark) .startup-composition-mask {
  background:
    radial-gradient(circle at 18% 14%, rgba(236, 65, 65, 0.10), transparent 30%),
    linear-gradient(135deg, #262626 0%, #2b2b2b 54%, #262626 100%);
}

.startup-composition-mask__grain {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  background-image: linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px);
  background-size: 28px 28px;
}

.startup-composition-mask__shell {
  position: absolute;
  inset: 0;
  display: flex;
  opacity: 0.58;
}

.startup-composition-mask__sidebar {
  width: 220px;
  border-right: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.32);
  padding: 24px 18px;
}

:global(.dark) .startup-composition-mask__sidebar {
  border-right-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.035);
}

.startup-composition-mask__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 34px;
}

.startup-composition-mask__brand-dot {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(236, 65, 65, 0.78);
  box-shadow: 0 12px 32px rgba(236, 65, 65, 0.22);
}

.startup-composition-mask__brand-line,
.startup-composition-mask__nav-line,
.startup-composition-mask__topbar,
.startup-composition-mask__panel {
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.08);
}

:global(.dark) .startup-composition-mask__brand-line,
:global(.dark) .startup-composition-mask__nav-line,
:global(.dark) .startup-composition-mask__topbar,
:global(.dark) .startup-composition-mask__panel {
  background: rgba(255, 255, 255, 0.07);
}

.startup-composition-mask__brand-line {
  width: 86px;
  height: 14px;
}

.startup-composition-mask__nav {
  display: grid;
  gap: 14px;
}

.startup-composition-mask__nav-line {
  width: 100%;
  height: 34px;
}

.startup-composition-mask__nav-line:nth-child(2),
.startup-composition-mask__nav-line:nth-child(5) {
  width: 78%;
}

.startup-composition-mask__main {
  flex: 1;
  min-width: 0;
  padding: 24px 28px;
}

.startup-composition-mask__topbar {
  height: 34px;
  width: min(560px, 58%);
  margin-left: auto;
}

.startup-composition-mask__content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 44px;
}

.startup-composition-mask__panel {
  min-height: 132px;
}

.startup-composition-mask__panel--large {
  grid-column: 1 / -1;
  min-height: 250px;
}

@media (max-width: 760px) {
  .startup-composition-mask__sidebar {
    width: 72px;
    padding-inline: 14px;
  }

  .startup-composition-mask__brand-line,
  .startup-composition-mask__nav-line {
    display: none;
  }

  .startup-composition-mask__content {
    grid-template-columns: 1fr;
  }
}

.drop-overlay-enter-active,
.drop-overlay-leave-active {
  transition: opacity 0.18s ease;
}

.drop-overlay-enter-from,
.drop-overlay-leave-to {
  opacity: 0;
}

.scan-progress-enter-active,
.scan-progress-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.scan-progress-enter-from,
.scan-progress-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

.scan-progress-bar-indeterminate {
  min-width: 28%;
  animation: scan-progress-indeterminate 1.1s ease-in-out infinite alternate;
}

@keyframes scan-progress-indeterminate {
  from {
    transform: translateX(-14%);
  }

  to {
    transform: translateX(14%);
  }
}
</style>
