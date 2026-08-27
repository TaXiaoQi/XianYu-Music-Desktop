/**
 * 插件引擎 · 实例运行时（加载 / 懒加载缓存 / 重载）。
 *
 * 负责把插件源码（MusicFree/LX）加载为可调用的 IPluginInstance，并维护
 * pluginInstances 内存缓存、错误记录与并发加载保护。被搜索、目录、媒体、
 * 存储等插件引擎子模块共享。仅依赖 pluginEngineBase 与外部工具模块。
 */
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
      // [修复防御]: 落雪插件无法以 MusicFree 格式运行（完全不同的 API 协议）
      throw new Error('落雪 LX 插件加载失败，请检查插件是否兼容');
    }

    log(`=== 开始加载插件: ${uri} (${script.length} chars) ===`);

    // 预计算 hash，用于 env.getUserVariables() 按插件 ID 索引用户变量值。
    // 提前到 Step 1 之前，确保插件脚本执行期间调用 getUserVariables() 也能拿到值。
    const hash = await hostSha256Hex(script);

    // ===== 沙箱模式：在 Web Worker 中隔离执行插件脚本 =====
    if (USE_SANDBOX) {
      log(`[loadPluginFromScript] 沙箱模式加载: ${uri}`);
      try {
        // 注册用户变量提供器（供 Worker 通过 RPC 获取用户变量）
        setUserVarsProvider((pluginId: string) => getPluginUserVariableValues(pluginId));

        const userVars = getPluginUserVariableValues(userVarsPluginId || hash);
        const userVarKeys = Object.keys(userVars);
        log(`[loadPluginFromScript] hash=${hash.substring(0, 16)}... userVarsPluginId=${(userVarsPluginId || hash).substring(0, 16)}... userVars keys=[${userVarKeys.join(',')}] count=${userVarKeys.length}`);
        const metadata = await loadMusicFreeInSandbox(hash, script, userVars);

        if (!metadata?.platform) {
          throw new Error('沙箱: 插件缺少 platform 字段');
        }

        // [诊断] 记录插件声明的 userVariables 定义
        const declaredVars = normalizePluginUserVariables(metadata.userVariables);
        if (declaredVars.length > 0) {
          log(`[loadPluginFromScript] 插件 "${metadata.platform}" 声明 userVariables: ${declaredVars.map(v => `name=${v.name} type=${v.type || 'text'}`).join(', ')}`);
        } else {
          log(`[loadPluginFromScript] 插件 "${metadata.platform}" 未声明 userVariables`);
        }

        // 创建代理实例（所有方法调用通过 RPC 转发到 Worker）
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

// 正在加载中的插件实例 Promise 缓存，避免并发加载同一插件时互相销毁沙箱导致加载失败
const pendingPluginInstances = new Map<string, Promise<PluginInstance | null>>();

/**
 * 确保插件实例已加载到内存中
 */
export async function ensurePluginInstance(source: import('../../types').PluginSource): Promise<PluginInstance | null> {
  const inst = pluginInstances.get(source.id);
  if (inst) {
    pluginInstanceErrors.delete(source.id);
    return inst;
  }

  // 并发保护：同一插件正在加载时共享同一个 Promise，避免重复加载互相干扰
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
      // [修复防御]: 远程 URL 先尝试浏览器 fetch，失败则回退 Tauri 后端（绕过 CORS）
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
        // [修复] 直接用 source.id 缓存实例，不依赖 SHA256 hash 匹配
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
      // 回退: 遍历找到 filePath 匹配的条目
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

/**
 * 用户变量变更后重新加载插件实例，使新值通过 env.getUserVariables() 生效。
 * 清除缓存后下次 ensurePluginInstance 会重新执行插件脚本。
 */
export function reloadPluginInstance(pluginId: string) {
  // 用户变量或插件实例变化后，清理 Baka 短时直链缓存，避免继续复用旧 key 解析出来的 URL。
  BakaPluginManager.clearMediaSourceCache(pluginId);
  // 沙箱模式清理：销毁 Worker，下次加载时重新创建
  if (_sandboxedPlugins.has(pluginId)) {
    _sandboxedPlugins.delete(pluginId);
    destroySandbox(pluginId).catch(() => {});
  }
  pluginInstances.delete(pluginId);
  // 不清除 userVarDefsCache：用户变量定义不因值变更而改变，
  // 重新加载后 ensurePluginInstance 会自动刷新缓存
  bumpPluginsVersion();
}

// ==================== 最近插件错误 ====================

export function getLastPluginError(): string {
  return String((globalThis as any).__lastPluginError || '').trim();
}