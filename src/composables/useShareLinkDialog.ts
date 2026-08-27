import { ref } from 'vue';

/** 分享预览弹窗的用户动作 */
export type ShareLinkDialogAction = 'play' | 'playNext' | 'cancel' | 'import';

/** 分享预览弹窗形态：本地命中 / 本地无音源但可在线播放 / 需导入音源 */
export type ShareLinkDialogMode = 'local' | 'online' | 'import';

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
  /** 弹窗形态，决定按钮文案与布局 */
  mode: ShareLinkDialogMode;
  /** online 模式主按钮文案（缺省为「本地无音源，前往在线播放」） */
  onlineActionLabel?: string;
  resolver: ((action: ShareLinkDialogAction) => void) | null;
}

const shareLinkDialogState = ref<ShareLinkDialogState>({
  visible: false,
  name: '',
  artist: '',
  sourceLabel: '',
  cover: '',
  mode: 'local',
  onlineActionLabel: '',
  resolver: null,
});

/**
 * 打开分享链接预览弹窗（复用调试页统一弹窗样式，仅内部按钮可关闭）。
 * mode 控制按钮布局：local — 播放/下一首播放/取消；online — 主按钮/取消；
 * import — 「前往导入音源」/取消。online 主按钮文案由 onlineActionLabel 指定（缺省
 * 「本地无音源，前往在线播放」）。返回用户动作。
 */
export function showShareLinkDialog(params: {
  name: string;
  artist: string;
  sourceLabel: string;
  cover?: string;
  mode?: ShareLinkDialogMode;
  onlineActionLabel?: string;
}): Promise<ShareLinkDialogAction> {
  return new Promise<ShareLinkDialogAction>((resolve) => {
    shareLinkDialogState.value = {
      visible: true,
      name: params.name || '未知歌曲',
      artist: params.artist || '未知歌手',
      sourceLabel: params.sourceLabel || '未知来源',
      cover: params.cover || '',
      mode: params.mode || 'local',
      onlineActionLabel: params.onlineActionLabel || '',
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
  // 'playNext' / 'cancel' / 'import'：无需等待播放状态，直接关闭弹窗
  state.resolver?.(action);
  shareLinkDialogState.value = {
    visible: false,
    name: '',
    artist: '',
    sourceLabel: '',
    cover: '',
    mode: 'local',
    onlineActionLabel: '',
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
    mode: 'local',
    onlineActionLabel: '',
    resolver: null,
  };
}

export function useShareLinkDialog() {
  return {
    shareLinkDialogState,
    resolveShareLinkDialog,
  };
}