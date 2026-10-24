import type { Song } from '../../types';
import { fetchLxSongLyricsRaw } from '../../services/domain/lxLyricFetcher';
import { getStoredPlugins, pluginGetLyric } from '../../services/domain/pluginEngine';
import { lookupCloudMeta } from './cloudHeadMeta';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import { cloudProviderById } from '../../services/cloud/cloudRegistry';
import { CloudFile } from '../../services/cloud/cloudTypes';
import { CloudPlayContext } from './cloudPlaybackResolver';
import { pluginHttpRequest } from '../../services/tauri/pluginApi';

/**
 * 在线歌曲（lx:// / plugin:// / cloud://）的取词。
 *
 * 抽出来是因为**取词必须能脱离播放流程发起**：原先它只长在 `playerPlayback` 的播放分支里，
 * 于是刚进详情页、还没点播放时根本没人取词，歌词要等按下播放才出现（`state.ts` 的在线分支
 * 只能空转等待播放流程投喂）。
 *
 * 这里只负责拿到原始歌词文本，落库与刷新由调用方处理——播放流程那边还带着自己的
 * requestId / 逐行→逐字升级判断，暂不合并，以免动到播放主链路。
 */
export async function fetchOnlineLyricsRaw(song: Song): Promise<string | null> {
  try {
    // cloud:// 网盘曲目：内嵌歌词优先（预探头部解析结果），伴生 .lrc 次之
    if (song.path.startsWith('cloud://')) {
      // 预探在途时短轮询等待（列表期已排产，一般数秒内完成）
      for (let i = 0; i < 6; i++) {
        const meta = await lookupCloudMeta(song.path);
        const raw = meta?.lyricsRaw?.trim();
        if (raw) return raw;
        if (i < 5) await new Promise((r) => setTimeout(r, 2000));
      }
      // 内嵌歌词缺席：探同目录同名 .lrc 伴生文件（用户自配歌词；本分支
      // 原本无兜底，命中即改善）。
      const companion = await fetchCloudCompanionLrc(song);
      if (companion) return companion;
      return null;
    }

    if (song.path.startsWith('lx://')) {
      const raw = await fetchLxSongLyricsRaw(song);
      return raw?.trim() ? raw : null;
    }

    if (song.path.startsWith('plugin://')) {
      const searchResult = song.rawData;
      if (!searchResult?.pluginId) return null;

      const pluginSource = getStoredPlugins().find(
        (plugin) => plugin.id === searchResult.pluginId && plugin.enabled,
      );
      if (!pluginSource) return null;

      const lyricData = await pluginGetLyric(pluginSource, searchResult);
      return lyricData?.lyricsRaw?.trim() ? lyricData.lyricsRaw : null;
    }
  } catch (error) {
    console.warn('[Lyrics] 在线取词失败:', song.path.slice(0, 48), error);
  }

  return null;
}

/** 网盘同目录同名 .lrc 伴生歌词：按播放上下文取 provider/凭据，列同目录
 * 找 `<音频主名>.lrc`（忽略大小写；目录大时分页翻找，最多 3 页），命中后
 * 取直链拉文本。分享免转存直链无目录归属，跳过。任何一步失败静默返回
 * null，交由调用方按无词处理。 */
async function fetchCloudCompanionLrc(song: Song): Promise<string | null> {
  try {
    const ctx =
      CloudPlayContext.tryParse(
        typeof song.rawData?.cloud === 'string' ? song.rawData.cloud : null,
      ) ?? CloudPlayContext.tryParsePath(song.path);
    if (!ctx || ctx.share) return null;
    const parentId = ctx.file.parentId;
    if (!parentId) return null;
    const dot = ctx.file.name.lastIndexOf('.');
    const base = dot > 0 ? ctx.file.name.slice(0, dot) : ctx.file.name;
    if (!base.trim()) return null;
    const wanted = `${base.toLowerCase()}.lrc`;

    const provider = cloudProviderById(ctx.provider);
    if (!provider) return null;
    let cred =
      ctx.accountId === '_' || !ctx.accountId
        ? null
        : await CloudCredentialsStore.instance.credFor(provider.id, ctx.accountId);
    cred ??= await CloudCredentialsStore.instance.soleCredFor(provider.id);
    if (!cred) return null;

    let lrcFile: CloudFile | null = null;
    let cursor: string | null = null;
    for (let page = 0; page < 3 && !lrcFile; page++) {
      const listed = await provider.listDir(cred, parentId, cursor);
      for (const f of listed.files) {
        if (!f.isDir && f.name.toLowerCase() === wanted) {
          lrcFile = f;
          break;
        }
      }
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    if (!lrcFile) return null;

    const link = await provider.getDirectLink(cred, lrcFile);
    const resp = await pluginHttpRequest(
      'GET',
      link.url,
      link.headers ?? undefined,
      undefined,
      10,
    );
    if (resp.status !== 200) return null;
    const text = String(resp.body ?? '').trim();
    return text || null;
  } catch (e) {
    console.debug('[Lyrics] 网盘伴生 .lrc 探测失败:', song.path.slice(0, 48), e);
    return null;
  }
}
