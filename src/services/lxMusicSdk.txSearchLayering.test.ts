import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./tauri/pluginApi', () => ({
  pluginApi: {
    pluginHttpRequest: vi.fn(),
  },
}));

vi.mock('./tauri/hostCryptoApi', () => ({
  hostZzcSign: vi.fn(async () => 'zzcmocksignmocksignmocksign123'),
  hostMiguSign: vi.fn(async () => ({ sign: 'mockmigusign', deviceId: '963B7AA0D21511ED807EE5846EC87D20' })),
  hostKugouSign: vi.fn(async () => 'mockkugousign'),
  hostLinuxapiEncrypt: vi.fn(async () => 'MOCKLINUXAPI'),
  hostWeapiEncrypt: vi.fn(async () => ({ params: 'mockparams', encSecKey: 'mockencseckey' })),
  hostSha256Hex: vi.fn(async () => 'mocksha256'),
}));

import { pluginApi } from './tauri/pluginApi';
import { lxSearch, txSearchAlbumsRaw } from './lxMusicSdk';

const mockedHttp = vi.mocked(pluginApi.pluginHttpRequest);

const DESKTOP_ITEM = {
  mid: '0039MnYb0qxYhV',
  id: 97773,
  title: '晴天',
  name: '晴天',
  singer: [{ id: 4558, mid: '0025NhlN2yWr6b', name: '周杰伦' }],
  album: { id: 16953, mid: '002Neh8l0RxIVZ', name: '叶惠美' },
  interval: 269,
  file: { media_mid: '0039MnYb0qxYhV', size_128mp3: 4309962, size_320mp3: 10805942, size_flac: 40493431 },
};

const MOBILE_ITEM = {
  songmid: '0039MnYb0qxYhV',
  songid: 97773,
  songname: '晴天',
  singer: [{ name: '周杰伦' }],
  albumname: '叶惠美',
  albumid: 16953,
  interval: 269,
  file: { size_320mp3: 10805942 },
};

const WEB_ITEM = {
  songmid: '0039MnYb0qxYhV',
  songid: 97773,
  songname: '晴天',
  singer: [{ name: '周杰伦' }],
  albumname: '叶惠美',
  albumid: 16953,
  interval: 269,
};

const jsonResponse = (data: any) => ({
  status: 200,
  body: JSON.stringify(data),
  headers: {},
});

const fcgResponse = (list: any[], method: string) => jsonResponse({
  code: 0,
  req: {
    code: 0,
    data: {
      body: { song: { list, totalnum: 100 } },
      meta: { estimate_sum: 100 },
      ...(method === 'DoSearchForQQMusicMobile' ? {} : {}),
    },
  },
});

const fcgRiskResponse = () => jsonResponse({
  code: 0,
  req: {
    code: 2001,
    data: { body: { item_song: [] } },
  },
});

type Router = (method: string, url: string, body?: string) => any;

const installRouter = (router: Router) => {
  mockedHttp.mockImplementation(async (method: string, url: string, _headers?: any, body?: any) => {
    const result = router(method, url, body);
    if (!result) throw new Error(`unexpected request: ${method} ${url}`);
    return result;
  });
};

const bodyMethod = (body?: string) => {
  try {
    return JSON.parse(body || '')?.req?.method as string | undefined;
  } catch {
    return undefined;
  }
};

beforeEach(() => {
  mockedHttp.mockReset();
});

