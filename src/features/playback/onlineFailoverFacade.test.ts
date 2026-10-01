import { describe, expect, it, vi } from 'vitest';

import type { PluginSource, Song } from '../../types';
import {
  findAlternativeOnlineSource,
  findSiblingPluginCandidate,
  getFailedOnlineSource,
  resolvePluginPlatformLabel,
} from './onlineFailoverFacade';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'plugin://QQ音乐/123',
  cue_source_path: '',
  name: 'Demo',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

const plugin = (overrides: Partial<PluginSource> = {}): PluginSource => ({
  id: 'plugin-1',
  name: 'QQ音乐',
  format: 'musicfree',
  version: '1.0.0',
  enabled: true,
  sources: ['qq'],
  ...overrides,
});

describe('online failover facade', () => {
  it('resolves the plugin platform from raw data, path, and stored metadata', () => {
    expect(resolvePluginPlatformLabel(makeSong({ rawData: { platform: '酷狗音乐' } }))).toBe('酷狗音乐');
    expect(resolvePluginPlatformLabel(makeSong({ path: 'plugin://网易云音乐/123', rawData: {} }))).toBe('网易云音乐');
    expect(resolvePluginPlatformLabel(makeSong({ path: 'plugin:///123', rawData: { pluginId: 'plugin-1' } }), {
      getStoredPlugins: () => [plugin()],
    })).toBe('QQ音乐');
  });

  it('derives a stable failed source for LX and plugin songs', () => {
    expect(getFailedOnlineSource(makeSong({ path: 'lx://wy/123' }))).toBe('wy');
    expect(getFailedOnlineSource(makeSong({ path: 'plugin://QQ音乐/123' }), {
      getStoredPlugins: () => [],
      describePlatform: () => ({ lxSource: 'qq' } as ReturnType<typeof import('../../services/domain/pluginBackupSong').describePlatform>),
    })).toBe('qq');
  });

  it('returns an enabled sibling plugin and excludes tried plugins', () => {
    const current = plugin({ id: 'current' });
    const sibling = plugin({ id: 'sibling', name: 'QQ音乐备用' });
    const findMatching = vi.fn().mockReturnValue(sibling);
    const tried = new Set<string>();

    expect(findSiblingPluginCandidate(
      makeSong({ rawData: { pluginId: current.id, platform: 'QQ音乐' } }),
      tried,
      {
        getStoredPlugins: () => [current, sibling],
        describePlatform: () => ({ canonical: 'qq' } as ReturnType<typeof import('../../services/domain/pluginBackupSong').describePlatform>),
        findMatchingPlugin: findMatching,
      },
    )).toEqual({ pluginId: 'sibling', pluginName: 'QQ音乐备用' });
    expect(tried).toContain('current');
    expect(findMatching).toHaveBeenCalled();
  });

  it('returns an alternative source result and swallows lookup failures', async () => {
    const alternativeSong = makeSong({ path: 'lx://wy/456' });
    const getAlternative = vi.fn().mockResolvedValue(alternativeSong);
    await expect(findAlternativeOnlineSource(makeSong(), new Set(['qq']), {
      findAlternativeLxSource: getAlternative,
      getLxSourceDisplayName: (source: string) => source.toUpperCase(),
    })).resolves.toEqual({
      song: alternativeSong,
      source: 'wy',
      displayName: 'WY',
    });

    await expect(findAlternativeOnlineSource(makeSong(), new Set(), {
      findAlternativeLxSource: vi.fn().mockRejectedValue(new Error('failed')),
      getLxSourceDisplayName: vi.fn(),
    })).resolves.toBeNull();
  });
});
