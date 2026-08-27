/**
 * 云端歌单同步 · 歌曲转换/分类工具。
 *
 * 负责本地 Song 与同步载荷（SyncSongPayload）之间的双向转换、来源类型分类、
 * song_hash 生成，以及移动端 plugin:// 路径到桌面端 lx:// 路径的映射。
 */

import type { Song } from '../../types';
import { getStoredAuth } from '../auth/authService';
import { isPluginSong } from '../../utils/pluginSong';
import { isRemoteSong } from '../../utils/remoteSong';
import { md5 } from '../auth/md5';
import type { SyncSongPayload, SyncSongType, PlaylistType } from './playlistSyncTypes';

/** 获取当前登录用户的弦予号 */
export function getCiyuanxiId(): string | null {
  const auth = getStoredAuth();
  return auth?.user?.ciyuanxi_id ?? null;
}

/** 判断是否为在线歌曲（非本地文件） */
export function isOnlineSong(song: Song): boolean {
  return (
    isRemoteSong(song)
    || isPluginSong(song)
    || song.path?.startsWith('lx://') === true
    || song.path?.startsWith('plugin://') === true
    || song.path?.startsWith('http://') === true
    || song.path?.startsWith('https://') === true
  );
}

/** 自动识别歌曲来源类型，与备份导出逻辑保持一致 */
export function classifySyncSong(song: Song): SyncSongType {
  if (song.source_type === 'local') return 'local';
  if (song.source_type === 'remote' || song.source_type === 'plugin') return 'online';
  return isOnlineSong(song) ? 'online' : 'local';
}

/** 自动识别歌单类型：纯本地、纯在线或混合 */
export function classifySyncPlaylist(songs: Song[]): PlaylistType {
  if (songs.length === 0) return 'local';
  const types = new Set(songs.map(classifySyncSong));
  if (types.size === 1) {
    return types.has('local') ? 'local' : 'online';
  }
  return 'mixed';
}

/**
 * 为本地 Song 生成云端 song_hash。
 * 优先使用 path 的 hash（保证同一首歌在不同设备间 hash 一致），
 * 回退到 name|artist|source 组合。
 */
function generateSongHash(song: Song): string {
  // 在线歌曲用 path 作为唯一标识的 hash 基础
  if (isOnlineSong(song) && song.path) {
    return md5(song.path);
  }
  // 本地歌曲用 name|artist 组合
  const name = song.title || song.name || '';
  const artist = song.artist || '';
  return md5(`${name}|${artist}|local`);
}

/** 将本地 Song 转换为备份同款同步歌曲，保留完整元数据并加来源标记 */
export function songToSyncPayload(song: Song): SyncSongPayload {
  return {
    ...JSON.parse(JSON.stringify(song)),
    syncType: classifySyncSong(song),
    song_hash: generateSongHash(song),
  };
}

/**
 * 移动端 MusicFree 平台显示名 → 桌面端 lx source 标识的映射。
 * 移动端从 MusicFree 备份导入时用平台名（"网易云音乐"）生成 plugin:// path，
 * 桌面端通过此映射将其转换为 lx:// path，由已安装的 lx 插件处理。
 */
const MOBILE_PLATFORM_TO_LX_SOURCE: Record<string, string> = {
  '网易云音乐': 'wy',
  '网易音乐': 'wy',
  'QQ音乐': 'tx',
  'qq音乐': 'tx',
  '酷我音乐': 'kw',
  '酷狗音乐': 'kg',
  '咪咕音乐': 'mg',
  '哔哩哔哩': 'bilibili',
  'bilibili': 'bilibili',
};

/**
 * 尝试将移动端 plugin:// 路径转换为桌面端可播放的 lx:// 路径。
 * 仅对 plugin://<平台名>/<songId> 格式且可映射到 lx source 的情况生效，
 * 其余情况原路返回。
 */
