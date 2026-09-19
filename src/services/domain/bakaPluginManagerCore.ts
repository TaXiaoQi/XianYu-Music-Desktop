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

export class BakaPluginCore {
  protected _bakaPluginCache = new Map<string, boolean>();
  protected _mediaSourceCache = new Map<string, MediaSourceCacheEntry>();
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

  async isBakaPlugin(source: PluginSource): Promise<boolean> {
    const author = (source.author || '').toLowerCase();

    if (author.includes('toskysun')) {
      this._bakaPluginCache.set(source.id, true);
      return true;
    }

    if (NON_BAKA_PLUGIN_AUTHORS.some(name => author.includes(name))) {
      this._bakaPluginCache.set(source.id, false);
      return false;
    }

    const cached = this._bakaPluginCache.get(source.id);
    if (cached === true) return true;
    if (cached === false && !isSandboxReady(source.id)) return false;

    const result = await this._detectBakaPlugin(source);
    this._bakaPluginCache.set(source.id, result);
    return result;
  }

  private async _detectBakaPlugin(source: PluginSource): Promise<boolean> {

    if (isSandboxReady(source.id)) {
      const meta = getSandboxInstance(source.id);
      if (hasCommentApi(meta)) return true;
      if (isBakaSupportedQualities(meta?.supportedQualities)) {
        return true;
      }
    }

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

  clearCache(pluginId?: string): void {
    if (pluginId) {
      this._bakaPluginCache.delete(pluginId);
    } else {
      this._bakaPluginCache.clear();
    }
  }

  // ==================== 音质管理 ====================

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

  protected async _ensureInstance(source: PluginSource): Promise<IBakaPluginInstance | null> {
    if (isSandboxReady(source.id)) {
      return this._createSandboxProxy(source.id);
    }

    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, { source: PluginSource; instance: any; script: string }> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (inst?.instance) {
        return inst.instance as IBakaPluginInstance;
      }
    }

    log(`插件实例未缓存，需要重新加载: ${source.name} (${source.filePath})`);
    return null;
  }

  protected _createSandboxProxy(pluginId: string): IBakaPluginInstance {
    const meta = getSandboxInstance(pluginId) || {};

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