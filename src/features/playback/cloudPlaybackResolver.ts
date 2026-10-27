// 网盘播放接入（与移动端 player_provider.cloud.dart 同构）。
//
// Song.path = cloud://<provider>/<accountId>/<urlEncodedFileJson>，
// 是唯一标识兼直链缓存键；结构化上下文（CloudPlayContext）存
// song.rawData.cloud（JSON 串），会话恢复/跨页传递不依赖 path 反解，
// path 解析仅兜底。直链失效由缓存 TTL 约束；解析失败抛错交
// prepareOnlinePlayback 链路按播放失败处理，不触发插件换源。

import type { Song } from '../../types';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import { cloudProviderById } from '../../services/cloud/cloudRegistry';
import { DirectLinkCache } from '../../services/cloud/directLinkCache';
import {
  CloudFile,
  CloudShareParse,
} from '../../services/cloud/cloudTypes';
import type { CloudProvider } from '../../services/cloud/cloudProvider';
import { normalizeMediaRequestHeaders } from '../../utils/mediaUrl';
import type { ResolveOnlineAudioResult } from './onlinePlaybackResolver';

/** 网盘播放上下文：song.rawData.cloud 的载荷。 */
export class CloudPlayContext {
  readonly provider: string;

  /** 绑定账号 id；分享免登录直链（无需凭据的盘）传 '_'。 */
  readonly accountId: string;

  readonly file: CloudFile;

  /** 分享上下文：免转存直链（directPlayable）播放时携带。 */
  readonly share: CloudShareParse | null;

  constructor(init: {
    provider: string;
    accountId: string;
    file: CloudFile;
    share?: CloudShareParse | null;
  }) {
    this.provider = init.provider;
    this.accountId = init.accountId;
    this.file = init.file;
    this.share = init.share ?? null;
  }

  /** 播放标识：`cloud://<provider>/<accountId>/<urlEncodedFileJson>`。 */
  get path(): string {
    return `cloud://${this.provider}/${this.accountId}/${encodeURIComponent(JSON.stringify(this.file.toJson()))}`;
  }

  toJson(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      provider: this.provider,
      accountId: this.accountId,
      file: this.file.toJson(),
    };
    if (this.share) {
      out['share'] = {
        providerId: this.share.providerId,
        shareId: this.share.shareId,
        shareToken: this.share.shareToken,
        passcode: this.share.passcode,
        directPlayable: this.share.directPlayable,
        files: this.share.files.map((f) => f.toJson()),
      };
    }
    return out;
  }

  static tryParse(raw: unknown): CloudPlayContext | null {
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const j: unknown = JSON.parse(raw);
      if (typeof j !== 'object' || j === null || Array.isArray(j)) return null;
      const rec = j as Record<string, unknown>;
      const shareRec =
        typeof rec['share'] === 'object' && rec['share'] !== null
          ? (rec['share'] as Record<string, unknown>)
          : null;
      return new CloudPlayContext({
        provider: String(rec['provider'] ?? ''),
        accountId: String(rec['accountId'] ?? ''),
        file: CloudFile.fromJson(rec['file'] ?? {}),
        share: shareRec
          ? new CloudShareParse({
              providerId: String(shareRec['providerId'] ?? ''),
              shareId: shareRec['shareId'] != null ? String(shareRec['shareId']) : null,
              shareToken: shareRec['shareToken'] != null ? String(shareRec['shareToken']) : null,
              passcode: shareRec['passcode'] != null ? String(shareRec['passcode']) : null,
              directPlayable: shareRec['directPlayable'] === true,
              files: Array.isArray(shareRec['files'])
                ? (shareRec['files'] as unknown[]).map((f) => CloudFile.fromJson(f))
                : [],
            })
          : null,
      });
    } catch (e) {
      console.warn('[cloud] 网盘播放上下文解析失败:', e);
      return null;
    }
  }

  /** 从 cloud:// path 反解（rawData 丢失时的兜底；无分享上下文）。 */
  static tryParsePath(path: string): CloudPlayContext | null {
    if (!path.startsWith('cloud://')) return null;
    const rest = path.slice('cloud://'.length);
    const p1 = rest.indexOf('/');
    if (p1 <= 0) return null;
    const rest2 = rest.slice(p1 + 1);
    const p2 = rest2.indexOf('/');
    if (p2 < 0) return null;
    try {
      const file = CloudFile.fromJson(
        JSON.parse(decodeURIComponent(rest2.slice(p2 + 1))),
      );
      return new CloudPlayContext({
        provider: rest.slice(0, p1),
        accountId: rest2.slice(0, p2),
        file,
      });
    } catch (e) {
      console.warn('[cloud] 网盘播放路径反解失败:', e);
      return null;
    }
  }
}

