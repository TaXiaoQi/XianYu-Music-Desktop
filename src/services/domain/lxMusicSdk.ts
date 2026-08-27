/**
 * LX 协议 SDK 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块，保持所有既有消费者（Search.vue / OnlineDetailView /
 * lxUrlResolver / recognize / playlistImport / fallbackModules 等）的入口路径不变。
 * 已拆分的子模块：
 *   - lxMusicSdkTypes   类型与源标识常量（叶子）
 *   - lxMusicSdkSearch  搜索 + TX 专辑/时长分发包装（lxSearch、txSearchAlbumsRaw、txBatchTrackInterval）
 *   - lxMusicSdkCover   封面/歌手头像补获 + lxGetPic
 *   - lxMusicSdkCatalog 目录搜索（歌手/专辑/歌单）+ 封面补获编排
 *   - lxMusicSdkTracks  专辑/歌单曲目获取（lxGetAlbumSongs、lxGetPlaylistTracks）
 *   - lxMusicSdkBase    底层 HTTP/签名/LxSearchResult 类型（原低层模块）
 *   - lxSearchPlatform  各平台搜索实现（原低层模块）
 */

export { toUrlSongInfo } from './lxMusicSdkBase';
export type { LxSearchResult, LxSearchResultItem } from './lxMusicSdkBase';

export { LX_SOURCE_NAMES } from './lxMusicSdkTypes';
export type {
  LxSourceId,
  LxArtistSearchResult,
  LxAlbumSearchResult,
  LxPlaylistSearchResult,
} from './lxMusicSdkTypes';

export {
  lxSearch,
  txSearchAlbumsRaw,
  txBatchTrackInterval,
} from './lxMusicSdkSearch';

export {
  lxGetPic,
} from './lxMusicSdkCover';

export {
  deriveLxArtistResults,
  deriveLxAlbumResults,
  normalizeLxPlaylistResults,
  lxCatalogSearch,
} from './lxMusicSdkCatalog';

export {
  lxGetAlbumSongs,
  lxGetPlaylistTracks,
} from './lxMusicSdkTracks';

// Note: LX 音乐 URL 解析已统一到 lxUrlResolver.ts（resolveLxUrl），
// 旧函数 lxGetMusicUrl 已删除。如需单次解析请使用 resolveLxUrl / resolveLxUrlViaRust。