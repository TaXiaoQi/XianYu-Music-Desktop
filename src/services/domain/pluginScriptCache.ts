// URL 型插件脚本的本地缓存：源地址不可达（宕机/断网/被墙）时用缓存兜底，
// 成功拉取时静默更新缓存。缓存路径（plugins/<id>.js 的绝对路径）记在
// localStorage，脚本内容本体落在数据目录 plugins/ 下。
import { pluginApi } from '../tauri/pluginApi';

const LS_KEY = 'xianyu_http_plugin_script_paths';

function readPathMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writePathMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 不可用时放弃记录，缓存退化为「本次会话内有效」外无兜底 */
  }
}

/** 读取 URL 型插件的本地缓存脚本；无缓存或文件已丢失返回 null。 */
export async function readCachedHttpScript(id: string): Promise<string | null> {
  const path = readPathMap()[id];
  if (!path) return null;
  try {
    const script = await pluginApi.readPluginFile(path);
    return script.trim() ? script : null;
  } catch {
    return null;
  }
}

/** 将 URL 型插件脚本落盘缓存并记录路径；写失败静默忽略，不影响主流程。 */
export async function writeCachedHttpScript(id: string, script: string): Promise<void> {
  try {
    const path = await pluginApi.savePluginScript(id, script);
    const map = readPathMap();
    if (map[id] === path) return;
    map[id] = path;
    writePathMap(map);
  } catch {
    /* 缓存写失败不影响拉取结果 */
  }
}

/** 删除 URL 型插件的缓存记录（filePath 已转正本地时调用，脚本本体即正式文件）。 */
export function removeCachedHttpScript(id: string): void {
  const map = readPathMap();
  if (!(id in map)) return;
  delete map[id];
  writePathMap(map);
}