/** 网盘文件构造可播放 Song（时长由播放器实测回填）。 */
export const cloudSongFromContext = (
  ctx: CloudPlayContext,
  artistName: string,
): Song => ({
  name: ctx.file.name,
  title: ctx.file.name,
  path: ctx.path,
  artist: artistName,
  artist_names: [artistName],
  effective_artist_names: [artistName],
  album: '',
  album_artist: '',
  album_key: '',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 0,
  rawData: { cloud: JSON.stringify(ctx.toJson()) },
});

let lastResolveError = '';

/** 最近一次网盘直链解析失败的用户文案（播放层失败提示用）。 */
export const getLastCloudResolveError = (): string => lastResolveError;

const contextOf = (audioFilePath: string, song: Song): CloudPlayContext | null =>
  CloudPlayContext.tryParse(
    typeof song.rawData?.cloud === 'string' ? song.rawData.cloud : null,
  ) ?? CloudPlayContext.tryParsePath(audioFilePath);

/** 网盘直链（播放与下载共用；headers 为原始请求头，播放侧再按需归一化）。 */
export interface CloudDirectLink {
  url: string;
  headers: Record<string, string> | null;
}

/** 网盘直链解析：凭据 → 缓存 → getDirectLink/getShareDirectLink。 */
export const resolveCloudDirectLink = async (
  ctx: CloudPlayContext,
): Promise<CloudDirectLink> => {
  const provider: CloudProvider | null = cloudProviderById(ctx.provider);
  if (!provider) throw new Error('该网盘暂未支持');

  // 凭据：先按绑定的 accountId 精确取，再退该盘单账号便捷读取
  let cred: Record<string, string> | null =
    ctx.accountId === '_' || !ctx.accountId
      ? null
      : await CloudCredentialsStore.instance.credFor(provider.id, ctx.accountId);
  cred ??= await CloudCredentialsStore.instance.soleCredFor(provider.id);

  const fromShare = ctx.share?.directPlayable === true;
  if (!cred && !fromShare) throw new Error('网盘账号未绑定或已失效');

  const cacheKey = ctx.path;
  let link = await DirectLinkCache.instance.get(cacheKey, provider.directLinkTtl);
  if (!link) {
    link = fromShare
      ? await provider.getShareDirectLink(cred, ctx.share!, ctx.file)
      : await provider.getDirectLink(cred ?? {}, ctx.file);
    DirectLinkCache.instance.put(cacheKey, link);
  }

  return { url: link.url, headers: link.headers ?? null };
};

/** 云端歌曲直链缓存作废（播放失败后强制重解析新直链；上下文缺失时静默忽略）。 */
export const invalidateCloudDirectLink = async (
  audioFilePath: string,
  song: Song,
): Promise<void> => {
  const ctx = contextOf(audioFilePath, song);
  if (ctx) DirectLinkCache.instance.invalidate(ctx.path);
};

/** 网盘曲目直链解析（播放层）：缓存 → getDirectLink/getShareDirectLink → 在线直链。 */
export const resolveCloudOnlineAudio = async (
  audioFilePath: string,
  song: Song,
): Promise<ResolveOnlineAudioResult> => {
  try {
    const ctx = contextOf(audioFilePath, song);
    if (!ctx) throw new Error('网盘歌曲信息缺失，请重新添加');
    const link = await resolveCloudDirectLink(ctx);

    return {
      audioFilePath: link.url,
      pluginHeaders: normalizeMediaRequestHeaders(link.url, link.headers),
      currentPlayingQuality: null,
      currentPlayingAudioUrl: link.url,
      fullBuffer: true,
      // 稳定流缓存 key：直链签名轮换/过期重解析后，stream_cache 仍按
      // cloud:// 路径命中已完成的音频缓存，避免重复消耗下载流量。
      streamCacheKey: ctx.path,
    };
  } catch (e) {
    lastResolveError = e instanceof Error ? e.message : String(e);
    throw e;
  }
};
