import { ref } from 'vue';

/** 分享预览弹窗的用户动作 */
export type ShareLinkDialogAction = 'play' | 'playNext' | 'cancel';

export interface ShareLinkDialogState {
  visible: boolean;
  /** 歌曲名 */
  name: string;
  /** 歌手 */
  artist: string;
  /** 来源展示名（插件名 / 本地音乐） */
  sourceLabel: string;
  /** 封面 https 地址（可为空，空时弹窗用占位图标） */
  cover: string;
  resolver: ((action: ShareLinkDialogAction) => void) | null;
}

const shareLinkDialogState = ref<ShareLinkDialogState>({
  visible: false,
  name: '',
  artist: '',
  sourceLabel: '',
  cover: '',
  resolver: null,
});

/**
 * 打开分享链接预览弹窗（复用调试页统一弹窗样式，仅内部按钮可关闭）。
 * 返回用户动作：'play' 立即播放 / 'playNext' 添加到下一首播放 / 'cancel' 取消。
 */
export function showShareLinkDialog(params: {
  name: string;
  artist: string;
  sourceLabel: string;
  cover?: string;
}): Promise<ShareLinkDialogAction> {
  return new Promise<ShareLinkDialogAction>((resolve) => {
    shareLinkDialogState.value = {
      visible: true,
      name: params.name || '未知歌曲',
      artist: params.artist || '未知歌手',
      sourceLabel: params.sourceLabel || '未知来源',
      cover: params.cover || '',
      resolver: resolve,
    };
  });
}

export function resolveShareLinkDialog(action: ShareLinkDialogAction): void {
  const state = shareLinkDialogState.value;
  if (action === 'play') {
    // 点「播放」：弹窗保持可见并进入播放中状态（resolver 置空禁用按钮），
    // 等深链处理器完成播放后调用 finishShareLinkDialog 关闭。
    shareLinkDialogState.value = { ...state, resolver: null };
    state.resolver?.(action);
    return;
  }
  // 'playNext' 或 'cancel'：无需等待播放状态，直接关闭弹窗
  state.resolver?.(action);
  shareLinkDialogState.value = {
    visible: false,
    name: '',
    artist: '',
    sourceLabel: '',
    cover: '',
    resolver: null,
  };
}

export function finishShareLinkDialog(): void {
  shareLinkDialogState.value = {
    visible: false,
    name: '',
    artist: '',
    sourceLabel: '',
    cover: '',
    resolver: null,
  };
}

export function useShareLinkDialog() {
  return {
    shareLinkDialogState,
    resolveShareLinkDialog,
  };
}