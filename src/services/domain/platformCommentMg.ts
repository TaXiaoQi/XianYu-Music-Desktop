/** 咪咕平台评论（music.migu.cn listComments，无需签名）。 */
import { httpJson, PAGE_SIZE } from './platformCommentShared';
import type { PlatformComment, PlatformCommentResult } from './platformCommentShared';

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

export async function fetchMgComments(songId: string, page: number): Promise<PlatformCommentResult> {
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