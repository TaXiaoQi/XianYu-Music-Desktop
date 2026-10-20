import { computed, onScopeDispose, ref, watch } from 'vue';
import {
  LX_SOURCE_NAMES,
  type LxSourceId,
} from '../../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginsVersion } from '../../services/domain/pluginEngine';
import { cloudProviders } from '../../services/cloud/cloudRegistry';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import { useSettings } from '../../features/settings/useSettings';
import type { PluginSource } from '../../types';

// ==================== 来源列表（从插件加载，无插件则索引本地）====================
export type SourceItem = {
  id: string;
  name: string;
  type: 'musicfree' | 'anime' | 'lx' | 'local' | 'cloud';
  source?: PluginSource;
  lxSourceId?: LxSourceId;
  /** type === 'cloud' 时的网盘注册 id（cloudRegistry 一致） */
  cloudProviderId?: string;
};

export type SearchSources = ReturnType<typeof useSearchSources>;

export function useSearchSources() {
  const pluginSourceList = ref<SourceItem[]>([]);
  const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

  function refreshPluginSourceList() {
    const raw = getStoredPlugins();
    const plugins = raw
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.enabled)
      .sort((a, b) => {
        const sa = a.p.sortOrder ?? 0;
        const sb = b.p.sortOrder ?? 0;
        if (sa !== sb) return sa - sb;
        return a.idx - b.idx;
      })
      .map(({ p }) => p);
    const items: SourceItem[] = [];
    for (const p of plugins) {
      if (p.format === 'musicfree') {
        items.push({ id: p.id, name: p.name, type: 'musicfree', source: p });
      } else if (p.format === 'anime') {
        items.push({ id: p.id, name: p.name, type: 'anime', source: p });
      } else if (p.format === 'lx' && p.sources.length > 0) {
        const lxSources = p.sources.filter(s => VALID_LX_SOURCES.has(s)) as LxSourceId[];
        if (lxSources.length === 0) continue;

        if (lxSources.length === 1) {
          items.push({ id: p.id, name: p.name, type: 'lx', source: p, lxSourceId: lxSources[0] });
        } else {
          for (const sourceId of lxSources) {
            items.push({
              id: `${p.id}__${sourceId}`,
              name: LX_SOURCE_NAMES[sourceId],
              type: 'lx',
              source: p,
              lxSourceId: sourceId,
            });
          }
        }
      }
    }
    pluginSourceList.value = items;
  }

  // ==================== 网盘来源（每个已绑定网盘一个来源，没选目录默认全部目录）====================
  // 网盘音源开关（音源管理页，按网盘独立）：关闭后不展示、不再拉取该网盘来源
  const { settings } = useSettings();
  const cloudSourceOverrides = computed(() => settings.value.plugins.cloudSources);
  const cloudSourceEnabledFor = (providerId: string) =>
    cloudSourceOverrides.value[providerId]?.enabled !== false;
  const cloudSortIndexFor = (providerId: string) =>
    cloudSourceOverrides.value[providerId]?.sortIndex ?? null;

  const cloudSourceList = ref<SourceItem[]>([]);
  let cloudRefreshVersion = 0;

  async function refreshCloudSourceList() {
    const version = ++cloudRefreshVersion;
    const items: SourceItem[] = [];
    for (const p of cloudProviders) {
      if (!cloudSourceEnabledFor(p.id)) continue;
      const accounts = await CloudCredentialsStore.instance.accountsFor(p.id);
      if (version !== cloudRefreshVersion) return;
      // 未绑定账号的盘不展示；同盘多账号只显示一个来源（搜索时取第一个账号）
      if (accounts.length === 0) continue;
      items.push({
        id: `cloud:${p.id}`,
        name: p.displayName,
        type: 'cloud',
        cloudProviderId: p.id,
      });
    }
    cloudSourceList.value = items;
  }

  const allSourceList = computed<SourceItem[]>(() => {
    // 本地来源恒在首位（与移动端一致）：有插件/网盘等网页来源时也保留本地搜索
    const out: SourceItem[] = [{ id: 'local', name: '本地', type: 'local' }];
    // 网盘排序位 = 前方插件数（音源管理页拖拽落点）；null=固定末尾。
    // 同位多个网盘保持注册顺序：cloud 插在第一个 sortOrder >= idx 的插件之前
    const clouds = [...cloudSourceList.value].sort((a, b) => {
      const ia = cloudSortIndexFor(a.cloudProviderId!) ?? Number.MAX_SAFE_INTEGER;
      const ib = cloudSortIndexFor(b.cloudProviderId!) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });
    let ci = 0;
    for (const p of pluginSourceList.value) {
      const pIdx = p.source?.sortOrder ?? 0;
      while (ci < clouds.length) {
        const cIdx = cloudSortIndexFor(clouds[ci].cloudProviderId!);
        if (cIdx == null || cIdx > pIdx) break;
        out.push(clouds[ci++]);
      }
      out.push(p);
    }
    while (ci < clouds.length) out.push(clouds[ci++]);
    return out;
  });
  const selectedSourceId = ref<string>('');

  const selectedSourceItem = computed(() =>
    allSourceList.value.find(s => s.id === selectedSourceId.value),
  );

  const selectedSourceName = computed(() =>
    selectedSourceItem.value?.name ?? '未知音源',
  );

  const isLocalSource = computed(() => selectedSourceItem.value?.type === 'local');

  const handleSelectSource = (source: SourceItem) => {
    selectedSourceId.value = source.id;
  };

  watch(pluginsVersion, () => {
    const prevSelectedId = selectedSourceId.value;
    refreshPluginSourceList();
    void refreshCloudSourceList();
    const stillExists = allSourceList.value.some(s => s.id === prevSelectedId);
    if (!stillExists && allSourceList.value.length > 0) {
      selectedSourceId.value = allSourceList.value[0].id;
    }
  });

  // 网盘开关/绑定变化：重建来源列表，若当前选中的网盘来源被移除则回退到第一个来源
  watch(cloudSourceOverrides, () => {
    const prevSelectedId = selectedSourceId.value;
    void refreshCloudSourceList();
    const stillExists = allSourceList.value.some(s => s.id === prevSelectedId);
    if (!stillExists && allSourceList.value.length > 0) {
      selectedSourceId.value = allSourceList.value[0].id;
    }
  }, { deep: true });

  // 凭据落盘即刷新网盘来源（登录同步后台导入绑定后，已打开的搜索页跟随）
  const unsubCreds = CloudCredentialsStore.instance.subscribe(() => {
    void refreshCloudSourceList();
  });
  onScopeDispose(unsubCreds);

  return {
    pluginSourceList,
    cloudSourceList,
    allSourceList,
    selectedSourceId,
    selectedSourceItem,
    selectedSourceName,
    isLocalSource,
    refreshPluginSourceList,
    refreshCloudSourceList,
    handleSelectSource,
  };
}
