/**
 * Baka 插件引擎 · 媒体操作 Mixin。
 *
 * 承接 Baka 插件的：播放 URL 获取（getMediaSource，含 new→legacy 音质回退、
 * 酷狗/网易云外链预检、QQ 试听链拒绝）、歌词获取（getLyric）、评论获取
 * （getMusicComments）、封面获取（getCover）与详情页 URL（getMusicDetailPageUrl）。
 *
 * 依赖 BakaPluginCore（状态字段 `_mediaSourceCache`/`_mediaSourcePending`、
 * `_ensureInstance`）与 bakaPluginManagerBase 的叶子工具；供 bakaPluginManagerCatalog
 * 继续继承，最终由 bakaPluginManager 门面组合并导出单例。
 */
import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
  QualityKey,
  OnlineQualityFallbackBehavior,
} from '../../types';
import {
  QUALITY_META,
  ALL_QUALITY_KEYS,
  normalizeQualityKey,
  resolveOnlinePlayQuality,
} from '../../types';
import { BakaPluginCore } from './bakaPluginManagerCore';
import {
  log,
  detectLyricFormat,
  MEDIA_SOURCE_CACHE_TTL_MS,
  adaptMediaItemForPluginQuality,
  buildMediaSourceCacheKey,
  cleanKugouPluginUrl,
  clonePluginMusicInfo,
  extractOnlySupportedQuality,
  firstHeaderMap,
  firstStringField,
  getMediaItemStableId,
  inferActualQualityFromMediaUrl,
  isFatalMediaSourceError,
  isKugouLikeSource,
  isLikelyKugouProxyApiUrl,
  isNeteaseLikeSource,
  isNeteaseOuterUrl,
  newToLegacyQualityMap,
  normalizeSupportedQualities,
  probeKugouProxyCandidate,
  probeNeteaseOuterUrl,
  type BakaComment,
  type BakaCommentResult,
  type BakaLyricFormat,
} from './bakaPluginManagerBase';
import { buildBakaMfLyricsRaw } from './bakaMfLyricsBuilder';
import { clearLastSandboxError, getLastSandboxError } from './pluginSandboxManager';
import {
  resetMediaItem,
  extractCoverUrl,
  extractDurationMs,
  qualityKeyToPluginString,
} from './pluginResultMappers';
import { isSongLevelError } from './lxPluginEngine';
import { normalizeMediaRequestHeaders, sanitizeMediaUrl } from '../../utils/mediaUrl';
import { pluginApi } from '../tauri/pluginApi';
import { isQqTrialMediaUrl } from './qqHostSearchFallback';

/**
 * Baka 插件媒体操作（混入 BakaPluginCore）。
 * 共享状态字段与 `_ensureInstance` 由基类提供，本类只关注媒体数据的取流与解析。
 */
export class BakaPluginMedia extends BakaPluginCore {
  // ==================== 播放 URL 获取（核心方法）====================

