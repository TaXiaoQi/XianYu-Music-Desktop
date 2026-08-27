/** QQ 音乐平台评论（musicu.fcg GetHotCommentList），含 songmid→songid 解析。 */
import { httpJson, PAGE_SIZE } from './platformCommentShared';
import type { PlatformComment, PlatformCommentResult } from './platformCommentShared';

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
export async function resolveTxSongId(mediaItem: any): Promise<string | null> {
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

export async function fetchTxComments(mediaItem: any, page: number): Promise<PlatformCommentResult> {
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