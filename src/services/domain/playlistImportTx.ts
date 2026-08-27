import { decodeName, formatSingerName } from '../../utils/musicFormat';
import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  formatPlayTime,
  getTxListId,
  httpFetch,
  log,
  type PlaylistImportResult,
  type PlaylistInfo,
  type WyTrackMetaPatch,
} from './playlistImportBase';

/**
 * QQ音乐（小秋）歌单详情与曲目元数据导入。
 * 仅依赖 playlistImportBase，作为叶子模块被 playlistImport 门面消费。
 */

async function getListDetailTx(rawId: string): Promise<PlaylistImportResult> {
  let id = getTxListId(rawId);
  if (!id && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    id = await resolveTxShareUrl(rawId);
  }
  if (!id) return { source: 'tx', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg` +
    `?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}` +
    `&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8` +
    `&notice=0&platform=yqq.json&needNewCode=0`;

  const resp = await httpFetch(url, 'GET', {
    'Origin': 'https://y.qq.com',
    'Referer': `https://y.qq.com/n/yqq/playsquare/${id}.html`,
  });

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.code !== 0) {
    throw new Error(`QQ音乐歌单获取失败: code=${body?.code ?? 'unknown'}`);
  }

  const cdlist = body.cdlist || [];
  if (cdlist.length === 0) return { source: 'tx', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const cd = cdlist[0];
  const songlist = cd.songlist || [];

  const songs: PluginSearchResult[] = [];
  for (const item of songlist) {
    const parsed = parseTxSong(item);
    if (parsed) songs.push(parsed);
  }

  const info: PlaylistInfo = {
    name: decodeName(cd.dissname || ''),
    img: cd.logo || '',
    desc: decodeName(cd.desc || '').replace(/<br>/g, '\n'),
    author: cd.nickname || '',
    playCount: String(cd.visitnum || 0),
  };

  return { source: 'tx', songs, total: songs.length, info };
}

function parseTxSong(item: any): PluginSearchResult | null {
  const songmid = item.mid || '';
  const songId = String(item.id || '');
  if (!songmid && !songId) return null;

  const singer = item.singer || [];
  const singerName = formatSingerName(singer);
  const name = decodeName(item.title || '');
  const album = item.album || {};
  const albumName = decodeName(album.name || '');
  const albumMid = album.mid || '';
  const interval = item.interval || 0;
  const file = item.file || {};
  const strMediaMid = file.media_mid || '';

  // 封面
  let img = '';
  if (!albumName || albumName === '空') {
    const firstSinger = singer[0];
    if (firstSinger) {
      img = `https://y.gtimg.cn/music/photo_new/T001R500x500M000${firstSinger.mid || ''}.jpg`;
    }
  } else {
    img = `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`;
  }

  const rawData = {
    songmid,
    songId,
    strMediaMid,
    albumMid,
    name,
    singer: singerName,
    source: 'tx',
    interval: formatPlayTime(interval),
  };

  return createSearchResult({
    id: songmid || songId,
    title: name,
    artist: singerName,
    album: albumName,
    coverUrl: img,
    duration: interval * 1000,
    platform: 'QQ音乐',
    sourceKey: 'tx',
    rawData,
  });
}

/** 解析 QQ音乐分享 URL，从 HTML/JSON 中提取歌单 id */
async function resolveTxShareUrl(url: string): Promise<string | null> {
  try {
    const resp = await httpFetch(url, 'GET', {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HLK-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.102 Mobile Safari/537.36 EdgA/104.0.1293.70',
    });
    const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);

    // 1. id= 查询参数
    let m = body.match(/id=(\d+)/);
    if (m) return m[1];
    // 2. /playlist/\d+ 路径
    m = body.match(/\/playlist\/(\d+)/);
    if (m) return m[1];
    // 3. /playsquare/\d+ 路径
    m = body.match(/\/playsquare\/(\d+)/);
    if (m) return m[1];
    // 4. "disstid":"?\d+" JSON 字段
    m = body.match(/"disstid"\s*:\s*"?(\d+)"?/);
    if (m) return m[1];
    // 5. "dissid":"?\d+" JSON 字段
    m = body.match(/"dissid"\s*:\s*"?(\d+)"?/);
    if (m) return m[1];

    return null;
  } catch (e: any) {
    log(`resolveTxShareUrl failed: ${e?.message}`);
    return null;
  }
}

/**
 * 按 QQ 音乐 songmid 批量补全封面与时长。
 *
 * v8/fcg-bin/fcg_play_single_song.fcg 是无需登录的经典开放接口（搜索/详情接口
 * musicu.fcg DoSearchForQQMusicDesktop 已要求登录），支持逗号分隔批量 songmid，
 * 返回 interval（秒）与 album.mid（可拼官方 y.gtimg.cn 封面）。
 */
export async function fetchQqTrackMetaByIds(
  mids: string[],
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validMids = mids.filter(mid => /^[0-9A-Za-z]{6,32}$/.test(mid));
  if (validMids.length === 0) return patches;

  const BATCH_SIZE = 60;
  for (let offset = 0; offset < validMids.length; offset += BATCH_SIZE) {
    const batch = validMids.slice(offset, offset + BATCH_SIZE);
    try {
      const resp = await httpFetch(
        `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${batch.join(',')}&format=json`,
        'GET',
        {
          Origin: 'https://y.qq.com',
          Referer: 'https://y.qq.com/',
        },
      );
      const body = resp.body;
      const list = Array.isArray(body?.data) ? body.data : [];
      for (const track of list) {
        const mid = String(track?.mid || '');
        if (!mid) continue;
        const intervalSec = Number(track?.interval) || 0;
        const albumMid = String(track?.album?.mid || '');
        patches.set(mid, {
          coverUrl: albumMid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            : '',
          durationMs: intervalSec > 0 ? intervalSec * 1000 : 0,
        });
      }
    } catch (e: any) {
      log(`fetchQqTrackMetaByIds batch failed: ${e?.message || e}`);
    }
  }

  return patches;
}

export { getListDetailTx };