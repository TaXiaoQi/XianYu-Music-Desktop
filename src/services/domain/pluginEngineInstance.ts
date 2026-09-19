import {
  BUILTIN_PLUGINS,
  MAX_PLUGIN_SIZE,
  USE_SANDBOX,
  _sandboxedPlugins,
  bumpPluginsVersion,
  createSandboxProxy,
  getPluginUserVariableValues,
  log,
  normalizePluginUserVariables,
  pluginInstanceErrors,
  pluginInstances,
  userVarDefsCache,
  type PluginInstance,
} from './pluginEngineBase';
import {
  destroySandbox,
  linkSandboxAlias,
  setUserVarsProvider,
  loadMusicFreeInSandbox,
} from './pluginSandboxManager';
import { isLxPluginScript, loadLxPluginFromScript } from './lxPluginEngine';
import { isAnimePluginScript, loadAnimePluginFromScript } from './animePluginEngine';
import { hostSha256Hex } from '../tauri/hostCryptoApi';
import { pluginApi } from '../tauri/pluginApi';
import { fetchWithTimeout } from './pluginFetch';
import { BakaPluginManager } from './bakaPluginManager';

// ==================== 插件加载（与 MusicFree Plugin.mountPlugin() 完全一致）====================

export async function loadPluginFromScript(
  script: string,
  uri: string,
  userVarsPluginId?: string,
): Promise<import('../../types').PluginSource | null> {
  try {
    const bytes = new TextEncoder().encode(script);
    if (bytes.length > MAX_PLUGIN_SIZE) {
      throw new Error(`插件大小不能超过 2MB (当前: ${bytes.length} bytes)`);
    }
    if (script.trim().length === 0) {
      throw new Error('插件内容为空');
    }

    // ===== Step 0: 格式检测 - 落雪 LX 插件委托给 lxPluginEngine =====
    if (isLxPluginScript(script)) {
      log(`检测到落雪 LX 插件格式，委托给 lxPluginEngine`);
      const lxSource = await loadLxPluginFromScript(script, uri);
      if (lxSource) return lxSource;
      throw new Error('落雪 LX 插件加载失败，请检查插件是否兼容');
    }

    // ===== Step 0.5: 格式检测 - anime (animemusic/1) 插件委托给 animePluginEngine =====
    if (isAnimePluginScript(script)) {
      log(`检测到 anime (animemusic/1) 插件格式，委托给 animePluginEngine`);
      return await loadAnimePluginFromScript(script, uri, userVarsPluginId);
    }

    log(`=== 开始加载插件: ${uri} (${script.length} chars) ===`);

    const hash = await hostSha256Hex(script);

    // ===== 沙箱模式：在 Web Worker 中隔离执行插件脚本 =====
    if (USE_SANDBOX) {
      log(`[loadPluginFromScript] 沙箱模式加载: ${uri}`);
      try {
        setUserVarsProvider((pluginId: string) => getPluginUserVariableValues(pluginId));

        const userVars = getPluginUserVariableValues(userVarsPluginId || hash);
        const userVarKeys = Object.keys(userVars);
        log(`[loadPluginFromScript] hash=${hash.substring(0, 16)}... userVarsPluginId=${(userVarsPluginId || hash).substring(0, 16)}... userVars keys=[${userVarKeys.join(',')}] count=${userVarKeys.length}`);
        const metadata = await loadMusicFreeInSandbox(hash, script, userVars);

        if (!metadata?.platform) {
          throw new Error('沙箱: 插件缺少 platform 字段');
        }

        const declaredVars = normalizePluginUserVariables(metadata.userVariables);
        if (declaredVars.length > 0) {
          log(`[loadPluginFromScript] 插件 "${metadata.platform}" 声明 userVariables: ${declaredVars.map(v => `name=${v.name} type=${v.type || 'text'}`).join(', ')}`);
        } else {
          log(`[loadPluginFromScript] 插件 "${metadata.platform}" 未声明 userVariables`);
        }

        const proxyInstance = createSandboxProxy(hash, metadata);

        const source: import('../../types').PluginSource = {
          id: hash,
          name: metadata.platform,
          format: 'musicfree',
          version: metadata.version || '',
          author: metadata.author || '',
          description: metadata.description || '',
          filePath: uri,
          importedAt: Date.now(),
          enabled: true,
          sources: [metadata.platform],
        };

        pluginInstances.set(hash, { source, instance: proxyInstance, script });
        _sandboxedPlugins.add(hash);

        const userVariables = normalizePluginUserVariables(metadata.userVariables);
        if (userVariables.length > 0) {
          userVarDefsCache.set(hash, userVariables);
        }

        log(`=== 插件沙箱加载成功: "${metadata.platform}" ===`);
        return source;
      } catch (e: any) {
        log(`[loadPluginFromScript] 沙箱加载失败，已阻止回退到主线程直接执行: ${e?.message}`);
        throw e;
      }
    }

    throw new Error('插件沙箱未启用，已拒绝在主线程直接执行插件源码');
  } catch (e: any) {
    log(`[loadPluginFromScript] 插件加载失败 (uri=${uri}): ${e?.message || e}`);
    return null;
  }
}

