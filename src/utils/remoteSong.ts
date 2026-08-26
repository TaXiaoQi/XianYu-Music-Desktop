import { LX_SOURCE_NAMES, type LxSourceId } from '../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginsVersion } from '../services/domain/pluginEngine';

export const isRemoteSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'remote' || song?.path?.startsWith('remote://') === true;

/**
 * 把 lx 音源的 interval 时长字符串解析为秒数。
 *
 * 支持 "mm:ss"、"hh:mm:ss" 以及纯秒数字符串（如 "263"）。无法解析时返回 0。
 *
 * 在线歌走 Rust 内核播放后，后端不回传真实时长，进度条显示与点击跳转都依赖前端提供的
 * song.duration。搜索结果构造 Song 时若不填 duration（旧代码硬编码为 0），会导致进度条
 * 不动、点击进度条无法跳转。此函数用于从 interval 还原 duration。
 */
export const parseIntervalToSeconds = (interval?: string | null): number => {
  if (!interval) return 0;
  const parts = interval.trim().split(':').map(part => parseInt(part, 10));
  if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

// 插件名缓存：基于 pluginsVersion 失效，避免列表渲染时重复 JSON.parse(localStorage)
let pluginNameCacheVersion = -1;
let pluginNameCache = new Map<string, string>();

function getPluginNameById(pluginId: string): string | null {
  if (pluginNameCacheVersion !== pluginsVersion.value) {
    pluginNameCacheVersion = pluginsVersion.value;
    pluginNameCache = new Map();
    for (const p of getStoredPlugins()) {
      pluginNameCache.set(p.id, p.name);
    }
  }
  return pluginNameCache.get(pluginId) ?? null;
}

/**
 * 获取歌曲的来源标签。
 *
 * 落雪音源歌曲（`lx://<source>/<songmid>`）返回对应的音源名称（如"小蜗音乐"）；
 * MusicFree 插件歌曲（`plugin://<platform>/<id>`）返回对应插件的显示名称；
 * 其他远程歌曲（WebDAV 等）返回"远程"。
 */
export const getSongSourceLabel = (
  song: { path?: string; source_type?: string; plugin_id?: string; rawData?: any } | null | undefined,
): string => {
  const path = song?.path;
  if (path?.startsWith('lx://')) {
    const sourceId = path.slice('lx://'.length).split('/')[0] as LxSourceId;
    return LX_SOURCE_NAMES[sourceId] ?? '在线';
  }

  if (path?.startsWith('plugin://')) {
    // 优先用 song.plugin_id（持久化字段），回退到 rawData.pluginId（运行时字段）
    const pluginId = song?.plugin_id || song?.rawData?.pluginId;
    if (pluginId) {
      const name = getPluginNameById(pluginId);
      if (name) return name;
    }
    return '在线';
  }

  return '远程';
};
