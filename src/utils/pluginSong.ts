
import type { PluginTrack } from '../types/plugin';
import type { Song } from '../types';

export const isPluginSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'plugin' || song?.path?.startsWith('plugin://') === true;

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
