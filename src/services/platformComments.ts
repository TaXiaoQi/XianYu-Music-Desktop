/**
 * 宿主直连平台评论服务（MusicFree 插件评论区兜底）。
 *
 * MF 插件规范没有评论 API（getMusicComments 是 BakaMusic 扩展），
 * 但歌曲 id 全平台通用——插件未实现评论方法时，宿主按歌曲平台
 * 直接调用平台公开评论接口。接口路径、参数与返回映射均与
 * BakaMusic 官方插件（music.cwo.cc.cd，author Toskysun）逐一对齐，
 * 统一返回 { isEnd, data } 结构，CommentPanel 无需感知来源差异。
 *
 * 返回 null 表示平台不受支持或缺少歌曲 id（调用方据此展示"不支持"）；
 * 网络失败等一律返回 { isEnd: true, data: [] }（展示"暂无评论"）。
 */
import { pluginHttpRequest } from './tauri/pluginApi';
import { hostKugouRequestKey, hostKugouSign } from './tauri/hostCryptoApi';
import type { PluginSearchResult, PluginSource } from '../types';

export type CommentPlatform = 'wy' | 'tx' | 'kg' | 'kw' | 'mg' | 'qishui';

export interface PlatformComment {
  id?: string;
  nickName: string;
  avatar?: string;
  comment: string;
  like?: number | null;
  createAt?: number | string | null;
  location?: string;
  replies?: PlatformComment[];
}

export interface PlatformCommentResult {
  isEnd: boolean;
  data: PlatformComment[];
}

const PAGE_SIZE = 20;

const PLATFORM_PATTERNS: Array<[CommentPlatform, RegExp]> = [
  ['wy', /网易|netease|\bwy\b/i],
  ['tx', /qq/i],
  ['kg', /酷狗|kugou|\bkg\b/i],
  ['kw', /酷我|kuwo|\bkw\b/i],
  ['mg', /咪咕|migu|\bmg\b/i],
  ['qishui', /汽水|qishui/i],
];

/** 判断歌曲所属的评论平台（按插件名/平台字段匹配，顺序决定优先级） */
export function detectCommentPlatform(
  source: PluginSource | null | undefined,
  platformText?: string | null,
): CommentPlatform | null {
  const haystack = `${source?.name || ''}|${platformText || ''}`;
  if (!haystack.trim() || haystack === '|') return null;
  for (const [platform, pattern] of PLATFORM_PATTERNS) {
    if (pattern.test(haystack)) return platform;
  }
  return null;
}

/**
 * 提取评论接口所需的 MusicFree 原始歌曲条目。
 * 正常传入的 rawData 即 MusicFree 条目；若调用方仍传入搜索阶段的
 * PluginSearchResult 包装（pluginId+rawData 同时存在），再解一层内嵌。
 */
function extractMediaItem(item: PluginSearchResult): any {
  const inner = (item as any)?.rawData;
  if (inner?.pluginId && inner?.rawData) return inner.rawData;
  return inner ?? item;
}

async function httpJson(
  method: 'GET' | 'POST',
  url: string,
  headers?: Record<string, string>,
  body?: string,
  timeoutSec = 15,
): Promise<any | null> {
  try {
    const resp = await pluginHttpRequest(method, url, headers, body, timeoutSec, 10);
    if (resp.status < 200 || resp.status >= 400) return null;
    return JSON.parse(resp.body);
  } catch {
    return null;
  }
}

// ==================== 网易云 ====================

function mapWyComment(raw: any): PlatformComment {
  return {
    id: raw?.commentId?.toString(),
    nickName: raw?.user?.nickname || '',
    avatar: raw?.user?.avatarUrl,
    comment: raw?.content || '',
    like: raw?.likedCount ?? 0,
    createAt: raw?.time ?? null,
    location: raw?.ipLocation?.location,
    replies: (raw?.beReplied || []).map((reply: any) => ({
      id: reply?.beRepliedCommentId?.toString(),
      nickName: reply?.user?.nickname || '',
      avatar: reply?.user?.avatarUrl,
      comment: reply?.content || '',
      like: null,
      createAt: null,
      location: reply?.ipLocation?.location,
    })),
  };
}

