import { ref } from 'vue';

export type ShareLinkDialogAction = 'play' | 'playNext' | 'cancel' | 'import';

export type ShareLinkDialogMode = 'local' | 'online' | 'import';

export interface ShareLinkDialogState {
  visible: boolean;
  name: string;
  artist: string;
  sourceLabel: string;
  cover: string;
  mode: ShareLinkDialogMode;
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
    shareLinkDialogState.value = { ...state, resolver: null };
    state.resolver?.(action);
    return;
  }
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