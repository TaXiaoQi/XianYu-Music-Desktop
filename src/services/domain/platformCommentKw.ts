/** 酷我平台评论（ncomment.kuwo.cn，无需签名）。 */
import { httpJson, PAGE_SIZE } from './platformCommentShared';
import type { PlatformComment, PlatformCommentResult } from './platformCommentShared';

export async function fetchKwComments(songId: string, page: number): Promise<PlatformCommentResult> {
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