function tryConvertMobilePluginPathToLx(
  path: string,
  payload: any,
): { path: string; lxSource: string | null; songmid: string | null } {
  if (!path.startsWith('plugin://')) return { path, lxSource: null, songmid: null };
  try {
    const withoutScheme = path.slice('plugin://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx < 0) return { path, lxSource: null, songmid: null };
    const rawPlatform = withoutScheme.slice(0, slashIdx);
    const rawSongId = withoutScheme.slice(slashIdx + 1);
    const platform = decodeURIComponent(rawPlatform);
    const songId = decodeURIComponent(rawSongId);
    const lxSource = MOBILE_PLATFORM_TO_LX_SOURCE[platform] ?? null;
    if (!lxSource || !songId) return { path, lxSource: null, songmid: null };
    // 优先从 musicInfo 取 songmid（lx 格式），否则直接用 songId
    const musicInfo = payload.musicInfo as Record<string, any> | undefined;
    const songmid = musicInfo?.songmid || musicInfo?.mid || songId;
    const lxPath = `lx://${lxSource}/${encodeURIComponent(songmid)}`;
    return { path: lxPath, lxSource, songmid };
  } catch {
    return { path, lxSource: null, songmid: null };
  }
}

/** 将同步歌曲恢复成 Song */
export function syncPayloadToSong(song: SyncSongPayload): Song {
  const payload = song as SyncSongPayload;
  const title = payload.title || payload.name || '';
  const artist = payload.artist || '未知歌手';
  const album = payload.album || '未知专辑';
  const artistNames = payload.artist_names?.length
    ? payload.artist_names
    : artist.split(/[、,/&]|\sft\.?\s/i).map(s => s.trim()).filter(Boolean);

  // [跨端时长归一化] 移动端上传时将秒×1000存为毫秒，桌面端存的是秒。
  // 大于 10000 的值视为毫秒（正常歌曲时长不超过 10000 秒 ≈ 2.7 小时），除以 1000 还原为秒。
  const rawDuration = payload.duration || 0;
  const duration = rawDuration > 10000 ? Math.round(rawDuration / 1000) : rawDuration;

  // [跨端封面字段兼容] 移动端上传用 coverUrl，桌面端用 cover_thumb_path。
  const coverThumbPath = (payload.cover_thumb_path || (payload as any).coverUrl || '') as string;

  // [移动端 plugin:// → lx:// 路径转换]
  // 移动端从 MusicFree 备份导入的歌曲 path 为 plugin://<平台名>/<songId>，
  // 桌面端无法匹配这类 ID，需转换为 lx://source/songmid 供桌面端 lx 插件处理。
  const { path: resolvedPath, lxSource, songmid } = tryConvertMobilePluginPathToLx(
    payload.path,
    payload,
  );

  // 当成功转换为 lx:// 时，从 musicInfo 提取 lx 插件需要的元字段注入 Song 对象
  const lxExtra: Record<string, unknown> = {};
  if (lxSource && songmid) {
    const musicInfo = (payload as any).musicInfo as Record<string, any> | undefined;
    if (musicInfo) {
      // lxUrlResolver.resolveLxCachedInfo 会读取 _hash/_types 等字段
      if (musicInfo._types) lxExtra._types = musicInfo._types;
      if (musicInfo.hash || musicInfo['320hash']) lxExtra._hash = musicInfo.hash || musicInfo['320hash'];
      if (musicInfo.strMediaMid) lxExtra._strMediaMid = musicInfo.strMediaMid;
      if (musicInfo.albumMid || musicInfo.albummid) lxExtra._albumMid = musicInfo.albumMid || musicInfo.albummid;
      if (musicInfo.albumId || musicInfo.album_id) lxExtra._albumId = musicInfo.albumId || musicInfo.album_id;
      if (musicInfo.copyrightId) lxExtra._copyrightId = musicInfo.copyrightId;
      if (musicInfo.songId || musicInfo.songid) lxExtra._songId = musicInfo.songId || musicInfo.songid;
      // rawData 里存完整 musicInfo，供 lx 插件解析时使用
      lxExtra.rawData = { ...musicInfo, source: lxSource, songmid };
    }
  }

  return {
    ...payload,
    ...lxExtra,
    name: payload.name || title,
    title,
    path: resolvedPath,
    artist,
    artist_names: artistNames.length > 0 ? artistNames : [artist],
    effective_artist_names: payload.effective_artist_names?.length
      ? payload.effective_artist_names
      : (artistNames.length > 0 ? artistNames : [artist]),
    album,
    album_artist: payload.album_artist || artist,
    album_key: payload.album_key || `${album}-${artist}`,
    is_various_artists_album: payload.is_various_artists_album ?? false,
    collapse_artist_credits: payload.collapse_artist_credits ?? false,
    duration,
    cover_thumb_path: coverThumbPath,
    source_type: payload.source_type ?? (payload.syncType === 'online' ? 'remote' : 'local'),
  };
}

/**
 * 从歌曲列表中取第一张可跨设备访问（http/https）的封面 URL。
 * 本地文件路径封面在其他设备上无法访问，跳过。
 */
export function firstRemoteSongCover(songs: Array<{ cover_thumb_path?: string; coverUrl?: string }> | undefined): string {
  for (const s of songs ?? []) {
    const c = s?.cover_thumb_path || s?.coverUrl || '';
    if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
  }
  return '';
}