import type { PluginSource, Song } from '../../types';
import { getStoredPlugins } from './pluginEngine';
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

export const findHealedPluginForSong = (
  song: Song,
  installedPlugins?: PluginSource[],
): PluginSource | null => {
  const searchResult = song?.rawData as { pluginId?: string; platform?: string } | undefined;
  if (!searchResult?.pluginId) return null;

  const plugins = installedPlugins ?? getStoredPlugins();
  if (plugins.some(p => p.id === searchResult.pluginId && p.enabled)) return null;

  const candidates = plugins.filter(p => p.format === 'musicfree' && p.enabled);
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
