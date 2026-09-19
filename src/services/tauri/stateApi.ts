import { tauriInvoke } from './invoke';

export const stateApi = {
  readStateJson: (key: string): Promise<string | null> =>
    tauriInvoke('read_state_json', { key }),
  writeStateJson: (key: string, value: string): Promise<void> =>
    tauriInvoke('write_state_json', { key, value }),
};
