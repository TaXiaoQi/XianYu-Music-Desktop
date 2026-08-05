/**
 * 插件备份文件导入服务
/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 */**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type {/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface Prepared/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    path = decodeURIComponent(path);
    path = path/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    path = decodeURIComponent(path);
    path = path.replace(/\//g, '\\');
    return path;
  } catch {
    return url;
  }
}

/**
 * 从备份歌曲对象中提取本地文件路径
 */
function resolveLocalPath(rawSong: any): string {
  if (raw/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    path = decodeURIComponent(path);
    path = path.replace(/\//g, '\\');
    return path;
  } catch {
    return url;
  }
}

/**
 * 从备份歌曲对象中提取本地文件路径
 */
function resolveLocalPath(rawSong: any): string {
  if (rawSong.localPath && typeof rawSong.localPath === 'string') {
    return rawSong.localPath;
  }
  if (rawSong.url &&/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    path = decodeURIComponent(path);
    path = path.replace(/\//g, '\\');
    return path;
  } catch {
    return url;
  }
}

/**
 * 从备份歌曲对象中提取本地文件路径
 */
function resolveLocalPath(rawSong: any): string {
  if (rawSong.localPath && typeof rawSong.localPath === 'string') {
    return rawSong.localPath;
  }
  if (rawSong.url && typeof rawSong.url === 'string' && rawSong.url.startsWith('file:')) {
    return decodeFileUrl(rawSong.url);
  }
  if (rawSong.qualities && typeof rawSong/**
 * 插件备份文件导入服务
 *
 * 从 BakaMusic / MusicFree 的 JSON 备份文件中读取歌单，
 * 根据已安装插件匹配歌曲来源：
 * - 有本地文件路径的歌曲 → 直接作为本地歌曲导入
 * - 有 platform 字段且对应插件已安装的歌曲 → 作为远程歌曲导入（plugin:// 协议）
 * - 无本地路径且无匹配插件的歌曲 → 记录到 failures
 */
import type { Song, PluginSource } from '../types';

// ==================== 类型定义 ====================

export interface PreparedPluginBackupPlaylist {
  name: string;
  songs: Song[];
}

export interface PreparedPluginBackupFailure {
  /** 歌曲标题 */
  title: string;
  /** 歌曲歌手 */
  artist: string;
  /** 备份中记录的平台 */
  platform: string;
  /** 失败原因 */
  reason: string;
}

export interface PreparedPluginBackupImport {
  /** 成功导入的歌单列表 */
  playlists: PreparedPluginBackupPlaylist[];
  /** 成功导入的歌曲总数 */
  importedSongCount: number;
  /** 未能导入的歌曲列表 */
  failures: PreparedPluginBackupFailure[];
  /** 备份中涉及但未安装的插件平台名 */
  missingPlugins: string[];
  /** 备份中检测到的已安装插件平台名 */
  matchedPlugins: string[];
}

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[PluginBackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 */
function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    path = decodeURIComponent(path);
    path = path.replace(/\//g, '\\');
    return path;
  } catch {
    return url;
  }
}

/**
 * 从备份歌曲对象中提取本地文件路径
 */
function resolveLocalPath(rawSong: any): string {
  if (rawSong.localPath && typeof rawSong.localPath === 'string') {
    return rawSong.localPath;
  }
  if (rawSong.url && typeof rawSong.url === 'string' && rawSong.url.startsWith('file:')) {
    return decodeFileUrl(rawSong.url);
  }
  if (rawSong.qualities && typeof rawSong.qualities === 'object') {
    for (const quality of Object.values(rawSong.qualities) as any[]) {
      if (quality?.url