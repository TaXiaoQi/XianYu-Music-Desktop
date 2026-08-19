/**
 * 插件系统类型定义
 *
 * 这些类型定义了前端与后端插件系统之间的数据契约。
 * 后端实现插件加载器后，需返回符合这些类型的数据结构。
 */

/** 已安装的插件信息 */
export interface PluginInfo {
  /** 插件唯一标识 */
  id: string;
  /** 插件显示名称，例如 "网易云音乐" */
  name: string;
  /** 插件版本号 */
  version: string;
  /** 插件作者 */
  author?: string;
  /** 插件平台描述 */
  platform?: string;
  /** 插件描述信息 */
  description?: string;
  /** 是否已启用 */
  enabled: boolean;
  /** 是否有可用更新 */
  updateAvailable?: boolean;
  /** 插件图标 URL */
  iconUrl?: string;
}

/** 搜索内容类型 */
export type PluginSearchType = 'track' | 'artist' | 'album' | 'playlist';

/** 插件搜索结果 - 歌曲 */
export interface PluginTrack {
  /** 插件内歌曲唯一 ID */
  id: string;
  /** 歌曲标题 */
  title: string;
  /** 歌手名称 */
  artist: string;
  /** 歌手列表（多人合作时拆分） */
  artists?: string[];
  /** 专辑名称 */
  album?: string;
  /** 时长（秒） */
  duration?: number;
  /** 封面图 URL */
  coverUrl?: string;
  /** 音源 URL（后端解析后返回，可能为空需二次请求获取） */
  streamUrl?: string;
  /** 歌词 URL 或内容 */
  lyricsUrl?: string;
  /** 发布年份 */
  year?: string;
  /** 音质信息 */
  quality?: string;
}

/** 插件搜索结果 - 歌手 */
export interface PluginArtist {
  id: string;
  name: string;
  avatarUrl?: string;
  description?: string;
  /** 歌曲数量 */
  songCount?: number;
  /** 专辑数量 */
  albumCount?: number;
}

/** 插件搜索结果 - 专辑 */
export interface PluginAlbum {
  id: string;
  name: string;
  artist: string;
  coverUrl?: string;
  description?: string;
  /** 发行年份 */
  year?: string;
  /** 包含歌曲数量 */
  songCount?: number;
}

/** 插件搜索结果 - 歌单 */
export interface PluginPlaylist {
  id: string;
  name: string;
  creator?: string;
  coverUrl?: string;
  description?: string;
  /** 歌曲数量 */
  songCount?: number;
  /** 播放次数 */
  playCount?: number;
}

/** 统一搜索响应，按类型区分 */
export interface PluginSearchResponse {
  tracks: PluginTrack[];
  artists: PluginArtist[];
  albums: PluginAlbum[];
  playlists: PluginPlaylist[];
}

/** 搜索请求参数 */
export interface PluginSearchRequest {
  /** 插件 ID */
  pluginId: string;
  /** 搜索关键词 */
  query: string;
  /** 搜索类型（不传则搜索全部类型） */
  type?: PluginSearchType;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}
