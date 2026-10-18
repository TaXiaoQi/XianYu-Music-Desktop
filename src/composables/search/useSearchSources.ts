import { computed, onScopeDispose, ref, watch } from 'vue';
import {
  LX_SOURCE_NAMES,
  type LxSourceId,
} from '../../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginsVersion } from '../../services/domain/pluginEngine';
import { cloudProviders } from '../../services/cloud/cloudRegistry';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
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

  // ==================== 网盘来源（已绑定账号的盘，没选目录默认全部目录）====================
  const cloudSourceList = ref<SourceItem[]>([]);
  let cloudRefreshVersion = 0;

  async function refreshCloudSourceList() {
    const version = ++cloudRefreshVersion;
    const items: SourceItem[] = [];
    for (const p of cloudProviders) {
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
    const base: SourceItem[] = [
      { id: 'local', name: '本地', type: 'local' },
      ...pluginSourceList.value,
    ];
    return [...base, ...cloudSourceList.value];
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