describe('lxSearch tx 分层链路（Desktop 主 → Mobile 备 → Web 兜底）', () => {
  it('Desktop 命中时直接返回，不再请求 Mobile/Web', async () => {
    const calls: string[] = [];
    installRouter((method, url, body) => {
      const m = bodyMethod(body);
      calls.push(`${method}:${url.includes('client_search_cp') ? 'web' : m}`);
      if (url.includes('musics.fcg') && m === 'DoSearchForQQMusicDesktop') {
        return fcgResponse([DESKTOP_ITEM], m!);
      }
      return null;
    });

    const result = await lxSearch('tx', '晴天', 1, 30);

    expect(calls).toEqual(['POST:DoSearchForQQMusicDesktop']);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      songmid: '0039MnYb0qxYhV',
      songId: 97773,
      name: '晴天',
      singer: '周杰伦',
      albumName: '叶惠美',
      interval: '04:29',
    });
    expect(result.list[0].types.map(t => t.type)).toContain('320k');
    expect(result.list[0].img).toContain('T002R500x500M000002Neh8l0RxIVZ');
  });

  it('Desktop 被风控(2001)时降级 Mobile 并成功', async () => {
    const calls: string[] = [];
    installRouter((method, url, body) => {
      const m = bodyMethod(body);
      calls.push(`${method}:${m}`);
      if (m === 'DoSearchForQQMusicDesktop') return fcgRiskResponse();
      if (m === 'DoSearchForQQMusicMobile') return fcgResponse([MOBILE_ITEM], m!);
      return null;
    });

    const result = await lxSearch('tx', '晴天', 1, 30);

    expect(calls).toEqual(['POST:DoSearchForQQMusicDesktop', 'POST:DoSearchForQQMusicMobile']);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].songmid).toBe('0039MnYb0qxYhV');
    expect(result.list[0].name).toBe('晴天');
  });

  it('Desktop 与 Mobile 均被风控时走经典 Web 兜底', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    installRouter((method, url, body) => {
      calls.push({ method, url });
      if (url.includes('client_search_cp')) {
        return jsonResponse({ data: { song: { list: [WEB_ITEM], totalnum: 100 } } });
      }
      return fcgRiskResponse();
    });

    const result = await lxSearch('tx', '晴天', 1, 30);

    expect(calls).toHaveLength(3);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('musics.fcg');
    expect(calls[2].method).toBe('GET');
    expect(calls[2].url).toContain('client_search_cp');
    expect(result.list).toHaveLength(1);
    expect(result.list[0].name).toBe('晴天');
    expect(result.total).toBe(100);
  });

  it('三层全部失败时抛出 Web 兜底的错误', async () => {
    installRouter((method, url) => {
      if (url.includes('client_search_cp')) {
        return jsonResponse({ data: { song: { list: [] } } });
      }
      return fcgRiskResponse();
    });

    await expect(lxSearch('tx', '晴天', 1, 30)).rejects.toThrow(/无有效歌曲/);
  });

  it('Desktop 请求体使用随机 guid/wid 与 zzc 签名 URL', async () => {
    const seenBodies: any[] = [];
    installRouter((_method, url, body) => {
      seenBodies.push(JSON.parse(body || '{}'));
      expect(url).toMatch(/musics\.fcg\?sign=zzc/);
      return fcgResponse([DESKTOP_ITEM], 'DoSearchForQQMusicDesktop');
    });

    await lxSearch('tx', '晴天', 1, 30);
    await lxSearch('tx', '晴天', 1, 30);

    expect(seenBodies).toHaveLength(2);
    const [first, second] = seenBodies;
    expect(first.req.method).toBe('DoSearchForQQMusicDesktop');
    expect(first.comm.guid).toMatch(/^[0-9A-F]{32}$/);
    expect(first.comm.wid).toMatch(/^\d{19}$/);
    // 每次请求都换新设备身份，不共享累积风控
    expect(first.comm.guid).not.toBe(second.comm.guid);
    expect(first.comm.wid).not.toBe(second.comm.wid);
  });
});

describe('txSearchAlbumsRaw（签名 Desktop 专辑搜索）', () => {
  it('requests search_type=2 with signed URL and parses body.album.list', async () => {
    let seenBody: any;
    mockedHttp.mockImplementation(async (method: string, url: string, _headers?: any, body?: any) => {
      seenBody = JSON.parse(body || '{}');
      expect(method).toBe('POST');
      expect(url).toMatch(/musics\.fcg\?sign=zzc/);
      return jsonResponse({
        code: 0,
        req: {
          code: 0,
          data: {
            body: {
              album: {
                list: [{
                  albumID: 8220, albumMID: '000MkMni19ClKG', albumName: '叶惠美',
                  singerName: '周杰伦', publicTime: '2003-07-31',
                }],
              },
            },
          },
        },
      });
    });

    const albums = await txSearchAlbumsRaw('叶惠美', 1, 30);

    expect(seenBody.req.param.search_type).toBe(2);
    expect(seenBody.req.param.query).toBe('叶惠美');
    expect(seenBody.comm.guid).toMatch(/^[0-9A-F]{32}$/);
    expect(albums).toHaveLength(1);
    expect(albums[0].albumMID).toBe('000MkMni19ClKG');
  });

  it('returns empty array when response has no album list', async () => {
    mockedHttp.mockResolvedValueOnce(jsonResponse({
      code: 0,
      req: { code: 2001, data: { body: {} } },
    }));
    expect(await txSearchAlbumsRaw('叶惠美', 1, 30)).toEqual([]);
  });
});
