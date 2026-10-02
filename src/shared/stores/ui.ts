import { ref } from "vue";
import { defineStore } from "pinia";

// 取色兜底色板：未取得主色前四个位置都显示透明。
export const defaultDominantColors: string[] = [
    "transparent",
    "transparent",
    "transparent",
    "transparent",
];

/** 界面层各弹层/模式开关与全局 UI 状态。 */
function composeUiState() {
    return {
        // 歌单侧栏与迷你歌单
        showPlaylist: ref(false),
        showMiniPlaylist: ref(false),
        // 播放详情页与播放队列
        showPlayerDetail: ref(false),
        showQueue: ref(false),
        showComment: ref(false),
        // 迷你模式与音量气泡
        isMiniMode: ref(false),
        showVolumePopover: ref(false),
        // 自定义皮肤弹窗与主窗口休眠请求
        showCustomSkinModal: ref(false),
        mainWindowUiSleepRequested: ref(false),
        // 路由转场与启动遮罩
        skipNextPageTransition: ref(false),
        startupCompositionMaskVisible: ref(false),
        // 当前封面主色（兜底为透明色板）
        dominantColors: ref<string[]>([...defaultDominantColors]),
        // 沉浸式全屏
        isImmersiveFullscreen: ref(false),
        // 全屏进出场动画状态
        fullscreenAnimState: ref<"entering" | "exiting" | null>(null),
    };
}

export const useUiStore = defineStore("ui", composeUiState);
