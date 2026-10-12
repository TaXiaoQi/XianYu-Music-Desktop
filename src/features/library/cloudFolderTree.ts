// 文件夹树网盘接入：目录树挂载虚拟「网盘」根，点击网盘目录在主列表
// 展示网盘音频（Song.path 为 cloud://…，走既有 cloud 播放管线，播放链路零改动）。
//
// 结构：虚拟根「网盘」→ 各盘已绑定账号节点（懒加载哨兵）→ 盘内目录
// （懒加载）。目录节点 path 用 slug 编码保证多次构建稳定可复现；
// path → {providerId, accountId, dirPath} 上下文存模块级注册表，
// 供列目录与加载歌曲反查。normalizePath 会 lowercase，slug 十六进制
// 转义统一小写，保证节点 path 小写稳定。

import { ref } from 'vue';

import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import { cloudProviderById, cloudProviders } from '../../services/cloud/cloudRegistry';
import { CloudListResult, type CloudFile } from '../../services/cloud/cloudTypes';
import { parseCloudFileName } from '../../services/cloud/cloudFilename';
import { CloudPlayContext, cloudSongFromContext } from '../playback/cloudPlaybackResolver';
import type { FolderNode, Song } from '../../types';

/** 目录树中网盘虚拟根节点的 path。 */
export const CLOUD_TREE_ROOT_PATH = '__cloud_root__';

/** 是否为网盘目录节点（虚拟根或 cloud:// 盘内目录）。 */
export const isCloudFolderPath = (p: string): boolean =>
  p === CLOUD_TREE_ROOT_PATH || p.startsWith('cloud://');

/** 目录标识 → 稳定 slug（十六进制转义统一小写，保证多次构建结果一致）。 */
const slugSegment = (raw: string) =>
  encodeURIComponent(raw).replace(/%[0-9A-Fa-f]{2}/g, h => h.toLowerCase());

/** 网盘目录节点注册表：树节点 path → 列目录/加载歌曲所需上下文。 */
const cloudFolderRegistry = new Map<string, { providerId: string; accountId: string; dirPath: string }>();

/** 注册表版本号：新增节点时自增，驱动视图层监听刷新。 */
export const cloudFolderRegistryVersion = ref(0);

/** 登记网盘目录节点（仅登记带完整上下文的节点；重复登记不触发更新）。 */
export const registerCloudFolder = (node: FolderNode) => {
  if (!node.cloudProviderId || !node.cloudAccountId || !node.cloudDirPath) {
    return;
  }
  if (cloudFolderRegistry.has(node.path)) {
    return;
  }
  cloudFolderRegistry.set(node.path, {
    providerId: node.cloudProviderId,
    accountId: node.cloudAccountId,
    dirPath: node.cloudDirPath,
  });
  cloudFolderRegistryVersion.value += 1;
};

/** 按树节点 path 反查网盘目录上下文；非网盘目录返回 null。 */
export const resolveCloudFolder = (path: string) =>
  cloudFolderRegistry.get(path) ?? null;

/** 构建目录树网盘子树：虚拟根「网盘」+ 已绑定账号的盘节点。 */
export const buildCloudTreeNodes = async (): Promise<FolderNode[]> => {
  const providerNodes: FolderNode[] = [];

  for (const provider of cloudProviders) {
    const accounts = await CloudCredentialsStore.instance.accountsFor(provider.id);
    if (accounts.length === 0) {
      continue;
    }
    const account = accounts[0]; // 同盘多账号暂取首个
    providerNodes.push({
      name: provider.displayName,
      path: `cloud://${provider.id}/${account.accountId}`,
      children: [],
      child_count: 1, // 哨兵：未列目录，保证节点可展开
      children_loaded: false,
      song_count: 0,
      cover_song_path: null,
      is_expanded: false,
      cloudProviderId: provider.id,
      cloudAccountId: account.accountId,
      cloudDirPath: provider.rootPath,
    });
  }

  const rootNode: FolderNode = {
    name: '网盘',
    path: CLOUD_TREE_ROOT_PATH,
    children: providerNodes,
    child_count: providerNodes.length,
    children_loaded: true,
    song_count: 0,
    cover_song_path: null,
    is_expanded: false,
  };

  const registerAll = (nodes: FolderNode[]) => {
    for (const node of nodes) {
      registerCloudFolder(node);
      if (node.children.length > 0) {
        registerAll(node.children);
      }
    }
  };
  registerAll([rootNode]);

  return [rootNode];
};

