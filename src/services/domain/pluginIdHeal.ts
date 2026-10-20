import type { PluginSource, Song } from '../../types';
import { getStoredPlugins, readPluginIdAliases } from './pluginEngine';
import { describePlatform, findMatchingPlugin } from './pluginBackupSong';
import { useCollectionsStore } from '../../features/collections/store';


const platformLabelFromPath = (path: string): string => {
  const segment = path.slice('plugin://'.length).split('/')[0] || '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const findHealedPluginForSong = (
  song: Song,
  installedPlugins?: PluginSource[],
): PluginSource | null => {
  const searchResult = song?.rawData as { pluginId?: string; platform?: string } | undefined;
  if (!searchResult?.pluginId) return null;

  const plugins = installedPlugins ?? getStoredPlugins();
  if (plugins.some(p => p.id === searchResult.pluginId && p.enabled)) return null;

  // 插件更新换 id（脚本哈希）后行内仍是旧 pluginId：先沿别名表换算精确
  // 还原，免走平台标签启发式（后者是猜测式匹配，可能绑错插件）
  const aliases = readPluginIdAliases();
  let cur = searchResult.pluginId;
  for (let i = 0; i < 8; i++) {
    const next = aliases[cur];
    if (!next || next === cur) break;
    cur = next;
    const hit = plugins.find(p => p.id === cur && p.enabled);
    if (hit) return hit;
  }

  const candidates = plugins.filter(p => (p.format === 'musicfree' || p.format === 'anime') && p.enabled);
  if (candidates.length === 0) return null;

  const platformLabel = searchResult.platform
    || platformLabelFromPath(song.cue_source_path || song.path || '');
  if (!platformLabel.trim()) return null;

  return findMatchingPlugin(describePlatform(platformLabel), candidates, 'musicfree');
};

const applyPluginBinding = (record: Song, pluginId: string) => {
  const searchResult = record.rawData as { pluginId?: string } | undefined;
  if (searchResult) {
    searchResult.pluginId = pluginId;
  }
  record.plugin_id = pluginId;
};

export const healDanglingPluginId = (
  song: Song,
  installedPlugins?: PluginSource[],
): PluginSource | null => {
  const healed = findHealedPluginForSong(song, installedPlugins);
  if (!healed) return null;

  console.info(
    `[pluginHeal] pluginId 悬空已重匹配: ${healed.name} (${healed.id.slice(0, 8)}…), 歌曲: ${song.title}`,
  );

  applyPluginBinding(song, healed.id);

  const collectionsStore = useCollectionsStore();
  const path = song.cue_source_path || song.path;
  for (const playlist of collectionsStore.playlists) {
    playlist.songs?.forEach((record) => {
      if (record.path === path) applyPluginBinding(record, healed.id);
    });
  }
  const favoriteMeta = collectionsStore.favoriteSongMeta[path];
  if (favoriteMeta) applyPluginBinding(favoriteMeta, healed.id);
  const recentMeta = collectionsStore.recentSongMeta[path];
  if (recentMeta) applyPluginBinding(recentMeta, healed.id);

  return healed;
};