/** 网易云评论（免加密老接口，与 weapi 热评接口同构：page1 合并热评+最新） */
async function fetchWyComments(songId: string, page: number): Promise<PlatformCommentResult> {
  const empty = { isEnd: true, data: [] };
  const rid = `R_SO_4_${songId}`;
  const offset = (page - 1) * PAGE_SIZE;
  const data = await httpJson(
    'GET',
    `https://music.163.com/api/v1/resource/comments/${rid}?rid=${rid}&limit=${PAGE_SIZE}&offset=${offset}`,
    {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  );
  if (!data || data.code !== 200) return empty;

  const rawComments: any[] = Array.isArray(data.comments) ? data.comments : [];
  let merged: any[];
  if (page === 1 && Array.isArray(data.hotComments) && data.hotComments.length > 0) {
    const seen = new Set<string>();
    merged = [...data.hotComments, ...rawComments].filter((c) => {
      const key = String(c?.commentId ?? '');
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
  } else {
    merged = rawComments;
  }

  return {
    isEnd: data.more !== true,
    data: merged.map(mapWyComment),
  };
}

// ==================== QQ 音乐 ====================

function mapTxComment(raw: any): PlatformComment {
  return {
    id: raw?.CmId?.toString(),
    nickName: raw?.Nick || '',
    avatar: raw?.Avatar,
    comment: raw?.Content || '',
    like: raw?.PraiseNum || 0,
    createAt: raw?.PubTime ? parseInt(`${raw.PubTime}000`, 10) : null,
    replies: (raw?.SubComments || []).map((c: any) => ({
      id: c?.CmId?.toString(),
      nickName: c?.Nick || '',
      avatar: c?.Avatar || '',
      comment: c?.Content || '',
      like: c?.PraiseNum || 0,
      createAt: c?.PubTime ? parseInt(`${c.PubTime}000`, 10) : null,
    })),
  };
}

/** songmid → 数字 songid（与 Baka QQ 插件 getMusicInfoForComment 同链路） */
async function resolveTxSongId(mediaItem: any): Promise<string | null> {
  const rawId = mediaItem?.id;
  const idStr = rawId != null ? String(rawId) : '';
  if (/^\d+$/.test(idStr) && Number(idStr) > 0) return idStr;

  const songmid = mediaItem?.songmid || mediaItem?.mid;
  if (!songmid) return null;

  const body = JSON.stringify({
    comm: { ct: '19', cv: '1859', uin: '0' },
    req: {
      module: 'music.trackInfo.UniformRuleCtrl',
      method: 'CgiGetTrackInfo',
      param: { types: [1], ids: [0], mids: [songmid], ctx: 0 },
    },
  });
  const data = await httpJson('POST', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
    Referer: 'https://y.qq.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json; charset=utf-8',
  }, body);
  const trackId = data?.req?.data?.tracks?.[0]?.id;
  return trackId != null ? String(trackId) : null;
}

/** QQ 音乐热评（musicu.fcg CommentRead.GetHotCommentList） */
async function fetchTxComments(mediaItem: any, page: number): Promise<PlatformCommentResult> {
  const empty = { isEnd: true, data: [] };
  const songId = await resolveTxSongId(mediaItem);
  if (!songId) return empty;

  const body = JSON.stringify({
    comm: {
      cv: 4747474,
      ct: 24,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 1,
      uin: 0,
    },
    req: {
      module: 'music.globalComment.CommentRead',
      method: 'GetHotCommentList',
      param: {
        BizType: 1,
        BizId: songId,
        LastCommentSeqNo: '',
        PageSize: PAGE_SIZE,
        PageNum: page - 1,
        HotType: 1,
        WithAirborne: 0,
        PicEnable: 1,
      },
    },
  });
  const data = await httpJson('POST', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
    accept: 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    referer: 'https://y.qq.com/',
    origin: 'https://y.qq.com',
    'content-type': 'application/json; charset=utf-8',
  }, body);

  if (!data || data.code !== 0 || !data.req || data.req.code !== 0) return empty;

  const commentList = data.req.data?.CommentList?.Comments || [];
  return {
    isEnd: commentList.length < PAGE_SIZE,
    data: commentList.map(mapTxComment),
  };
}

// ==================== 酷狗 ====================

/** 酷狗评论接口签名：参数按字典序排序后加盐 MD5（与 Baka 插件 signatureParams 一致，Rust host_crypto 计算） */
function kugouSignature(params: string): Promise<string> {
  return hostKugouSign(params, 'android');
}

/** 酷狗 hash → mixsongid（res_id），评论接口的必选参数 */
async function resolveKgMixsongId(hash: string): Promise<string | null> {
  const body = JSON.stringify({
    area_code: '1',
    show_privilege: 1,
    show_album_info: '1',
    is_publish: '',
    appid: 1005,
    clientver: 11451,
    mid: '1',
    dfid: '-',
    clienttime: Date.now(),
    key: await hostKugouRequestKey(),
    fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname,classification',
    data: [{ hash }],
  });
  const data = await httpJson('POST', 'http://gateway.kugou.com/v3/album_audio/audio', {
    'KG-THash': '13a3164',
    'KG-RC': '1',
    'KG-Fake': '0',
    'KG-RF': '00869891',
    'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
    'x-router': 'kmr.service.kugou.com',
    'Content-Type': 'application/json',
  }, body);
  return data?.data?.[0]?.[0]?.classification?.[0]?.res_id?.toString() || null;
}

/** 酷狗评论（两步：hash→res_id 后走签名排行接口） */
async function fetchKgComments(mediaItem: any, page: number): Promise<PlatformCommentResult> {
  const empty = { isEnd: true, data: [] };
  const hash = mediaItem?.hash || mediaItem?.id;
  if (!hash) return empty;

  const mixsongId = await resolveKgMixsongId(String(hash));
  if (!mixsongId) return empty;

  const params = [
    'appid=1005',
    `clienttime=${Date.now()}`,
    'clienttoken=0',
    'clientver=11409',
    'code=fc4be23b4e972707f36b8a828a93ba8a',
    'dfid=0',
    `extdata=${hash}`,
    'kugouid=0',
    'mid=16249512204336365674023395779019',
    `mixsongid=${mixsongId}`,
    `p=${page}`,
    `pagesize=${PAGE_SIZE}`,
    'uuid=0',
    'ver=10',
  ].join('&');
  const signature = await kugouSignature(params);

  const data = await httpJson('GET', `http://m.comment.service.kugou.com/r/v1/rank/newest?${params}&signature=${signature}`, {
    accept: 'application/json',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.24',
  });
  if (!data || !Array.isArray(data.list)) return empty;

  const comments = data.list.map((item: any) => ({
    id: item?.id?.toString(),
    nickName: item?.user_name || '',
    avatar: item?.user_pic,
    comment: item?.content || '',
    like: item?.like?.likenum || 0,
    createAt: item?.addtime ? new Date(item.addtime).getTime() : null,
    location: item?.location,
    replies: [],
  }));
  return {
    isEnd: comments.length < PAGE_SIZE,
    data: comments,
  };
}

// ==================== 酷我 ====================

/** 酷我评论（ncomment.kuwo.cn，无需签名） */
async function fetchKwComments(songId: string, page: number): Promise<PlatformCommentResult> {
  const empty = { isEnd: true, data: [] };
  const start = (page - 1) * PAGE_SIZE;
  const data = await httpJson(
    'GET',
    `http://ncomment.kuwo.cn/com.s?f=web&type=get_comment&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid=${encodeURIComponent(songId)}&start=${start}&msgflag=1&count=${PAGE_SIZE}&newver=3&uid=0`,
    { 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9;)' },
  );
  if (!data || data.code !== '200') return empty;

  const rawComments: any[] = Array.isArray(data.comments) ? data.comments : [];
  const total = Number(data.comments_counts || 0);
  const mapKwComment = (c: any): PlatformComment => ({
    id: c?.id?.toString(),
    nickName: c?.u_name || '',
    avatar: c?.u_pic,
    comment: c?.msg || '',
    like: c?.like_num,
    createAt: c?.time ? Number(c.time) * 1000 : null,
    replies: (c?.child_comments || []).map(mapKwComment),
  });
  return {
    isEnd: page * PAGE_SIZE >= total || rawComments.length === 0,
    data: rawComments.map(mapKwComment),
  };
}

// ==================== 咪咕 ====================

function mapMgComment(raw: any): PlatformComment {
  const normalizeAvatar = (avatar: any): string | undefined => (
    typeof avatar === 'string' && avatar.startsWith('//') ? `http:${avatar}` : avatar
  );
  return {
    id: raw?.commentId?.toString(),
    nickName: raw?.author?.name || '',
    avatar: normalizeAvatar(raw?.author?.avatar),
    comment: raw?.body || '',
    like: raw?.praiseCount,
    createAt: raw?.createTime ? new Date(raw.createTime).getTime() : null,
    replies: (raw?.replyCommentList || []).map(mapMgComment),
  };
}

/** 咪咕评论（music.migu.cn listComments，无需签名） */
async function fetchMgComments(songId: string, page: number): Promise<PlatformCommentResult> {
  const empty = { isEnd: true, data: [] };
  const data = await httpJson(
    'GET',
    `https://music.migu.cn/v3/api/comment/listComments?targetId=${encodeURIComponent(songId)}&pageSize=${PAGE_SIZE}&pageNo=${page}`,
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4195.1 Safari/537.36',
      Referer: 'https://music.migu.cn',
    },
  );
  if (!data || data.returnCode !== '000000') return empty;

  const items: any[] = Array.isArray(data.data?.items) ? data.data.items : [];
  const total = Number(data.data?.itemTotal || 0);
  return {
    isEnd: page * PAGE_SIZE >= total || items.length === 0,
    data: items.map(mapMgComment),
  };
}

