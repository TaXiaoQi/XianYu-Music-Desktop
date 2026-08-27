/**
 * Baka 插件引擎 · 核心基类。
 *
 * 持有 BakaPluginManager 的状态字段（检测缓存、媒体源缓存与并发去重）、
 * 插件检测（isBakaPlugin）、音质查询（getSupportedQualities）、缓存清理，
 * 以及被媒体/目录 Mixin 复用的实例获取与沙箱代理创建。
 *
 * 仅依赖 bakaPluginManagerBase 与 pluginSandboxManager，供媒体/目录 Mixin
 * 继承混入，最终由 bakaPluginManager 门面组合并导出单例。
 */
import type { PluginSource, QualityKey, PluginMusicInfo } from '../../types';
import { normalizeQualityKey } from '../../types';
import {
  callSandboxMethod,
  isSandboxReady,
  getSandboxInstance,
} from './pluginSandboxManager';
import {
  log,
  BAKA_PLUGIN_METHODS,
  isBakaSupportedQualities,
  hasCommentApi,
  NON_BAKA_PLUGIN_AUTHORS,
  type IBakaPluginInstance,
  type MediaSourceCacheEntry,
} from './bakaPluginManagerBase';

/**
 * Baka 插件基类：共享状态与实例编排。
 * 字段与方法使用 protected，供媒体/目录 Mixin 混入后访问。
 */
export class BakaPluginCore {
  /** 已检测的 Baka 插件 ID 缓存 */
  protected _bakaPluginCache = new Map<string, boolean>();
  /** Baka 播放直链短时缓存 */
  protected _mediaSourceCache = new Map<string, MediaSourceCacheEntry>();
  /** 同一首歌同一音质的并发解析复用，避免重复请求音源接口 */
  protected _mediaSourcePending = new Map<string, Promise<PluginMusicInfo | null>>();

  clearMediaSourceCache(pluginId?: string) {
    if (!pluginId) {
      this._mediaSourceCache.clear();
      this._mediaSourcePending.clear();
      return;
    }
    const prefix = `${pluginId}|`;
    for (const key of this._mediaSourceCache.keys()) {
      if (key.startsWith(prefix)) this._mediaSourceCache.delete(key);
    }
    for (const key of this._mediaSourcePending.keys()) {
      if (key.startsWith(prefix)) this._mediaSourcePending.delete(key);
    }
  }

  // ==================== 插件检测 ====================

  /**
   * 检测插件是否为 Baka/Toskysun 系列
   *
   * Baka 插件在实例上声明 `supportedQualities` 数组字段（可为完整或部分新音质键）。
   * 原版 MusicFree 插件无此字段，或仅走 standard/high/lossless。
   */
  async isBakaPlugin(source: PluginSource): Promise<boolean> {
    // 作者名判定优先于能力检测：部分 MusicFree 插件（如时迁酱系列）也声明了
    // Baka 风格的 supportedQualities，仅凭能力检测会误判，因此以作者归属为准。
    const author = (source.author || '').toLowerCase();

    // Toskysun 是 BakaMusic 的开发者，作者名匹配则强制判定为 Baka。
    if (author.includes('toskysun')) {
      this._bakaPluginCache.set(source.id, true);
      return true;
    }

    // 已知的 MusicFree 插件作者：强制排除，不走能力检测（避免误判为 Baka）。
    if (NON_BAKA_PLUGIN_AUTHORS.some(name => author.includes(name))) {
      this._bakaPluginCache.set(source.id, false);
      return false;
    }

    const cached = this._bakaPluginCache.get(source.id);
    // true 可以稳定缓存；false 可能是插件尚未加载完成时的临时误判，
    // 因此在沙箱就绪后允许重新检测一次，避免 Baka/Toskysun 插件误走 MF 三档兼容路径。
    if (cached === true) return true;
    if (cached === false && !isSandboxReady(source.id)) return false;

    const result = await this._detectBakaPlugin(source);
    this._bakaPluginCache.set(source.id, result);
    return result;
  }

