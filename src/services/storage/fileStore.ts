import { stateApi } from '../tauri/stateApi';

/**
 * 基于 Tauri 文件系统的 JSON 存储，用于持久化超过 localStorage 配额（~5MB）的大数据。
 * 数据写入 app_data_dir/state/{key}.json。
 */
export const fileStore = {
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await stateApi.readStateJson(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (e) {
      console.error(`[fileStore] getJson("${key}") failed:`, e);
      return null;
    }
  },

  async setJson(key: string, value: unknown): Promise<void> {
    try {
      const json = JSON.stringify(value);
      await stateApi.writeStateJson(key, json);
    } catch (e) {
      console.error(`[fileStore] setJson("${key}") failed:`, e);
      throw e;
    }
  },
};
