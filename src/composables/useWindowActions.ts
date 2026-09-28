/**
 * 窗口动作薄封装：把播放器 UI 外壳暴露的窗口级开关
 * 以独立动作的形式转交给上层（TitleBar/快捷键等）调用。
 */
interface WindowToggleSurface {
  toggleAlwaysOnTop: (enable: boolean) => Promise<unknown>;
  togglePlayerDetail: () => void;
  toggleQueue: () => void;
  toggleComment: () => void;
}

interface WindowActionOptions {
  playerUiShell: WindowToggleSurface;
}

export function useWindowActions(options: WindowActionOptions) {
  const shell = options.playerUiShell;

  const actions = {
    toggleAlwaysOnTop: (enable: boolean) => shell.toggleAlwaysOnTop(enable),
    togglePlayerDetail: () => shell.togglePlayerDetail(),
    toggleQueue: () => shell.toggleQueue(),
    toggleComment: () => shell.toggleComment(),
  };

  return actions;
}
