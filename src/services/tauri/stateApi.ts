import { tauriInvoke } from './invoke';

/**
 * 通用 JSON 状态持久化 API — 与 Rust `read_state_json` / `write_state_json` 一一对应。
 * 数据写入 app_data_dir/state/{key}.json，用于持久化超过 localStorage 配额的大数据。
 */
export const stateApi = {
  readStateJson: (key: string): Promise<string | null> =>
    tauriInvoke('read_state_json', { key }),
  writeStateJson: (key: string, value: string): Promise<void> =>
    tauriInvoke('write_state_json', { key, value }),
};
