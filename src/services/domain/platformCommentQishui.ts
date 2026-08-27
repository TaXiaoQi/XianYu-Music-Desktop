/** 汽水音乐平台评论（api.qishui.com luna/pc，静态参数无需登录态）。 */
import { httpJson, PAGE_SIZE } from './platformCommentShared';
import type { PlatformComment, PlatformCommentResult } from './platformCommentShared';

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

export async function fetchQishuiComments(songId: string, page: number): Promise<PlatformCommentResult> {
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
  const comments: PlatformComment[] = rawComments.map((raw: any) => {
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