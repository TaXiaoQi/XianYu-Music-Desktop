/** 网易云平台评论（免加密老接口，与 weapi 热评接口同构：page1 合并热评+最新）。 */
import { httpJson, PAGE_SIZE } from './platformCommentShared';
import type { PlatformComment, PlatformCommentResult } from './platformCommentShared';

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

export async function fetchWyComments(songId: string, page: number): Promise<PlatformCommentResult> {
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