import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../tauri/pluginApi', () => ({
  pluginApi: {
    pluginHttpRequest: vi.fn(),
  },
}));

import { pluginApi } from '../tauri/pluginApi';
import { normalizeQualityKey } from '../../types';
import { searchQs } from './lxSearchQs';

const mockedHttp = vi.mocked(pluginApi.pluginHttpRequest);

// 与 Rust qs.rs 测试同款 fixture：汽水综合搜索 tracks 分组条目
const QS_TRACK = {
  id: '7157130433749059585',
  name: '晴天',
  duration: 238098,
  artists: [{ name: '周杰伦' }, { name: '周小伦' }],
  album: {
    id: '7157130433149274113',
    name: '叶惠美',
    url_cover: {
      uri: 'tos-cn-v-2774c002/abc',
      urls: ['https://p3-luna.douyinpic.com/img/'],
      template_prefix: 'tplv-b829550vbb',
    },
  },
  bit_rates: [
    { br: 66135, size: 1968355, quality: 'medium' },
    { br: 132203, size: 3934689, quality: 'higher' },
    { br: 260239, size: 7745354, quality: 'highest' },
    { br: 971164, size: 28904158, quality: 'lossless' },
    { br: 324229, size: 9650744, quality: 'spatial' },
    { br: 283951, size: 8451542, quality: 'hi_res' },
  ],
};

const jsonResponse = (data: any) => ({
  status: 200,
  body: JSON.stringify(data),
  headers: {},
});

const qsResponse = (tracks: any[]) => jsonResponse({
  result_groups: [
    { id: 'playlists', data: [{ meta: { item_type: 'playlist' } }] },
    { id: 'tracks', data: tracks.map(t => ({ meta: { item_type: 'track' }, entity: { track: t } })) },
  ],
});

beforeEach(() => {
  mockedHttp.mockReset();
});

describe('searchQs（汽水综合搜索解析）', () => {
  it('解析 result_groups tracks 分组并映射 LX 字段（higher 档跳过）', async () => {
    mockedHttp
      .mockResolvedValueOnce(qsResponse([QS_TRACK]))
      .mockResolvedValue(qsResponse([]));

    const result = await searchQs('晴天', 1, 30);

    // 首窗命中后仍滚动一窗确认流耗尽（凑满 limit 前不提前停止）
    expect(mockedHttp).toHaveBeenCalledTimes(2);
    const [method, url, headers] = mockedHttp.mock.calls[0];
    expect(method).toBe('GET');
    expect(url).toContain('https://api.qishui.com/luna/pc/search/all?q=%E6%99%B4%E5%A4%A9');
    expect(url).toContain('cursor=0');
    expect(url).toContain('search_method=input');
    expect((headers as any)?.['User-Agent']).toBe('LunaPC/3.5.2(412998333)');

    expect(result.source).toBe('qs');
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      songmid: '7157130433749059585',
      name: '晴天',
      singer: '周杰伦、周小伦',
      albumName: '叶惠美',
      albumId: '7157130433149274113',
      source: 'qs',
      interval: '03:58',
    });
    expect(result.list[0].img).toBe('https://p3-luna.douyinpic.com/img/tos-cn-v-2774c002/abc~tplv-b829550vbb-resize:500:500.png');
    // higher(192k) 无 LX 对应被跳过，其余保持上游顺序
    expect(result.list[0].types.map(t => t.type)).toEqual(['128k', '320k', 'flac', 'spatial', 'hires']);
    expect(result.list[0].types[0].size).toBe('1.9MB');
    expect(result.list[0]._types.flac).toEqual({ size: '27.6MB' });
    // spatial 档可通过品质归一化（空间音频）
    expect(normalizeQualityKey('spatial')).toBe('spatial');
  });

  it('跳过无 id 条目，跨窗口按 songmid 去重', async () => {
    mockedHttp
      .mockResolvedValueOnce(qsResponse([{ id: '', name: 'x' }, QS_TRACK]))
      .mockResolvedValueOnce(qsResponse([QS_TRACK, { ...QS_TRACK, id: '7157130433749059586', name: '晴天2' }]))
      .mockResolvedValueOnce(qsResponse([]));

    const result = await searchQs('晴天', 1, 30);

    expect(mockedHttp).toHaveBeenCalledTimes(3);
    expect(result.list.map(t => t.songmid)).toEqual(['7157130433749059585', '7157130433749059586']);
  });

  it('首页空结果抛错；翻页空结果返回空列表', async () => {
    mockedHttp.mockResolvedValue(qsResponse([]));
    await expect(searchQs('晴天', 1, 30)).rejects.toThrow('QS search: no results');

    mockedHttp.mockResolvedValue(qsResponse([]));
    const empty = await searchQs('晴天', 2, 30);
    expect(empty.list).toEqual([]);
    expect(empty.source).toBe('qs');
  });
});