// ==================== 实例加载（懒加载缓存 + 并发保护） ====================

const pendingPluginInstances = new Map<string, Promise<PluginInstance | null>>();

export async function ensurePluginInstance(source: import('../../types').PluginSource): Promise<PluginInstance | null> {
  const inst = pluginInstances.get(source.id);
  if (inst) {
    pluginInstanceErrors.delete(source.id);
    return inst;
  }

  const pending = pendingPluginInstances.get(source.id);
  if (pending) return pending;

  const promise = loadPluginInstance(source);
  pendingPluginInstances.set(source.id, promise);
  try {
    return await promise;
  } finally {
    pendingPluginInstances.delete(source.id);
  }
}

async function loadPluginInstance(source: import('../../types').PluginSource): Promise<PluginInstance | null> {
  log(`插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);

  try {
    let script = '';
    let readError = '';
    if (source.filePath.startsWith('builtin://')) {
      const webPath = BUILTIN_PLUGINS[source.filePath];
      if (webPath) {
        const resp = await fetchWithTimeout(webPath, 5000);
        if (resp.ok) script = await resp.text();
      }
    } else if (source.filePath.startsWith('http')) {
      const resp = await fetchWithTimeout(source.filePath, 10000);
      if (resp.ok) script = await resp.text();
      else readError = `插件地址返回 HTTP ${resp.status}`;
      if (!script) {
        try {
          script = await pluginApi.fetchPluginUrl(source.filePath);
        } catch (error) {
          readError = `无法下载插件脚本：${String(error)}`;
        }
      }
    } else if (source.filePath) {
      try {
        script = await pluginApi.readPluginFile(source.filePath);
        log(`[ensurePluginInstance] ${source.name} 读取脚本成功: ${script.length} chars`);
      } catch (error) {
        readError = `无法读取插件文件：${String(error)}`;
        log(`[ensurePluginInstance] ${source.name} 读取脚本失败: ${readError}`);
      }
    } else {
      readError = '插件 filePath 为空';
    }

    if (script) {
      const loadedSource = await loadPluginFromScript(script, source.filePath, source.id);
      if (!loadedSource) {
        readError = '插件脚本执行失败或缺少 platform 字段，请查看插件日志';
        log(`[ensurePluginInstance] ${source.name} loadPluginFromScript 返回 null`);
      } else {
        log(`[ensurePluginInstance] ${source.name} loadPluginFromScript 成功: loadedId=${loadedSource.id.substring(0, 16)}... sourceId=${source.id.substring(0, 16)}... match=${loadedSource.id === source.id}`);
        if (loadedSource.format === 'anime') {
          // anime 适配器是主线程实例（hash === source.id），加载时已注册，不能再用沙箱代理包装
          const animeEntry = pluginInstances.get(source.id) || null;
          if (animeEntry) {
            pluginInstanceErrors.delete(source.id);
            log(`[ensurePluginInstance] ${source.name} anime 实例已就绪（无代理包装）`);
            return animeEntry;
          }
        }
        const entry = pluginInstances.get(loadedSource.id);
        if (entry) {
          linkSandboxAlias(source.id, loadedSource.id);
          const availableMethods = Object.keys(entry.instance)
            .filter(key => typeof (entry.instance as any)[key] === 'function');
          const sourceProxy = createSandboxProxy(source.id, {
            ...entry.instance,
            _availableMethods: availableMethods,
          });
          pluginInstances.set(source.id, {
            source,
            instance: sourceProxy,
            script: entry.script,
          });
          log(`[ensurePluginInstance] ${source.name} 已缓存实例到 source.id，并映射沙箱别名`);
        } else {
          log(`[ensurePluginInstance] ${source.name} 警告: loadedSource.id 在 pluginInstances 中未找到`);
        }
      }
      if (!pluginInstances.has(source.id)) {
        for (const [key, entry] of pluginInstances) {
          if (entry.source.filePath === source.filePath && key !== source.id) {
            linkSandboxAlias(source.id, key);
            const availableMethods = Object.keys(entry.instance)
              .filter(methodName => typeof (entry.instance as any)[methodName] === 'function');
            const sourceProxy = createSandboxProxy(source.id, {
              ...entry.instance,
              _availableMethods: availableMethods,
            });
            pluginInstances.set(source.id, {
              source,
              instance: sourceProxy,
              script: entry.script,
            });
            log(`[ensurePluginInstance] ${source.name} 回退匹配成功: key=${key.substring(0, 16)}...`);
            break;
          }
        }
      }
    } else {
      log(`[ensurePluginInstance] ${source.name} 脚本为空，readError=${readError}`);
    }

    const resolved = pluginInstances.get(source.id) || null;
    if (resolved) {
      pluginInstanceErrors.delete(source.id);
      log(`[ensurePluginInstance] ${source.name} 最终: 实例已就绪`);
    } else {
      pluginInstanceErrors.set(source.id, readError || '插件脚本为空或实例未注册');
      log(`[ensurePluginInstance] ${source.name} 最终: 实例为 null, error=${readError}`);
    }
    return resolved;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log(`[ensurePluginInstance] ${source.name} 重新加载异常: ${message}`);
    pluginInstanceErrors.set(source.id, `插件初始化异常：${message}`);
    return null;
  }
}

export function reloadPluginInstance(pluginId: string) {
  BakaPluginManager.clearMediaSourceCache(pluginId);
  if (_sandboxedPlugins.has(pluginId)) {
    _sandboxedPlugins.delete(pluginId);
    destroySandbox(pluginId).catch(() => {});
  }
  pluginInstances.delete(pluginId);
  bumpPluginsVersion();
}

// ==================== 最近插件错误 ====================

export function getLastPluginError(): string {
  return String((globalThis as any).__lastPluginError || '').trim();
}

// ==================== 可播能力判定 ====================

export async function canPlayMusic(source: import('../../types').PluginSource): Promise<boolean> {
  if (!source.enabled) return false;
  try {
    if (source.format === 'lx') {
      return (source.sources?.length ?? 0) > 0;
    }
    const inst = await ensurePluginInstance(source);
    if (!inst?.instance) return false;
    const fn = inst.instance as unknown as Record<string, unknown>;
    if (typeof fn.getMediaSource === 'function') return true;
    const meta = (inst.instance as unknown as { _availableMethods?: unknown })._availableMethods;
    return Array.isArray(meta) && meta.includes('getMediaSource');
  } catch {
    return false;
  }
}