  private async _detectBakaPlugin(source: PluginSource): Promise<boolean> {
    // 注：Toskysun 作者名的判定已在 isBakaPlugin 入口处理，此处专注运行时能力检测。

    // 从沙箱元数据检测
    if (isSandboxReady(source.id)) {
      const meta = getSandboxInstance(source.id);
      // getMusicComments（评论区 API）是最可靠的 Baka 特征：
      // 原版 MusicFree 及时迁酱系列插件都不实现该方法。
      if (hasCommentApi(meta)) return true;
      if (isBakaSupportedQualities(meta?.supportedQualities)) {
        return true;
      }
    }

    // 从全局实例缓存检测
    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, any> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (hasCommentApi(inst?.instance)) return true;
      if (isBakaSupportedQualities(inst?.instance?.supportedQualities)) {
        return true;
      }
    }
    return false;
  }

  /** 清除插件检测缓存（插件更新/卸载时调用） */
  clearCache(pluginId?: string): void {
    if (pluginId) {
      this._bakaPluginCache.delete(pluginId);
    } else {
      this._bakaPluginCache.clear();
    }
  }

  // ==================== 音质管理 ====================

  /**
   * 获取插件声明的支持音质列表
   *
   * Baka 插件使用 12 档新键值（如 '320k'、'flac'、'master'）。
   * 映射 '96k' → 'mgg' 以对齐本项目的 QualityKey 枚举。
   */
  async getSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    const raw = inst.supportedQualities;
    if (Array.isArray(raw)) {
      const supported = raw
        .map(q => normalizeQualityKey(q))
        .filter((q): q is QualityKey => !!q);
      if (supported.length > 0) {
        return supported;
      }
    }
    return ['128k', '320k', 'flac'];
  }

  // ==================== 内部工具 ====================

  /**
   * 确保插件实例已加载，返回 Baka 插件实例接口
   *
   * 优先从沙箱获取（通过 RPC 代理），回退到全局实例缓存。
   */
  protected async _ensureInstance(source: PluginSource): Promise<IBakaPluginInstance | null> {
    // 尝试从沙箱获取代理实例
    if (isSandboxReady(source.id)) {
      return this._createSandboxProxy(source.id);
    }

    // 回退到全局实例缓存（直接执行模式）
    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, { source: PluginSource; instance: any; script: string }> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (inst?.instance) {
        return inst.instance as IBakaPluginInstance;
      }
    }

    // 触发重新加载（通过 pluginEngine 的 ensurePluginInstance）
    log(`插件实例未缓存，需要重新加载: ${source.name} (${source.filePath})`);
    return null;
  }

  /**
   * 创建沙箱代理实例
   *
   * 当插件在沙箱中运行时，通过 RPC 调用方法。
   * 代理对象包含所有 Baka 插件方法（16 个），
   * 只为实际实现的方法创建代理函数。
   */
  protected _createSandboxProxy(pluginId: string): IBakaPluginInstance {
    const meta = getSandboxInstance(pluginId) || {};

    // Worker 返回的 _availableMethods 包含插件实际实现的方法名列表
    const availableMethods: string[] = Array.isArray(meta._availableMethods)
      ? meta._availableMethods
      : [...BAKA_PLUGIN_METHODS];

    const proxy: any = {
      platform: meta.platform,
      version: meta.version,
      appVersion: meta.appVersion,
      srcUrl: meta.srcUrl,
      author: meta.author,
      description: meta.description,
      cacheControl: meta.cacheControl,
      primaryKey: meta.primaryKey,
      defaultSearchType: meta.defaultSearchType,
      supportedSearchType: meta.supportedSearchType,
      userVariables: meta.userVariables,
      hints: meta.hints,
      supportedQualities: meta.supportedQualities,
    };

    // 为所有 Baka 插件方法创建代理
    for (const method of BAKA_PLUGIN_METHODS) {
      if (availableMethods.includes(method)) {
        proxy[method] = async (...args: any[]) => {
          return callSandboxMethod(pluginId, method, args, method === 'getLyric' ? 8000 : 30000);
        };
      }
    }

    return proxy as IBakaPluginInstance;
  }
}