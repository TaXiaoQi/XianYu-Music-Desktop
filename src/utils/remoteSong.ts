import { LX_SOURCE_NAMES, type LxSourceId } from '../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginsVersion } from '../services/domain/pluginEngine';

export const isRemoteSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'remote' || song?.path?.startsWith('remote://') === true;

export const parseIntervalToSeconds = (interval?: string | null): number => {
  if (!interval) return 0;
  const parts = interval.trim().split(':').map(part => parseInt(part, 10));
  if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

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

export const getSongSourceLabel = (
  song: { path?: string; source_type?: string; plugin_id?: string; rawData?: any } | null | undefined,
): string => {
  const path = song?.path;
  if (path?.startsWith('lx://')) {
    const sourceId = path.slice('lx://'.length).split('/')[0] as LxSourceId;
    return LX_SOURCE_NAMES[sourceId] ?? '在线';
  }

  if (path?.startsWith('plugin://')) {
    const pluginId = song?.plugin_id || song?.rawData?.pluginId;
    if (pluginId) {
      const name = getPluginNameById(pluginId);
      if (name) return name;
    }
    return '在线';
  }

  return '远程';
};
