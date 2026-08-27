/** 酷狗平台评论（两步：hash→res_id 后走签名排行接口）。 */
import { hostKugouRequestKey, hostKugouSign } from '../tauri/hostCryptoApi';
import { httpJson, PAGE_SIZE } from './platformCommentShared';
import type { PlatformComment, PlatformCommentResult } from './platformCommentShared';

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

export async function fetchKgComments(mediaItem: any, page: number): Promise<PlatformCommentResult> {
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

  const comments: PlatformComment[] = data.list.map((item: any) => ({
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