import type { PluginSource, Song } from '../../types';
import { getStoredPlugins } from '../../services/domain/pluginEngine';
import { describePlatform, findMatchingPlugin } from '../../services/domain/pluginBackupSong';
import {
  findAlternativeLxSource,
  getLxSourceDisplayName,
} from '../../services/domain/lxSourceFallback';

interface OnlineFailoverDeps {
  getStoredPlugins: () => PluginSource[];
  describePlatform: typeof describePlatform;
  findMatchingPlugin: typeof findMatchingPlugin;
  findAlternativeLxSource: typeof findAlternativeLxSource;
  getLxSourceDisplayName: typeof getLxSourceDisplayName;
}

const defaultDeps: OnlineFailoverDeps = {
  getStoredPlugins,
  describePlatform,
  findMatchingPlugin,
  findAlternativeLxSource,
  getLxSourceDisplayName,
};

export interface PluginPlaybackCandidate {
  pluginId: string;
  pluginName: string;
}

export interface AlternativeOnlineSource {
  song: Song;
  source: string;
  displayName: string;
}

function getPluginPathPlatform(song: Song): string {
  const segment = (song.cue_source_path || song.path || '').slice('plugin://'.length).split('/')[0] || '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function resolvePluginPlatformLabel(
  song: Song,
  deps: Pick<OnlineFailoverDeps, 'getStoredPlugins'> = defaultDeps,
): string {
  const searchResult = song.rawData as { pluginId?: string; platform?: string } | undefined;
  const platformLabel = searchResult?.platform?.trim() || getPluginPathPlatform(song).trim();
  if (platformLabel) return platformLabel;
  if (searchResult?.pluginId) {
    return deps.getStoredPlugins().find(plugin => plugin.id === searchResult.pluginId)?.name || '';
  }
  return '';
}

export function getFailedOnlineSource(
  song: Song,
  deps: Pick<OnlineFailoverDeps, 'getStoredPlugins' | 'describePlatform'> = defaultDeps,
): string {
  if (song.path.startsWith('lx://')) {
    return song.path.slice('lx://'.length).split('/')[0] || 'unknown';
  }
  return deps.describePlatform(resolvePluginPlatformLabel(song, deps)).lxSource ?? 'plugin';
}

export function findSiblingPluginCandidate(
  song: Song,
  triedPluginIds: Set<string>,
  deps: Pick<OnlineFailoverDeps, 'getStoredPlugins' | 'describePlatform' | 'findMatchingPlugin'> = defaultDeps,
): PluginPlaybackCandidate | null {
  try {
    const searchResult = song.rawData as { pluginId?: string; platform?: string } | undefined;
    if (!searchResult?.pluginId) return null;

    const platformLabel = resolvePluginPlatformLabel(song, deps);
    if (!platformLabel) return null;

    triedPluginIds.add(searchResult.pluginId);
    const candidates = deps.getStoredPlugins().filter(plugin => plugin.enabled && !triedPluginIds.has(plugin.id));
    const sibling = deps.findMatchingPlugin(deps.describePlatform(platformLabel), candidates, 'musicfree');
    return sibling ? { pluginId: sibling.id, pluginName: sibling.name } : null;
  } catch {
    return null;
  }
}

export async function findAlternativeOnlineSource(
  song: Song,
  failedSources: Set<string>,
  deps: Pick<OnlineFailoverDeps, 'findAlternativeLxSource' | 'getLxSourceDisplayName'> = defaultDeps,
): Promise<AlternativeOnlineSource | null> {
  try {
    const alternativeSong = await deps.findAlternativeLxSource(song, failedSources);
    if (!alternativeSong) return null;
    const source = alternativeSong.path.slice('lx://'.length).split('/')[0] || 'unknown';
    return {
      song: alternativeSong,
      source,
      displayName: deps.getLxSourceDisplayName(source),
    };
  } catch {
    return null;
  }
}