// ==================== 汽水 ====================

const QISHUI_PC_PARAMS = new URLSearchParams({
  aid: '386088',
  app_name: 'luna_pc',
  region: 'cn',
  geo_region: 'cn',
  os_region: 'cn',
  sim_region: '',
  device_id: '100000305367703244',
  cdid: '',
  iid: '',
  version_name: '3.2.1',
  version_code: '30020100',
  channel: 'official',
  build_mode: 'master',
  network_carrier: '',
  ac: 'wifi',
  tz_name: 'Asia/Shanghai',
  resolution: '',
  device_platform: 'windows',
  device_type: 'Windows',
  os_version: 'Windows 11 Home China',
  fp: '100000305367703244',
});

/** 汽水评论（api.qishui.com luna/pc，静态参数无需登录态） */
async function fetchQishuiComments(songId: string, page: number): Promise<PlatformCommentResult> {
  const empty = { isEnd: true, data: [] };
  const params = new URLSearchParams(QISHUI_PC_PARAMS);
  params.set('group_id', songId);
  params.set('cursor', String((page - 1) * PAGE_SIZE));
  params.set('count', String(PAGE_SIZE));
  params.set('group_type', '1');
  params.set('image_strategy', '2');

  const data = await httpJson('GET', `https://api.qishui.com/luna/pc/comments?${params.toString()}`, {
    Accept: '*/*',
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'LunaPC/3.2.1(343009595)',
    'x-luna-background-type': 'foreground',
    'x-luna-is-background-req': '0',
    'x-luna-is-local-user': '0',
  });
  if (!data || Number(data.status_code || 0) !== 0) return empty;

  const rawComments: any[] = Array.isArray(data.comments) ? data.comments : [];
  const comments = rawComments.map((raw: any) => {
    const rawTime = raw?.time_created ? Number(raw.time_created) : 0;
    const createAt = rawTime > 0 && rawTime < 1000000000000 ? rawTime * 1000 : rawTime;
    const avatar = raw?.user?.medium_avatar_url;
    return {
      id: raw?.id?.toString(),
      nickName: raw?.user?.nickname || '',
      avatar: typeof avatar === 'string' ? avatar : (avatar?.urls?.[0] || avatar?.uri),
      comment: raw?.content || '',
      like: raw?.count_digged,
      createAt: createAt || null,
      replies: [],
    };
  });
  return {
    isEnd: data.has_more === false || comments.length < PAGE_SIZE,
    data: comments,
  };
}

