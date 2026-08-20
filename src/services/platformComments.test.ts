import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSearchResult, PluginSource } from '../types';

const pluginHttpRequestMock = vi.hoisted(() => vi.fn());

vi.mock('./tauri/pluginApi', () => ({
  pluginHttpRequest: pluginHttpRequestMock,
  pluginApi: {},
}));

import { detectCommentPlatform, fetchPlatformMusicComments } from './platformComments';

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    url: 'https://example.com',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function source(overrides: Partial<PluginSource> = {}): PluginSource {
  return {
    id: 'plugin-1',
    name: '网易云音乐',
    format: 'musicfree',
    version: '1.0.0',
    author: '',
    description: '',
    filePath: 'x.js',
    importedAt: 1,
    enabled: true,
    sources: ['网易云音乐'],
    ...overrides,
  };
}

/** CommentPanel 传入的条目形状：rawData 是搜索阶段的 PluginSearchResult */
function searchResult(mediaItem: Record<string, unknown>, platform: string): PluginSearchResult {
  return {
    id: String(mediaItem.id ?? ''),
    title: '晴天',
    artist: '周杰伦',
    album: '',
    coverUrl: '',
    duration: 0,
    platform,
    platformId: String(mediaItem.id ?? ''),
    pluginId: 'plugin-1',
    rawData: { ...mediaItem, platform },
  } as PluginSearchResult;
}

describe('detectCommentPlatform', () => {
  it('按插件名/平台字段识别六大平台', () => {
    expect(detectCommentPlatform(source({ name: '网易云音乐' }))).toBe('wy');
    expect(detectCommentPlatform(source({ name: 'QQ音乐' }))).toBe('tx');
    expect(detectCommentPlatform(source({ name: '酷狗音乐' }))).toBe('kg');
    expect(detectCommentPlatform(source({ name: '酷我音乐' }))).toBe('kw');
    expect(detectCommentPlatform(source({ name: '咪咕音乐' }))).toBe('mg');
    expect(detectCommentPlatform(source({ name: '汽水音乐' }))).toBe('qishui');
  });

  it('平台字段也可识别（插件名缺省时）', () => {
    expect(detectCommentPlatform(source({ name: '' }), '网易云音乐')).toBe('wy');
    expect(detectCommentPlatform(source({ name: '插件' }), 'QQ音乐(赞助版)')).toBe('tx');
  });

  it('未知平台返回 null', () => {
    expect(detectCommentPlatform(source({ name: '千音' }))).toBeNull();
    expect(detectCommentPlatform(null)).toBeNull();
  });
});