  /**
   * 获取 Baka 插件播放 URL
   *
   * 与 MusicFree 插件完全分离，使用 12 档原生音质键值。
   * 内置 newToLegacyQualityMap 回退：新键失败时自动回退到旧键。
   *
   * @param source 插件源
   * @param item 搜索结果项
   * @param quality 目标音质
   * @param fallbackBehavior 回退行为
   * @param availableQualities 可用音质列表
   */
  async getMediaSource(
    source: PluginSource,
    item: PluginSearchResult,
    quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
    fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
    availableQualities: QualityKey[] | null = null,
  ): Promise<PluginMusicInfo | null> {
    const musicItem = item.rawData
      ? resetMediaItem(item.rawData, source.name)
      : resetMediaItem(item, source.name);
    const cacheKey = buildMediaSourceCacheKey(source, item, musicItem, quality, fallbackBehavior, availableQualities);
    const now = Date.now();
    const isKugou = isKugouLikeSource(source, musicItem);
    const isNetease = isNeteaseLikeSource(source, musicItem);
    const cached = this._mediaSourceCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      const cachedValue = clonePluginMusicInfo(cached.value);
      if (isKugou && cachedValue.url && isLikelyKugouProxyApiUrl(cachedValue.url)) {
        const probe = await probeKugouProxyCandidate(cachedValue.url, cachedValue.headers || {});
        if (probe.playable) {
          log(`[getMediaSource] 命中短时缓存: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
          return cachedValue;
        }
        log(`[getMediaSource] 短时缓存中的酷狗代理URL已失效，删除缓存并重新解析: ${probe.reason || cachedValue.url}`);
        this._mediaSourceCache.delete(cacheKey);
      } else if (isNetease && cachedValue.url && isNeteaseOuterUrl(cachedValue.url)) {
        const probe = await probeNeteaseOuterUrl(cachedValue.url);
        if (probe.playable) {
          log(`[getMediaSource] 命中短时缓存: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
          return cachedValue;
        }
        log(`[getMediaSource] 短时缓存中的网易云外链不可用，删除缓存并重新解析: ${probe.reason || cachedValue.url}`);
        this._mediaSourceCache.delete(cacheKey);
      } else {
        log(`[getMediaSource] 命中短时缓存: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
        return cachedValue;
      }
    }
    if (cached) {
      this._mediaSourceCache.delete(cacheKey);
    }

    const pending = this._mediaSourcePending.get(cacheKey);
    if (pending) {
      log(`[getMediaSource] 复用进行中的直链解析: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
      const value = await pending;
      return value ? clonePluginMusicInfo(value) : null;
    }

    const pendingPromise = this._getMediaSourceUncached(source, item, quality, fallbackBehavior, availableQualities)
      .then((value) => {
        if (value?.url) {
          this._mediaSourceCache.set(cacheKey, {
            expiresAt: Date.now() + MEDIA_SOURCE_CACHE_TTL_MS,
            value: clonePluginMusicInfo(value),
          });
        }
        return value;
      })
      .finally(() => {
        this._mediaSourcePending.delete(cacheKey);
      });
    this._mediaSourcePending.set(cacheKey, pendingPromise);
    const value = await pendingPromise;
    return value ? clonePluginMusicInfo(value) : null;
  }

  protected async _getMediaSourceUncached(
    source: PluginSource,
    item: PluginSearchResult,
    quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
    fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
    availableQualities: QualityKey[] | null = null,
  ): Promise<PluginMusicInfo | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    if (typeof inst.getMediaSource !== 'function') {
      log(`[${source.name}] 无 getMediaSource 函数`);
      return null;
    }

    const musicItem = item.rawData
      ? resetMediaItem(item.rawData, source.name)
      : resetMediaItem(item, source.name);

    const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;

    // 构建音质尝试列表：始终使用 12 档原生键值
    const tryPairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];
    const declaredAvailableQualities = normalizeSupportedQualities(inst.supportedQualities);
    const effectiveAvailableQualities = availableQualities?.length ? availableQualities : declaredAvailableQualities;

    if (isQualityKey(quality) && effectiveAvailableQualities && effectiveAvailableQualities.length > 0) {
      const resolvedKeys = resolveOnlinePlayQuality(quality, effectiveAvailableQualities, fallbackBehavior);
      for (const q of resolvedKeys) {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(q), qualityKey: q });
      }
    } else if (isQualityKey(quality)) {
      // 插件未声明 supportedQualities（Baka 等自回落插件）时不再全档展开逐级请求：
      // 每档展开意味着一次起播要串行发 N 次 track_v2 网络请求，极其缓慢。改为只请求
      // 目标档，并按回退方向补一个相邻档，具体回落交由插件内部 actualQuality 报告。
      if (fallbackBehavior === 'pause') {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
      } else {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
        const baseIdx = ALL_QUALITY_KEYS.indexOf(quality);
        if (baseIdx !== -1) {
          const adjacentQ = fallbackBehavior === 'higher'
            ? ALL_QUALITY_KEYS[baseIdx + 1]
            : ALL_QUALITY_KEYS[baseIdx - 1];
          if (adjacentQ) tryPairs.push({ pluginQ: qualityKeyToPluginString(adjacentQ), qualityKey: adjacentQ });
        }
      }
    } else {
      tryPairs.push({ pluginQ: quality, qualityKey: '320k' });
    }

    log(`[getMediaSource] 调用 ${source.name}, id=${musicItem.id}, platform=${musicItem.platform}, tryQualities=${JSON.stringify(tryPairs.map(p => p.pluginQ))}`);
    (globalThis as any).__lastPluginError = '';

    let result: any = null;
    let lastError: any = null;
    let successPairIdx = -1;
    let songLevelErrorDetected = false;
    let nextPairIdxOverride: number | null = null;
    const attemptedPluginQualities = new Set<string>();
    const isKugou = isKugouLikeSource(source, musicItem);
    const isNetease = isNeteaseLikeSource(source, musicItem);
    // 网易云外链预检结果记忆：各档位常返回同一 outer/url，避免重复探测同一 URL
    const neteaseOuterUrlProbes = new Map<string, { playable: boolean; reason?: string }>();
    const shouldAcceptMediaResult = async (candidate: any, pairIdx: number, qualityLabel: string): Promise<boolean> => {
      const candidateRawUrl = typeof candidate?.url === 'string' ? candidate.url : '';
      if (!candidateRawUrl) return false;

      const candidateUrl = isKugou ? cleanKugouPluginUrl(candidateRawUrl) : sanitizeMediaUrl(candidateRawUrl);
      // QQ 60 秒试听链（RS02 前缀）不是可用播放源：免费公共中转（vkeys.cn 等）对
      // 游客恒返试听且各音质档同一文件，若照常返回用户只能听到 60 秒还误以为歌曲就这么短。
      // 拒绝并继续尝试其余档位，全档失败时由起播失败行为（跳过/停止）与 toast 透出原因。
      if (!isKugou && isQqTrialMediaUrl(candidateUrl)) {
        lastError = new Error('该音源仅能获取 60 秒试听');
        log(`[getMediaSource] quality=${qualityLabel} 返回 QQ 试听链(RS02)，拒绝并继续: ${candidateUrl.substring(0, 80)}`);
        return false;
      }
      // 网易云官方外链：版权受限歌 302 到 404 HTML 页（各档同一 URL），
      // 预检拒绝后音质回退继续，全档失败时透出"该音源无法提供此歌曲"
      if (isNetease && candidateUrl && isNeteaseOuterUrl(candidateUrl)) {
        let probe = neteaseOuterUrlProbes.get(candidateUrl);
        if (!probe) {
          probe = await probeNeteaseOuterUrl(candidateUrl);
          neteaseOuterUrlProbes.set(candidateUrl, probe);
        }
        if (!probe.playable) {
          lastError = new Error(`该音源无法提供此歌曲（${probe.reason || '外链不可用'}）`);
          log(`[getMediaSource] quality=${qualityLabel} 网易云外链不可用，拒绝并继续: ${probe.reason || candidateUrl.substring(0, 80)}`);
          return false;
        }
      }
      if (isKugou && candidateUrl && isLikelyKugouProxyApiUrl(candidateUrl)) {
        const candidateHeaders = normalizeMediaRequestHeaders(
          candidateUrl,
          firstHeaderMap(candidate.headers, candidate.header, candidate.requestHeaders),
        ) || {};
        const probe = await probeKugouProxyCandidate(candidateUrl, candidateHeaders);
        if (!probe.playable) {
          lastError = new Error(probe.reason || '代理接口未返回可播放地址');
          log(`[getMediaSource] quality=${qualityLabel} 返回的代理URL不可播放，继续下一档: ${probe.reason || candidateUrl}`);
          return false;
        }
      }

      successPairIdx = pairIdx;
      return true;
    };

    for (let pairIdx = 0; pairIdx < tryPairs.length; pairIdx++) {
      const q = tryPairs[pairIdx].pluginQ;
      const attemptMusicItem = adaptMediaItemForPluginQuality(source, musicItem, tryPairs[pairIdx].qualityKey);
      if (attemptedPluginQualities.has(q)) {
        log(`[getMediaSource] quality=${q} 已尝试过，跳过重复调用`);
        result = null;
        continue;
      }
      attemptedPluginQualities.add(q);

      try {
        clearLastSandboxError();
        result = await inst.getMediaSource(attemptMusicItem, q);
        if (result?.url) {
          if (await shouldAcceptMediaResult(result, pairIdx, q)) {
            break;
          }
          result = null;
        }

        const sandboxErr = getLastSandboxError();
        if (!result?.url && sandboxErr && isFatalMediaSourceError(sandboxErr)) {
          log(`[getMediaSource] 沙箱日志检测到致命错误，跳过剩余音质: ${sandboxErr}`);
          songLevelErrorDetected = true;
          break;
        }

        // 新键无结果，尝试旧键回退（对齐 BakaMusic newToLegacyQualityMap）。
        // 当用户选择"暂停/不回退"时，不再尝试旧键，避免绕过设置继续刷请求。
        const legacyQ = fallbackBehavior === 'pause' ? undefined : newToLegacyQualityMap[q];
        if (!result?.url && legacyQ && legacyQ !== q) {
          if (attemptedPluginQualities.has(legacyQ)) {
            log(`[getMediaSource] legacy quality=${legacyQ} 已尝试过，跳过重复回退`);
          } else {
            attemptedPluginQualities.add(legacyQ);
            log(`[getMediaSource] quality=${q} 无结果，回退到旧键: ${legacyQ}`);
            clearLastSandboxError();
            result = await inst.getMediaSource(attemptMusicItem, legacyQ);
            if (result?.url) {
              if (await shouldAcceptMediaResult(result, pairIdx, legacyQ)) {
                break;
              }
              result = null;
            }
            const legacySandboxErr = getLastSandboxError();
            if (!result?.url && legacySandboxErr && isFatalMediaSourceError(legacySandboxErr)) {
              log(`[getMediaSource] 沙箱日志检测到致命错误(legacy)，跳过剩余音质: ${legacySandboxErr}`);
              songLevelErrorDetected = true;
              break;
            }
          }
        }
      } catch (e: any) {
        lastError = e;
        const errMsg = e?.message || (typeof e === 'string' ? e : String(e || ''));
        log(`[getMediaSource] quality=${q} 异常: ${errMsg}`);
        if (isSongLevelError(errMsg) || isFatalMediaSourceError(errMsg)) {
          log(`[getMediaSource] 歌曲级/致命错误，跳过剩余音质: ${errMsg}`);
          songLevelErrorDetected = true;
          break;
        }
        const onlySupportedQuality = fallbackBehavior === 'pause' ? undefined : extractOnlySupportedQuality(errMsg);
        if (onlySupportedQuality) {
          let targetIdx = tryPairs.findIndex(pair => pair.qualityKey === onlySupportedQuality);
          if (targetIdx < 0) {
            targetIdx = tryPairs.length;
            tryPairs.push({
              pluginQ: qualityKeyToPluginString(onlySupportedQuality),
              qualityKey: onlySupportedQuality,
            });
          }
          if (targetIdx >= 0 && targetIdx !== pairIdx) {
            log(`[getMediaSource] 插件提示仅支持 ${onlySupportedQuality}，跳过中间音质直接尝试`);
            nextPairIdxOverride = targetIdx;
          } else {
            log(`[getMediaSource] 插件声明当前仅支持 ${onlySupportedQuality} 但仍失败，停止重复重试`);
          }
        }
      }
      if (songLevelErrorDetected) break;
      if (nextPairIdxOverride !== null) {
        pairIdx = nextPairIdxOverride - 1;
        nextPairIdxOverride = null;
        result = null;
        continue;
      }
      if (result?.url) break;
      log(`[getMediaSource] quality=${q} 未返回有效URL，尝试下一档`);
      result = null;
    }

    if (!result || typeof result !== 'object') {
      const errMsg = lastError ? `异常: ${lastError.message}` : (result === null ? '返回null' : `非对象(${typeof result})`);
      log(`[getMediaSource] ${source.name} 失败: ${errMsg}`);
      (globalThis as any).__lastPluginError = `[${source.name}] ${errMsg}`;
      return null;
    }

    const rawUrl = typeof result.url === 'string' ? result.url : '';

    // 酷狗插件专用 URL 清洗：白名单策略，比通用方法更激进
    let url: string;
    if (isKugou) {
      url = cleanKugouPluginUrl(rawUrl);
      // 如果专用方法失败，回退到通用方法
      if (!url || !/^https?:\/\//.test(url)) {
        console.warn('[BakaPluginManager] 酷狗专用清洗失败，回退到通用 sanitizeMediaUrl');
        url = sanitizeMediaUrl(rawUrl);
      }
    } else {
      url = sanitizeMediaUrl(rawUrl);
    }

    // 通用兜底：如果清洗后仍不以 http 开头，用 indexOf 强制提取
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      const idx1 = rawUrl.indexOf('https://');
      const idx2 = rawUrl.indexOf('http://');
      const idx = idx1 >= 0 ? idx1 : idx2;
      if (idx >= 0) {
        console.warn('[BakaPluginManager] 通用清洗未生效，indexOf 兜底提取:', {
          sanitized: url.slice(0, 120),
          firstChars: rawUrl.slice(0, 5).split('').map((c: string) => '0x' + c.charCodeAt(0).toString(16)).join(','),
          lastChars: rawUrl.slice(-5).split('').map((c: string) => '0x' + c.charCodeAt(0).toString(16)).join(','),
        });
        url = rawUrl.substring(idx);
        while (url.length > 0) {
          const c = url.charCodeAt(url.length - 1);
          if (c === 0x2c || c === 0x3b || c === 0x60 || c === 0x27 || c === 0x22 || c <= 0x20) {
            url = url.substring(0, url.length - 1);
          } else break;
        }
      }
    }
    const headers = normalizeMediaRequestHeaders(
      url,
      firstHeaderMap(result.headers, result.header, result.requestHeaders),
    ) || {};
    const ekey = firstStringField(result, ['ekey', 'eKey', 'encryptKey', 'encryptionKey', 'qmcKey', 'qmc2Key']);
    const cek = firstStringField(result, ['cek', 'cKey', 'contentKey', 'decryptKey', 'decryptionKey', 'cencKey']);
    const lyric = result.lyric || result.rawLrc || result.lrc || '';
    const ttml = result.ttml || '';
    const tlyric = result.tlyric || result.translation || '';
    const lxlyric = result.lxlyric || '';
    const yrc = result.yrc || '';
    const qrc = result.qrc || '';
    const eslrc = result.eslrc || '';
    const coverUrl = extractCoverUrl(result) || result.coverUrl || result.artwork || '';

    if (!url) {
      log(`[getMediaSource] ${source.name} 返回空URL, result=${JSON.stringify(result)?.substring(0, 200)}`);
      (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL`;
      return null;
    }
    if (rawUrl && rawUrl !== url) {
      log(`[getMediaSource] 已清洗异常URL: ${rawUrl.substring(0, 120)} -> ${url.substring(0, 120)}`);
    }

    const requestedSuccessQuality = successPairIdx >= 0 ? tryPairs[successPairIdx].qualityKey : undefined;
    const resultQuality = normalizeQualityKey(result.quality);
    const actualQuality = resultQuality ?? inferActualQualityFromMediaUrl(url, requestedSuccessQuality);
    const lyricsRaw = (ttml || lyric || tlyric || lxlyric || yrc || qrc || eslrc)
      ? buildBakaMfLyricsRaw({ ttml, lyric, tlyric, lxlyric, yrc, qrc, eslrc })
      : '';

    const headerKeys = Object.keys(headers);
    log(`[getMediaSource] 成功: url=${url.substring(0, 100)}, headers=[${headerKeys.join(',')}], ekey=${ekey ? '有' : '无'}, cek=${cek ? '有' : '无'}, lyricLen=${lyric.length}, ttmlLen=${ttml.length}, actualQuality=${actualQuality}`);
    return {
      url,
      headers,
      ekey: ekey || undefined,
      cek: cek || undefined,
      lyric,
      ttml: ttml || undefined,
      tlyric,
      lxlyric,
      yrc,
      qrc,
      eslrc,
      lyricsRaw,
      coverUrl,
      actualQuality,
    };
  }

  // ==================== 歌词获取 ====================

  /**
   * 获取歌词（支持所有 Baka 歌词格式）
   *
   * Baka 插件 getLyric 返回 ILyricSource 对象，可能包含：
   *   - rawLrc / lrc / lyric: 标准歌词文本
   *   - translation / tlyric: 翻译歌词
   *   - romanization: 罗马音歌词
   *   - format: 歌词格式标识
   *   - yrc / qrc / lxlyric / eslrc: 逐字歌词
   *
   * 使用 Baka/MF 专用构建器构建 lyricsRaw 文本（优先级：yrc > qrc > eslrc > lxlyric > lyric）
   */
  async getLyric(
    source: PluginSource,
    item: PluginSearchResult,
  ): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; ttml?: string; lyricsRaw?: string; format?: BakaLyricFormat } | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getLyric !== 'function') {
        log(`[getLyric] ${source.name} 插件未实现 getLyric 方法`);
        return null;
      }

      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);

      const lrcSource = (await inst.getLyric(musicItem)?.catch((e: any) => {
        log(`[getLyric] ${source.name} 调用异常: ${e?.message ?? e}`);
        return null;
      })) || null;

      if (!lrcSource) {
        log(`[getLyric] ${source.name} 返回空结果`);
        return null;
      }

      // 兼容多种字段名
      const rawLrc = lrcSource.rawLrc || lrcSource.lyric || lrcSource.lrc || '';
      const ttml = lrcSource.ttml || '';
      const translation = lrcSource.translation || lrcSource.tlyric || lrcSource.translateLyric || '';
      const romanization = lrcSource.romanization || lrcSource.rlyric || '';
      const lxlyric = lrcSource.lxlyric || '';
      const yrc = lrcSource.yrc || '';
      const qrc = lrcSource.qrc || '';
      const eslrc = lrcSource.eslrc || '';

      // [诊断] 输出完整的歌词数据信息，帮助定位逐字歌词缺失问题
      log(`[getLyric] ${source.name} 原始返回字段: keys=[${Object.keys(lrcSource).join(',')}], format=${lrcSource.format ?? '(none)'}, rawLrcLen=${rawLrc.length}, ttmlLen=${ttml.length}, lxlyricLen=${lxlyric.length}, yrcLen=${yrc.length}, qrcLen=${qrc.length}, eslrcLen=${eslrc.length}`);
      if (rawLrc) log(`[getLyric] rawLrc 预览: ${rawLrc.substring(0, 200)}`);
      if (ttml) log(`[getLyric] ttml 预览: ${ttml.substring(0, 200)}`);
      if (lxlyric) log(`[getLyric] lxlyric 预览: ${lxlyric.substring(0, 200)}`);
      if (yrc) log(`[getLyric] yrc 预览: ${yrc.substring(0, 200)}`);
      if (qrc) log(`[getLyric] qrc 预览: ${qrc.substring(0, 200)}`);
      if (eslrc) log(`[getLyric] eslrc 预览: ${eslrc.substring(0, 200)}`);

      // 检测歌词格式
      let format: BakaLyricFormat | undefined;
      if (lrcSource.format) {
        format = lrcSource.format as BakaLyricFormat;
      } else if (ttml) {
        format = 'ttml';
      } else if (yrc) {
        format = 'yrc';
      } else if (qrc) {
        format = 'qrc';
      } else if (eslrc) {
        format = 'eslrc';
      } else if (lxlyric) {
        format = 'lrc-a2';
      } else if (rawLrc) {
        format = detectLyricFormat(rawLrc);
      }

      if (!rawLrc && !ttml && !lxlyric && !yrc && !qrc && !eslrc) {
        log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
        return null;
      }

      const lyricsRaw = buildBakaMfLyricsRaw({
        ttml,
        lyric: rawLrc,
        tlyric: translation,
        rlyric: romanization,
        lxlyric,
        yrc,
        qrc,
        eslrc,
      });
      log(`[getLyric] ${source.name} 成功, rawLrc长度=${rawLrc.length}, ttml长度=${ttml.length}, lxlyric长度=${lxlyric.length}, yrc长度=${yrc.length}, qrc长度=${qrc.length}, format=${format}`);
      return { lyric: rawLrc, tlyric: translation, lxlyric, yrc, qrc, eslrc, ttml, lyricsRaw, format };
    } catch (e) {
      log(`获取歌词失败: ${source.name} ${e}`);
      return null;
    }
  }

  // ==================== 评论获取 ====================

  /**
   * 获取歌曲评论（对齐 BakaMusic getMusicComments）
   *
   * @param source 插件源
   * @param item 搜索结果项
   * @param page 页码（从 1 开始）
   * @returns 评论列表
   */
  async getMusicComments(
    source: PluginSource,
    item: PluginSearchResult,
    page: number = 1,
  ): Promise<BakaCommentResult | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicComments !== 'function') {
        log(`[getMusicComments] ${source.name} 插件未实现 getMusicComments 方法`);
        return null;
      }

      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);

      const result = (await inst.getMusicComments(musicItem, page)?.catch((e: any) => {
        log(`[getMusicComments] ${source.name} 调用异常: ${e?.message ?? e}`);
        return null;
      })) || null;

      if (!result) return null;

      // 兼容多种返回格式
      const comments: BakaComment[] = Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []);
      const isEnd = result.isEnd ?? (comments.length === 0);

      log(`[getMusicComments] ${source.name} 成功, 获取 ${comments.length} 条评论, isEnd=${isEnd}`);
      return { isEnd, data: comments };
    } catch (e) {
      log(`获取评论失败: ${source.name} ${e}`);
      return null;
    }
  }

  // ==================== 获取封面 ====================

  async getCover(source: PluginSource, item: PluginSearchResult): Promise<string | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    // 网易云检测与专辑接口兜底（与 pluginEngine.pluginGetCover 的 tryNeteaseAlbumCover 一致）
    // 网易云搜索只回超大整数 pic 而无 picUrl/pic_str 时，getMusicInfo 也常拿不到封面，走专辑接口最稳
    const rawItem = item.rawData || item;
    const neteaseSource =
      (source.sources && source.sources.includes('wy')) ||
      /网易云|netease/i.test(source.name || '') ||
      !!rawItem?.al?.id ||
      !!rawItem?.al?.picId_str ||
      !!rawItem?.al?.pic;
    const tryNeteaseAlbumCover = async (): Promise<string | null> => {
      if (!neteaseSource) return null;
      const raw = item.rawData || item;
      const albumId = raw?.al?.id ?? raw?.album?.id ?? raw?.albumId;
      const songmid = String(item.platformId || raw?.id || raw?.songmid || '');
      if (!albumId || !songmid) return null;
      try {
        const cover = await pluginApi.getLxCover({
          songmid,
          source: 'wy',
          albumId: String(albumId),
          name: item.title,
          singer: item.artist,
          albumName: item.album,
        });
        // 升级 https：avoid http 封面被 WebView2 混合内容拦截、或被前端 needsProxy 误判走后端代理而失败
        return (cover && String(cover).replace(/^http:\/\//i, 'https://')) || null;
      } catch {
        return null;
      }
    };

    try {
      if (typeof inst.getMusicInfo === 'function') {
        const musicItem = item.rawData
          ? resetMediaItem(item.rawData, source.name)
          : resetMediaItem(item, source.name);
        const result = await inst.getMusicInfo(musicItem);
        // getMusicInfo 返回的时长补全到 item（搜索结果常缺 duration）
        if (result && !item.duration) {
          const dur = extractDurationMs(result);
          if (dur) item.duration = dur;
        }
        const coverUrl = extractCoverUrl(result);
        if (coverUrl) return coverUrl;
      }
      // getMusicInfo 无封面时，网易云走专辑接口兜底（song/detail 常被限流）
      const albumCover = await tryNeteaseAlbumCover();
      if (albumCover) return albumCover;
      return item.coverUrl || null;
    } catch {
      const albumCover = await tryNeteaseAlbumCover();
      if (albumCover) return albumCover;
      return item.coverUrl || null;
    }
  }

  // ==================== 获取歌曲详情页 URL ====================

  /**
   * 获取歌曲分享/详情页 URL（对齐 BakaMusic getMusicDetailPageUrl）
   */
  async getMusicDetailPageUrl(source: PluginSource, item: PluginSearchResult): Promise<string | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicDetailPageUrl !== 'function') return null;
      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);
      const result = await inst.getMusicDetailPageUrl(musicItem);
      return typeof result === 'string' ? result : (result?.url || null);
    } catch {
      return null;
    }
  }
}