/**
 * 插件歌曲工具函数
 *
 * 将插件返回的 PluginTrack 转换为播放器可识别的 Song 对象。
 * 复用 playbackStore 的 fallback 机制：插件歌曲不需要写入音乐库，
 * 只要构造合法 Song 并调用 playSong(song) 即可。
 */

import type { PluginTrack } from '../types/plugin';
import type { Song } from '../types';

/** 判断是否为插件歌曲 */
export const isPluginSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'plugin' || song?.path?.startsWith('plugin://') === true;

/**
 * 把插件歌曲转换为播放器 Song 对象
 *
 * path 采用 `plugin://<pluginId>/<trackId>` 协议，作为唯一标识。
 * 后端 play_audio 需识别此协议并调用对应插件获取真实音源。
 *
 * @param track 插件返回的歌曲对象
 * @param pluginId 所属插件 ID
 */
export const pluginTrackToSong = (track: PluginTrack, pluginId: string): Song => {
  const artistName = track.artist || (track.artists && track.artists.length > 0 ? track.artists[0] : '未知歌手');
  const artistNames = track.artists && track.artists.length > 0 ? track.artists : [artistName];
  const albumName = track.album || '未知专辑';
  const path = `plugin://${pluginId}/${track.id}`;

  return {
    name: track.title,
    title: track.title,
    path,
    artist: artistName,
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: albumName,
    album_artist: artistName,
    album_key: `${albumName}-${artistName}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: track.duration ?? 0,
    cover_thumb_path: track.coverUrl || '',
    year: track.year,
    source_type: 'plugin',
    plugin_id: pluginId,
    remote_source_id: track.streamUrl,
  };
};
