import { describe, expect, it } from 'vitest';
import { extractDurationMs, toPluginSearchResult } from './pluginResultMappers';

// 模拟 Baka 插件 formatMusicItem 的真实输出
const neteaseSong = {
  id: '123',
  artwork: 'https://p1.music.126.net/x.jpg',
  title: '晴天',
  artist: '周杰伦',
  singerList: [{ id: 1, name: '周杰伦' }],
  album: '叶惠美',
  albumId: 1,
  duration: 269,
  url: 'https://share.duanx.cn/url/wy/123/128k',
  qualities: { '128k': { bitrate: 128000 } },
};

const qqSong = {
  id: '456',
  title: '七里香',
  artist: '周杰伦',
  album: '七里香',
  duration: 269,
  qualities: {},
};

const kuwoSong = {
  id: '789',
  title: '稻香',
  artist: '周杰伦',
  album: '魔杰座',
  duration: 223,
  qualities: {},
};

describe('tmp duration check', () => {
  it('extracts netease artist/album/playlist song duration', () => {
    expect(extractDurationMs(neteaseSong)).toBe(269000);
  });
  it('extracts qq song duration', () => {
    expect(extractDurationMs(qqSong)).toBe(269000);
  });
  it('extracts kuwo song duration', () => {
    expect(extractDurationMs(kuwoSong)).toBe(223000);
  });
  it('toPluginSearchResult keeps duration', () => {
    const source = { id: 'p1', name: '网易云', format: 'musicfree' } as any;
    const r = toPluginSearchResult(neteaseSong, source);
    expect(r.duration).toBe(269000);
  });
});
