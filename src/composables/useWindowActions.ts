interface PlayerUiShellWindowApi {
  toggleAlwaysOnTop: (enable: boolean) => Promise<unknown>;
  togglePlayerDetail: () => void;
  toggleQueue: () => void;
}

interface UseWindowActionsOptions {
  playerUiShell: PlayerUiShellWindowApi;
}

export function useWindowActions({ playerUiShell }: UseWindowActionsOptions) {
  const toggleAlwaysOnTop = (enable: boolean) => playerUiShell.toggleAlwaysOnTop(enable);
  const togglePlayerDetail = () => playerUiShell.togglePlayerDetail();
  const toggleQueue = () => playerUiShell.toggleQueue();

  return {
    toggleAlwaysOnTop,
    togglePlayerDetail,
    toggleQueue,
  };
}