// ==================== 入口 ====================

/**
 * 按歌曲平台直连平台评论接口（MF 插件无 getMusicComments 时的兜底）。
 * @returns 平台不支持或缺歌曲 id 时返回 null，调用方展示"不支持评论"
 */
export async function fetchPlatformMusicComments(
  source: PluginSource,
  item: PluginSearchResult,
  page: number = 1,
): Promise<PlatformCommentResult | null> {
  const mediaItem = extractMediaItem(item);
  const platform = detectCommentPlatform(source, mediaItem?.platform || (item as any)?.platform || source.name);
  if (!platform) return null;

  try {
    switch (platform) {
      case 'wy': {
        const songId = mediaItem?.id || (item as any)?.id;
        if (!songId) return null;
        return await fetchWyComments(String(songId), page);
      }
      case 'tx':
        return await fetchTxComments(mediaItem, page);
      case 'kg':
        return await fetchKgComments(mediaItem, page);
      case 'kw': {
        const songId = mediaItem?.id || mediaItem?.rid || (item as any)?.id;
        if (!songId) return null;
        return await fetchKwComments(String(songId), page);
      }
      case 'mg': {
        const songId = mediaItem?.id || mediaItem?.copyrightId || mediaItem?.copyright_id || (item as any)?.id;
        if (!songId) return null;
        return await fetchMgComments(String(songId), page);
      }
      case 'qishui': {
        const songId = mediaItem?.id || mediaItem?.item_id || mediaItem?.track_id || (item as any)?.id;
        if (!songId) return null;
        return await fetchQishuiComments(String(songId), page);
      }
    }
  } catch (e) {
    console.warn(`[platformComments] ${platform} 评论获取失败:`, e);
    return { isEnd: true, data: [] };
  }
  return null;
}
