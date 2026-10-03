import { computed, ref, watch } from 'vue';
import {
  LX_SOURCE_NAMES,
  type LxSourceId,
} from '../../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginsVersion } from '../../services/domain/pluginEngine';
import type { PluginSource } from '../../types';

// ==================== 来源列表（从插件加载，无插件则索引本地）====================
export type SourceItem = {
  id: string;
  name: string;
  type: 'musicfree' | 'anime' | 'lx' | 'local';
  source?: PluginSource;
  lxSourceId?: LxSourceId;
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

  const allSourceList = computed<SourceItem[]>(() => {
    if (pluginSourceList.value.length === 0) {
      return [{ id: 'local', name: '本地', type: 'local' }];
    }
    return pluginSourceList.value;
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
    const stillExists = allSourceList.value.some(s => s.id === prevSelectedId);
    if (!stillExists && allSourceList.value.length > 0) {
      selectedSourceId.value = allSourceList.value[0].id;
    }
  });

  return {
    pluginSourceList,
    allSourceList,
    selectedSourceId,
    selectedSourceItem,
    selectedSourceName,
    isLocalSource,
    refreshPluginSourceList,
    handleSelectSource,
  };
}
