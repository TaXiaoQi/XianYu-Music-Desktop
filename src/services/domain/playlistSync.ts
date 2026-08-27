/**
 * 云端歌单同步服务 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块，保持既有消费者（SettingsAccount / autoSync /
 * favoritesSync / pluginSync / settingsSync / App / OnlineDetailView 等）的入口
 * 路径不变。已拆分的子模块：
 *   - playlistSyncTypes  类型定义（叶子）
 *   - playlistSyncSong   歌曲转换/分类/路径映射工具（叶子）
 *   - playlistSyncApi    后端接口 + 文件存储分块上传/下载
 *
 * 后端接口一览（action=xxx）：
 * - delete_playlist
 * - file_sync_upload_start / file_sync_upload_chunk / file_sync_upload_finish / file_sync_download
 */

export type {
  PlaylistType,
  SyncSongType,
  SyncSongPayload,
  SyncResult,
  FileSyncPlaylistData,
  FileSyncDownloadData,
} from './playlistSyncTypes';

export {
  getCiyuanxiId,
  isOnlineSong,
  classifySyncSong,
  classifySyncPlaylist,
  songToSyncPayload,
  syncPayloadToSong,
  firstRemoteSongCover,
} from './playlistSyncSong';

export {
  deleteCloudPlaylist,
  fileSyncUpload,
  fileSyncDownload,
} from './playlistSyncApi';