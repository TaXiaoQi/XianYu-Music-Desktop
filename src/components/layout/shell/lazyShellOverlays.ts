// 壳层弹窗的异步组件登记表：全部走 defineAsyncComponent 惰性加载，
// 避免首屏打包进主 chunk。仅被 MainShell 编排层与壳内弹窗层引用。
import { defineAsyncComponent } from 'vue';

export const LazyOnboardingModal = defineAsyncComponent(() => import('../../onboarding/OnboardingModal.vue'));
export const LazyPlayQueueSidebar = defineAsyncComponent(() => import('../../player/PlayQueueSidebar.vue'));
export const LazyCommentPanel = defineAsyncComponent(() => import('../../overlays/CommentPanel.vue'));
export const LazyPlayerDetail = defineAsyncComponent(() => import('../../player/PlayerDetail.vue'));
export const LazyAddToPlaylistModal = defineAsyncComponent(() => import('../../overlays/AddToPlaylistModal.vue'));
export const LazyToast = defineAsyncComponent(() => import('../../common/Toast.vue'));
export const LazySettingsConflictDialog = defineAsyncComponent(() => import('../../common/SettingsConflictDialog.vue'));
export const LazyProfileLimitDialog = defineAsyncComponent(() => import('../../common/ProfileLimitDialog.vue'));
export const LazyBanDialog = defineAsyncComponent(() => import('../../common/BanDialog.vue'));
export const LazyCiyuanxiDialog = defineAsyncComponent(() => import('../../common/CiyuanxiDialog.vue'));
export const LazyChangePasswordDialog = defineAsyncComponent(() => import('../../common/ChangePasswordDialog.vue'));
export const LazyDeleteAccountDialog = defineAsyncComponent(() => import('../../common/DeleteAccountDialog.vue'));
export const LazyShareLinkDialog = defineAsyncComponent(() => import('../../common/ShareLinkDialog.vue'));
export const LazySongInfoModal = defineAsyncComponent(() => import('../../overlays/SongInfoModal.vue'));
export const LazyDownloadDialog = defineAsyncComponent(() => import('../../overlays/DownloadDialog.vue'));
export const LazyAnnouncementModal = defineAsyncComponent(() => import('../../overlays/AnnouncementModal.vue'));
export const LazyLxUpdateAlertModal = defineAsyncComponent(() => import('../../overlays/LxUpdateAlertModal.vue'));
export const LazyUpdateModal = defineAsyncComponent(() => import('../../overlays/UpdateModal.vue'));
export const LazyCustomSkinModal = defineAsyncComponent(() => import('../../settings/CustomSkinModal.vue'));