/** 列网盘目录单页：优先精确账号，退回该盘首个账号。 */
export const listCloudDirPage = async (
  providerId: string,
  accountId: string,
  dirPath: string,
  cursor?: string | null,
): Promise<CloudListResult> => {
  const provider = cloudProviderById(providerId);
  if (!provider) {
    return new CloudListResult({ files: [], nextCursor: null });
  }
  const accounts = await CloudCredentialsStore.instance.accountsFor(providerId);
  const account = accounts.find(a => a.accountId === accountId) ?? accounts[0];
  if (!account) {
    return new CloudListResult({ files: [], nextCursor: null });
  }
  return provider.listDir(account.cred, dirPath, cursor);
};

/** 列网盘目录下的全部子目录（翻页收集，最多 10 页防失控）。 */
export const listCloudFolderChildren = async (node: FolderNode): Promise<FolderNode[]> => {
  const ctx = resolveCloudFolder(node.path);
  if (!ctx) {
    return [];
  }

  const children: FolderNode[] = [];
  let cursor: string | null = null;
  let page = 0;
  do {
    const result = await listCloudDirPage(ctx.providerId, ctx.accountId, ctx.dirPath, cursor);
    for (const file of result.files) {
      const dirId = file.path ?? file.id;
      if (!file.isDir || !dirId) {
        continue;
      }
      const child: FolderNode = {
        name: file.name,
        path: `${node.path}/${slugSegment(dirId)}`,
        children: [],
        child_count: 1, // 哨兵：未列目录，保证节点可展开
        children_loaded: false,
        song_count: 0,
        cover_song_path: null,
        is_expanded: false,
        cloudProviderId: ctx.providerId,
        cloudAccountId: ctx.accountId,
        cloudDirPath: dirId,
      };
      children.push(child);
      registerCloudFolder(child);
    }
    cursor = result.nextCursor;
    page += 1;
  } while (cursor && page < 10);

  return children;
};

/** 网盘文件 → 可播放 Song：文件名解析歌手/歌名，无歌手段时回落盘名 */
export function cloudFileToSong(item: CloudFile, providerId: string, providerName: string, accountId: string): Song {
  const ctx = new CloudPlayContext({ provider: providerId, accountId, file: item });
  const parts = parseCloudFileName(item.name);
  const artistName = parts.artist ?? providerName;
  const base = cloudSongFromContext(ctx, artistName);
  return {
    ...base,
    name: parts.title,
    title: parts.title,
    artist: artistName,
    artist_names: [artistName],
    effective_artist_names: [artistName],
    // rawData 补充盘名（来源标签展示用），保留 cloud 播放上下文
    rawData: { ...base.rawData, providerName },
  } as Song;
}

/** 加载网盘目录下全部音频文件（翻页收集，最多 20 页防失控）。 */
export const loadCloudFolderSongs = async (path: string): Promise<Song[]> => {
  const ctx = resolveCloudFolder(path);
  if (!ctx) {
    return [];
  }

  const providerName = cloudProviderById(ctx.providerId)?.displayName ?? '网盘';
  const songs: Song[] = [];
  let cursor: string | null = null;
  let page = 0;
  do {
    const result = await listCloudDirPage(ctx.providerId, ctx.accountId, ctx.dirPath, cursor);
    for (const file of result.files) {
      if (!file.isDir && file.isAudio) {
        songs.push(cloudFileToSong(file, ctx.providerId, providerName, ctx.accountId));
      }
    }
    cursor = result.nextCursor;
    page += 1;
  } while (cursor && page < 20);

  return songs;
};
