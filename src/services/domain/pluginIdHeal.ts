import type { PluginSource, Song } from '../../types';
import { getStoredPlugins } from './pluginEngine';
import { describePlatform, findMatchingPlugin } from './pluginBackupSong';
import { useCollectionsStore } from '../../features/collections/store';

/**
 * 插件歌曲 pluginId 悬空修复（运行时重匹配 + 持久化回写）。
 *
 * 插件 id = 插件文件内容 sha256，与安装实例绑定：插件更新/重装后 id 必变，
 * 备份导入歌单/收藏中在线歌记录的 rawData.pluginId 随即悬空 → 播放报
 * 「该歌曲对应的插件未启用或已被移除」，只能删除重导。
 *
 * 这里按歌曲平台在已装同格式插件中重匹配（复用备份导入的平台别名与匹配评分），
 * 命中后回写传入 Song 实例（当前播放立即生效），并同步歌单/收藏/最近播放中的
 * 持久化记录（plugin_id 为响应式字段，赋值可触发歌单 deep watch 随下次落盘持久化）。
 */

/** 从 plugin:// 路径解码平台显示名（首段为 encodeURIComponent 后的平台名） */
const platformLabelFromPath = (path: string): string => {
  const segment = path.slice('plugin://'.length).split('/')[0] || '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * 悬空 pluginId 的重匹配：plugin:// 歌来自 MusicFree/Baka 系备份或搜索，
 * musicItem 契约仅与同格式（musicfree）插件互通，因此只在同格式已装插件中
 * 按平台匹配。LX 歌走 lx:// 协议、按 source code 动态定位插件，无悬空问题。
 */
export const findHealedPluginForSong = (
  song: Song,
  installedPlugins?: PluginSource[],
): PluginSource | null => {
  const searchResult = song?.rawData as { pluginId?: string; platform?: string } | undefined;
  if (!searchResult?.pluginId) return null;

  const plugins = installedPlugins ?? getStoredPlugins();
  if (plugins.some(p => p.id === searchResult.pluginId && p.enabled)) return null; // 未悬空

  const candidates = plugins.filter(p => p.format === 'musicfree' && p.enabled);
  if (candidates.length === 0) return null;

  // 平台标签：优先搜索结果自带的 platform（平台显示名），其次从路径段解码
  const platformLabel = searchResult.platform
    || platformLabelFromPath(song.cue_source_path || song.path || '');
  if (!platformLabel.trim()) return null;

  return findMatchingPlugin(describePlatform(platformLabel), candidates, 'musicfree');
};

/** 将修复后的插件绑定写入单个 Song 记录（rawData 为 markRaw 对象，可直接变更） */
const applyPluginBinding = (record: Song, pluginId: string) => {
  const searchResult = record.rawData as { pluginId?: string } | undefined;
  if (searchResult) {
    searchResult.pluginId = pluginId;
  }
  record.plugin_id = pluginId;
};

/**
 * 悬空 pluginId 修复入口：重匹配命中时回写传入实例与持久化记录
 * （歌单 songs / 收藏元信息 / 最近播放元信息），返回命中插件；未命中返回 null。
 */
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

  // 回写各持久化入口的同路径记录：plugin:// 路径按 平台+歌曲ID 构造，
  // 与插件实例无关，可作为跨记录的稳定键
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