describe('fetchPlatformMusicComments', () => {
  beforeEach(() => {
    pluginHttpRequestMock.mockReset();
  });

  it('平台不受支持时返回 null', async () => {
    const result = await fetchPlatformMusicComments(
      source({ name: '千音' }),
      searchResult({ id: '1' }, '千音'),
      1,
    );
    expect(result).toBeNull();
    expect(pluginHttpRequestMock).not.toHaveBeenCalled();
  });

  it('rawData 仍是 PluginSearchResult 包装（双层嵌套）时自动解到内层条目', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      code: 200,
      comments: [{ commentId: 1, content: 'x', user: { nickname: 'a' } }],
      more: false,
    }));

    const innerItem = { id: '186016', songmid: undefined, platform: '网易云音乐' };
    const wrapped = {
      id: '186016',
      platform: '网易云音乐',
      pluginId: 'plugin-1',
      rawData: innerItem,
    } as unknown as PluginSearchResult;

    const result = await fetchPlatformMusicComments(source(), wrapped, 1);

    expect(result?.data.length).toBe(1);
    const url = pluginHttpRequestMock.mock.calls[0][1] as string;
    expect(url).toContain('R_SO_4_186016');
  });

  it('网易云：page1 合并热评与最新评论并按 commentId 去重', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      code: 200,
      hotComments: [
        { commentId: 1, content: '热评', user: { nickname: '甲', avatarUrl: 'http://a' }, likedCount: 99, time: 1700000000000, ipLocation: { location: '北京' }, beReplied: [{ beRepliedCommentId: 9, content: '回复', user: { nickname: '乙' } }] },
        { commentId: 2, content: '重复热评', user: { nickname: '丙' }, likedCount: 5, time: 1700000001000 },
      ],
      comments: [
        { commentId: 1, content: '热评', user: { nickname: '甲' }, likedCount: 99, time: 1700000000000 },
        { commentId: 3, content: '最新', user: { nickname: '丁' }, likedCount: 1, time: 1700000002000 },
      ],
      total: 30,
      more: true,
    }));

    const result = await fetchPlatformMusicComments(
      source(),
      searchResult({ id: 186016 }, '网易云音乐'),
      1,
    );

    expect(result?.isEnd).toBe(false);
    expect(result?.data.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(result?.data[0].replies?.[0]?.nickName).toBe('乙');
    expect(result?.data[0].location).toBe('北京');

    const url = pluginHttpRequestMock.mock.calls[0][1] as string;
    expect(url).toContain('R_SO_4_186016');
    expect(url).toContain('offset=0');
  });

  it('网易云：翻页仅取 comments 且 more=false 时结束', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      code: 200,
      comments: [{ commentId: 21, content: 'x', user: { nickname: 'a' } }],
      total: 21,
      more: false,
    }));

    const result = await fetchPlatformMusicComments(
      source(),
      searchResult({ id: 186016 }, '网易云音乐'),
      2,
    );

    expect(result?.isEnd).toBe(true);
    const url = pluginHttpRequestMock.mock.calls[0][1] as string;
    expect(url).toContain('offset=20');
  });

  it('QQ：数字 songid 直接使用并映射热评结构', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      code: 0,
      req: {
        code: 0,
        data: {
          CommentList: {
            Comments: [
              {
                CmId: 111,
                Nick: 'Q用户',
                Avatar: 'http://qq',
                Content: '好听',
                PraiseNum: 8,
                PubTime: '1700000000',
                SubComments: [{ CmId: 112, Nick: '子', Content: '回复', PraiseNum: 1, PubTime: '1700000001' }],
              },
            ],
          },
        },
      },
    }));

    const result = await fetchPlatformMusicComments(
      source({ name: 'QQ音乐' }),
      searchResult({ id: '97773', songmid: '0039MnYb0qxYhV' }, 'QQ音乐'),
      1,
    );

    // 数字 id 已存在，不应先发 CgiGetTrackInfo 解析
    expect(pluginHttpRequestMock).toHaveBeenCalledTimes(1);
    expect(result?.data[0].createAt).toBe(1700000000000);
    expect(result?.data[0].replies?.[0].nickName).toBe('子');
    expect(result?.data[0].like).toBe(8);
  });

  it('QQ：缺数字 id 时经 songmid 解析 songid', async () => {
    pluginHttpRequestMock.mockImplementation(async (_m: string, _url: string, _h: unknown, body?: string) => {
      if (body?.includes('CgiGetTrackInfo')) {
        return jsonResponse({ code: 0, req: { code: 0, data: { tracks: [{ id: 97773 }] } } });
      }
      return jsonResponse({
        code: 0,
        req: { code: 0, data: { CommentList: { Comments: [] } } },
      });
    });

    const result = await fetchPlatformMusicComments(
      source({ name: 'QQ音乐' }),
      searchResult({ id: '0039MnYb0qxYhV', songmid: '0039MnYb0qxYhV' }, 'QQ音乐'),
      1,
    );

    expect(pluginHttpRequestMock).toHaveBeenCalledTimes(2);
    const commentBody = JSON.parse(pluginHttpRequestMock.mock.calls[1][3] as string);
    expect(commentBody.req.param.BizId).toBe('97773');
    expect(result?.isEnd).toBe(true);
  });

  it('酷狗：hash 经两步解析并携带签名请求', async () => {
    pluginHttpRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('gateway.kugou.com')) {
        return jsonResponse({ status: 1, data: [[{ classification: [{ res_id: 6000000 }] }]] });
      }
      return jsonResponse({
        status: 1,
        list: [
          { id: 555, user_name: 'K用户', user_pic: 'http://kg', content: '不错', like: { likenum: 3 }, addtime: '2026-08-20 10:00:00', location: '上海' },
        ],
      });
    });

    const result = await fetchPlatformMusicComments(
      source({ name: '酷狗音乐' }),
      searchResult({ id: 'ABCDEF1234567890', hash: 'ABCDEF1234567890' }, '酷狗音乐'),
      1,
    );

    expect(result?.data[0].nickName).toBe('K用户');
    expect(result?.data[0].like).toBe(3);
    expect(result?.data[0].location).toBe('上海');
    const commentUrl = pluginHttpRequestMock.mock.calls[1][1] as string;
    expect(commentUrl).toContain('m.comment.service.kugou.com');
    expect(commentUrl).toContain('mixsongid=6000000');
    expect(commentUrl).toContain('signature=');
  });

  it('酷我：映射评论与二级评论并按总量判断结束', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      code: '200',
      comments_counts: 25,
      comments: [
        { id: 1, u_name: 'KW', u_pic: 'http://kw', msg: '评论', like_num: 2, time: '1700000000', child_comments: [{ id: 2, u_name: '子', msg: '回复' }] },
      ],
    }));

    const result = await fetchPlatformMusicComments(
      source({ name: '酷我音乐' }),
      searchResult({ id: '900123' }, '酷我音乐'),
      1,
    );

    expect(result?.isEnd).toBe(false);
    expect(result?.data[0].replies?.[0]?.comment).toBe('回复');
    expect(result?.data[0].createAt).toBe(1700000000000);
  });

  it('咪咕：协议相对头像补协议并映射回复列表', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      returnCode: '000000',
      data: {
        itemTotal: 20,
        items: [
          {
            commentId: '77',
            author: { name: 'MG', avatar: '//img.migu.cn/a.jpg' },
            body: '咪咕评论',
            praiseCount: 4,
            createTime: '2026-08-20 10:00:00',
            replyCommentList: [{ commentId: '78', author: { name: '子' }, body: '回复' }],
          },
        ],
      },
    }));

    const result = await fetchPlatformMusicComments(
      source({ name: '咪咕音乐' }),
      searchResult({ id: '60054700000', copyrightId: '60054700000' }, '咪咕音乐'),
      1,
    );

    expect(result?.isEnd).toBe(true);
    expect(result?.data[0].avatar).toBe('http://img.migu.cn/a.jpg');
    expect(result?.data[0].replies?.[0]?.nickName).toBe('子');
  });

  it('汽水：映射 luna/pc 评论（秒级时间戳转毫秒，短页即结束与 Baka 一致）', async () => {
    pluginHttpRequestMock.mockResolvedValue(jsonResponse({
      status_code: 0,
      has_more: true,
      comments: [
        { id: 'c1', user: { nickname: 'QS', medium_avatar_url: 'http://qs/a.jpg' }, content: '汽水评论', count_digged: 6, time_created: 1755655200 },
      ],
    }));

    const result = await fetchPlatformMusicComments(
      source({ name: '汽水音乐' }),
      searchResult({ id: '741255888888' }, '汽水音乐'),
      1,
    );

    expect(result?.isEnd).toBe(true);
    expect(result?.data[0].createAt).toBe(1755655200000);
    expect(result?.data[0].like).toBe(6);
  });

  it('平台受支持但接口失败时返回空结果而非 null', async () => {
    pluginHttpRequestMock.mockRejectedValue(new Error('network down'));

    const result = await fetchPlatformMusicComments(
      source(),
      searchResult({ id: '186016' }, '网易云音乐'),
      1,
    );

    expect(result).toEqual({ isEnd: true, data: [] });
  });

  it('缺歌曲 id 时返回 null（不支持语义）', async () => {
    const result = await fetchPlatformMusicComments(
      source(),
      searchResult({}, '网易云音乐'),
      1,
    );
    expect(result).toBeNull();
    expect(pluginHttpRequestMock).not.toHaveBeenCalled();
  });
});
