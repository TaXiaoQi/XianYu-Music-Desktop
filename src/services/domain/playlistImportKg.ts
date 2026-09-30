import { hostKugouRequestKey, hostKugouSign } from '../tauri/hostCryptoApi';
import { decodeName } from '../../utils/musicFormat';
import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  formatPlayTime,
  getKgListId,
  httpFetch,
  log,
  type PlaylistImportResult,
  type PlaylistInfo,
  type WyTrackMetaPatch,
} from './playlistImportBase';


// ==================== 酷狗签名（Rust host_crypto 计算） ====================

function signatureParamsKg(params: string, platform: string, body: string): Promise<string> {
  return hostKugouSign(params, platform, body);
}

// ==================== 歌单详情 ====================

async function getListDetailKg(rawId: string): Promise<PlaylistImportResult> {
  if (rawId.includes('gcid_')) {
    return getKgListDetailByGcid(rawId);
  }
  if (rawId.includes('global_collection_id')) {
    const m = rawId.match(/global_collection_id=(\w+)/);
    if (m && m[1]) {
      return getKgGcidDetail(m[1]);
    }
  }
  // 纯数字酷狗码：先 t.kugou.com/command 反查（gcid → gateway 全量，
  // 对齐移动端 kg_sheet_import），反查失败再当 specialid 走 v9 页面
  const trimmed = rawId.trim();
  if (/^\d{1,32}$/.test(trimmed)) {
    try {
      const byCode = await getKgListDetailByCode(trimmed);
      if (byCode && byCode.songs.length > 0) return byCode;
    } catch (e: any) {
      log(`getListDetailKg: command 反查失败: ${e?.message}`);
    }
  }
  let id = getKgListId(rawId);
  if (!id && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    const gcid = await resolveKgShareUrl(rawId);
    if (gcid) return getKgUserListDetail2(gcid);
  }
  if (!id) return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const url = `https://www2.kugou.kugou.com/yueku/v9/special/single/${id}-5-9999.html`;
  const resp = await httpFetch(url, 'GET');
  const body = typeof resp.body === 'string' ? resp.body : '';

  const listDataMatch = body.match(/global\.data\s*=\s*(\[.+]);/s);
  if (!listDataMatch) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  let listArr: any[];
  try {
    listArr = JSON.parse(listDataMatch[1]);
  } catch {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const songs: PluginSearchResult[] = [];
  for (const item of listArr) {
    const parsed = parseKgSong(item);
    if (parsed) songs.push(parsed);
  }

  const listInfoMatch = body.match(/global\s*=\s*\{[\s\S]+?name:\s*"(.+?)"[\s\S]+?pic:\s*"(.+?)"[\s\S]+?};/);
  const info: PlaylistInfo = {
    name: listInfoMatch ? decodeName(listInfoMatch[1]) : '',
    img: listInfoMatch ? listInfoMatch[2] : '',
    desc: '',
    author: '',
    playCount: '',
  };

  return { source: 'kg', songs, total: songs.length, info };
}

function parseKgSong(item: any): PluginSearchResult | null {
  const hash = item.hash || '';
  const audioId = String(item.audio_id ?? '');
  if (!hash && !audioId) return null;

  const singerName = decodeName(item.singername || '');
  const songname = decodeName(item.songname || '');
  const albumName = decodeName(item.album_name || '');
  const durationMs = item.duration || 0;

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: songname,
    singer: singerName,
    source: 'kg',
    interval: formatPlayTime(Math.floor(durationMs / 1000)),
  };
  if (hash) rawData.hash = hash;

  return createSearchResult({
    id: songIdStr,
    title: songname,
    artist: singerName,
    album: albumName,
    coverUrl: '',
    duration: durationMs,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

async function getKgListDetailByGcid(rawId: string): Promise<PlaylistImportResult> {
  const gcidMatch = rawId.match(/gcid_(\w+)/);
  let globalCollectionId: string | null = null;

  if (gcidMatch) {
    const gcid = 'gcid_' + gcidMatch[1];
    try {
      globalCollectionId = await decodeGcid(gcid);
    } catch (e: any) {
      log(`getKgListDetailByGcid: decodeGcid failed: ${e?.message}`);
    }
  }

  if (!globalCollectionId && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    globalCollectionId = await resolveKgShareUrl(rawId);
  }

  if (!globalCollectionId) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  return getKgGcidDetail(globalCollectionId);
}

async function resolveKgShareUrl(url: string): Promise<string | null> {
  try {
    const resp = await httpFetch(url, 'GET', {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1',
      'Referer': url,
    });
    const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
    if (!body) return null;

    let m = body.match(/global_collection_id["']?\s*[:=]\s*["']?(\w+)/);
    if (m && m[1]) return m[1];

    const gcid = body.match(/"encode_gic"\s*:\s*"(\w+)"/)?.[1]
      || body.match(/"encode_src_gid"\s*:\s*"(\w+)"/)?.[1]
      || body.match(/encode_gic["']?\s*[:=]\s*["']?(\w+)/)?.[1]
      || body.match(/encode_src_gid["']?\s*[:=]\s*["']?(\w+)/)?.[1];

    if (gcid) {
      try {
        return await decodeGcid('gcid_' + gcid);
      } catch (e: any) {
        log(`resolveKgShareUrl: decodeGcid(${gcid}) failed: ${e?.message}`);
      }
    }

    return null;
  } catch (e: any) {
    log(`resolveKgShareUrl failed: ${e?.message}`);
    return null;
  }
}

async function decodeGcid(gcid: string): Promise<string> {
  const params = 'dfid=-&appid=1005&mid=0&clientver=20109&clienttime=640612895&uuid=-';
  const bodyStr = `{"ret_info":1,"data":[{"id":"${gcid}","id_type":2}]}`;
  const signature = await signatureParamsKg(params, 'android', bodyStr);
  const url = `https://t.kugou.com/v1/songlist/batch_decode?${params}&signature=${signature}`;

  const resp = await httpFetch(url, 'POST', {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HUAWEI HMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36',
    'Referer': 'https://m.kugou.com/',
    'Content-Type': 'application/json',
  }, bodyStr);

  const body = resp.body;
  if (typeof body !== 'object' || body === null) {
    throw new Error('decodeGcid: response not JSON');
  }

  const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
  if (errCode !== 0) {
    throw new Error(`decodeGcid failed: errcode=${errCode}`);
  }

  const list = body.data?.list || body.list || body.info?.list || body.data?.info;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('decodeGcid: missing or empty list');
  }

  const globalCollectionId = list[0].global_collection_id || list[0].global_specialid;
  if (!globalCollectionId) {
    throw new Error('decodeGcid: missing global_collection_id');
  }

  return globalCollectionId;
}

async function getKgUserListDetail2(globalCollectionId: string): Promise<PlaylistImportResult> {
  if (globalCollectionId.length > 1000) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const id = globalCollectionId;
  const commonHeaders: Record<string, string> = {
    'mid': '1586163242519',
    'Referer': 'https://m3ws.kugou.com/share/index.php',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
    'dfid': '-',
    'clienttime': '1586163242519',
  };

  const infoParams = `appid=1058&specialid=0&global_specialid=${id}&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-`;
  const infoSig = await signatureParamsKg(infoParams, 'web', '');
  const infoUrl = `https://mobiles.kugou.com/api/v5/special/info_v2?${infoParams}&signature=${infoSig}`;
  const infoResp = await httpFetch(infoUrl, 'GET', commonHeaders);
  const infoBody = infoResp.body;
  if (typeof infoBody !== 'object' || infoBody === null) {
    throw new Error('kg info_v2: response not JSON');
  }

  const errCode = infoBody.error_code ?? infoBody.errcode ?? infoBody.err_code ?? -1;
  if (errCode !== 0) {
    throw new Error(`kg info_v2 failed: errcode=${errCode}`);
  }

  const info = infoBody.data || infoBody;
  const songCount = info.songcount || 0;
  const playlistName = decodeName(info.specialname || '');
  const playlistImg = (info.imgurl || '').replace('{size}', '240');
  const playlistDesc = decodeName(info.intro || '');
  const playlistAuthor = decodeName(info.nickname || '');

  const hashList: any[] = [];
  let total = songCount;
  let p = 0;
  while (total > 0) {
    const limit = Math.min(total, 300);
    total -= limit;
    p++;
    const songParams = `appid=1058&global_specialid=${id}&specialid=0&plat=0&version=8000&page=${p}&pagesize=${limit}&srcappid=2919&clientver=20000&clienttime=1586163263991&mid=1586163263991&uuid=1586163263991&dfid=-`;
    const songSig = await signatureParamsKg(songParams, 'web', '');
    const songUrl = `https://mobiles.kugou.com/api/v5/special/song_v2?${songParams}&signature=${songSig}`;
    const songResp = await httpFetch(songUrl, 'GET', commonHeaders);
    const songBody = songResp.body;
    if (typeof songBody !== 'object' || songBody === null) break;

    const sErr = songBody.error_code ?? songBody.errcode ?? songBody.err_code ?? -1;
    if (sErr !== 0) break;

    const infoArr = songBody.data?.info || songBody.info || [];
    for (const item of infoArr) {
      hashList.push(item);
    }
  }

  const songs = await getKgMusicInfos(hashList);

  const infoObj: PlaylistInfo = {
    name: playlistName,
    img: playlistImg,
    desc: playlistDesc,
    author: playlistAuthor,
    playCount: '',
  };

  return { source: 'kg', songs, total: songs.length, info: infoObj };
}

// ==================== gcid 歌单 gateway 分页（对齐移动端 kg_sheet_import） ====================

/// gcid 歌单优先走 gateway get_other_list_file_nofilt 分页全量
/// （gcid 类型歌单用 song_v2 分页会报「歌单分页数据异常」），
/// 失败回落 getKgUserListDetail2（老歌单仍可用）。
async function getKgGcidDetail(gcol: string): Promise<PlaylistImportResult> {
  try {
    const gw = await getKgGcidDetailByGateway(gcol);
    if (gw && gw.songs.length > 0) return gw;
  } catch (e: any) {
    log(`getKgGcidDetail: gateway 分页失败: ${e?.message}`);
  }
  return getKgUserListDetail2(gcol);
}

async function getKgGcidDetailByGateway(
  gcol: string,
): Promise<PlaylistImportResult | null> {
  if (gcol.length > 1000) return null;

  const headers: Record<string, string> = {
    'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
  };

  const songs: PluginSearchResult[] = [];
  const seen = new Set<string>();
  let beginIdx = 0;
  let totalCount = -1;
  let page = 0;
  let name = '';
  let img = '';
  let author = '';

  while (totalCount < 0 || beginIdx < totalCount) {
    page += 1;
    if (page > 10000) return null; // 歌单分页超出合理范围
    const clienttimeSec = String(Math.floor(Date.now() / 1000));
    const params =
      'area_code=1&appid=1005&begin_idx=' + beginIdx +
      '&clienttime=' + clienttimeSec +
      '&clientver=20489&extend_fields=abtags,hot_cmt,popularization' +
      '&global_collection_id=' + encodeURIComponent(gcol) +
      '&mode=1&pagesize=300&personal_switch=1&plat=1&type=1&uuid=-';
    const signature = await signatureParamsKg(params, 'android', '');
    const resp = await httpFetch(
      'https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt?' +
      params + '&signature=' + signature,
      'GET',
      headers,
    );
    const body = resp.body;
    if (typeof body !== 'object' || body === null) return null;
    const b = body as any;
    const status = b.status ?? b.err_code ?? b.error_code ?? -1;
    if (Number(status) !== 1) return null;
    const data = b.data;
    if (typeof data !== 'object' || data === null) return null;

    if (typeof data.list_info === 'object' && data.list_info) {
      const li = data.list_info;
      if (!name) name = decodeName(String(li.name ?? ''));
      if (!img) img = String(li.pic ?? '').replace('{size}', '400');
      if (!author) author = decodeName(String(li.list_create_username ?? ''));
    }

    const pageSongs: any[] = Array.isArray(data.songs) ? data.songs : [];
    if (pageSongs.length === 0) {
      if (totalCount > 0 && beginIdx < totalCount) return null; // 分页提前结束
      break;
    }
    const reported = Number(data.count ?? 0) || 0;
    if (reported > totalCount) totalCount = reported;
    let added = 0;
    for (const item of pageSongs) {
      if (typeof item !== 'object' || item === null) continue;
      const hash = String(item.hash ?? '');
      if (!hash) continue;
      const key = hash + '|' + String(item.audio_id ?? item.album_audio_id ?? 0) + '|' + String(item.name ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      const parsed = parseGatewaySong(item);
      if (parsed) {
        songs.push(parsed);
        added++;
      }
    }
    if (added <= 0) return null; // 分页重复
    beginIdx += pageSongs.length;
    if (totalCount < 0 && pageSongs.length < 300) break;
  }

  if (songs.length === 0) return null;
  await enrichKgGatewayCovers(songs);
  return { source: 'kg', songs, total: songs.length, info: { name, img, desc: '', author, playCount: '' } };
}

/// gateway get_other_list_file_nofilt 条目只带 albuminfo（专辑名），不带封面
/// （union_cover/cover 常为空）。移动端展示态按 hash 懒解析所以看起来正常，
/// 桌面端必须在导入期落库：按 hash 批量走 v2/album_audio/audio 取
/// album_info.sizable_cover（100 首/批，签名链路与 getKgMusicInfos 一致）。
async function enrichKgGatewayCovers(songs: PluginSearchResult[]): Promise<void> {
  const missing = songs.filter(s => !s.coverUrl && !!(s.rawData as Record<string, any> | undefined)?.hash);
  if (missing.length === 0) return;

  const batches: PluginSearchResult[][] = [];
  for (let i = 0; i < missing.length; i += 100) {
    batches.push(missing.slice(i, i + 100));
  }

  await Promise.all(batches.map(async (batch) => {
    try {
      const key = await hostKugouRequestKey();
      const dataObj = {
        area_code: '1',
        show_privilege: 1,
        show_album_info: 1,
        is_publish: '',
        appid: 1005,
        clientver: 11451,
        mid: '1',
        dfid: '-',
        clienttime: Date.now(),
        key,
        fields: 'album_info,audio_info',
        data: batch.map(s => ({
          hash: String((s.rawData as Record<string, any>).hash),
          name: s.title,
          page_id: 0,
          type: 'audio',
          id: 0,
          album_audio_id: 0,
          album_id: '0',
        })),
      };

      const resp = await httpFetch(
        'http://gateway.kugou.com/v2/album_audio/audio',
        'POST',
        {
          'KG-THash': '13a3164',
          'KG-RC': '1',
          'KG-Fake': '0',
          'KG-RF': '00869891',
          'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
          'x-router': 'kmr.service.kugou.com',
          'Content-Type': 'application/json',
        },
        JSON.stringify(dataObj),
      );

      const body = resp.body;
      if (typeof body !== 'object' || body === null) return;

      const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
      if (errCode !== 0) return;

      const coverByHash = new Map<string, string>();
      const dataArr = body.data || [];
      for (const item of dataArr) {
        const first = Array.isArray(item) ? item[0] : item;
        if (!first) continue;
        const hash = String(first.audio_info?.hash ?? '').toLowerCase();
        const albumInfo = first.album_info || {};
        const rawCover = albumInfo.sizable_cover || albumInfo.cover
          || first.album_sizable_cover || first.union_cover || '';
        if (hash && rawCover) {
          coverByHash.set(hash, String(rawCover).replace('{size}', '400'));
        }
      }
      if (coverByHash.size === 0) return;

      for (const s of batch) {
        const hash = String((s.rawData as Record<string, any>).hash).toLowerCase();
        const cover = coverByHash.get(hash);
        if (cover) {
          s.coverUrl = cover;
          (s.rawData as Record<string, any>).union_cover = cover;
        }
      }
    } catch (e: any) {
      log(`enrichKgGatewayCovers batch failed: ${e?.message}`);
    }
  }));
}

/// gateway get_other_list_file_nofilt 条目 → PluginSearchResult。
/// 对齐移动端 _formatGatewayItem：name 为「歌手 - 歌名」合并格式需拆分。
function parseGatewaySong(item: any): PluginSearchResult | null {
  const hash = String(item.hash ?? '');
  if (!hash) return null;

  const rawName = String(item.name ?? '');
  let artist = String(item.singername ?? '');
  let title = rawName;
  if (rawName.includes(' - ')) {
    const parts = rawName.split(' - ');
    if (!artist) artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }
  if (!title) {
    const songname = String(item.songname ?? '');
    title = songname || rawName;
  }

  const audioId = String(item.audio_id ?? item.album_audio_id ?? '');
  const timelen = Number(item.timelen ?? 0) || 0;
  const trans = typeof item.trans_param === 'object' && item.trans_param ? item.trans_param : {};
  let coverUrl = String(trans.union_cover ?? item.cover ?? '');
  coverUrl = coverUrl.replace('{size}', '400');
  const albumName = decodeName(String(item.albuminfo?.name ?? item.remark ?? ''));

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: title,
    singer: artist || '未知歌手',
    source: 'kg',
    interval: formatPlayTime(Math.floor(timelen / 1000)),
  };
  if (hash) rawData.hash = hash;
  if (audioId) rawData.audioId = audioId;

  return createSearchResult({
    id: songIdStr,
    title,
    artist: artist || '未知歌手',
    album: albumName,
    coverUrl,
    duration: timelen,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

// ==================== 数字酷狗码 → t.kugou.com/command 反查 ====================

async function getKgListDetailByCode(
  code: string,
): Promise<PlaylistImportResult | null> {
  const resp = await httpFetch('http://t.kugou.com/command/', 'POST', {
    'Content-Type': 'application/json',
  }, JSON.stringify({
    appid: 1001,
    clientver: 9020,
    mid: '21511157a05844bd085308bc76ef3343',
    clienttime: 640612895,
    key: '36164c4015e704673c588ee202b9ecb8',
    data: code,
  }));
  const body = resp.body;
  if (typeof body !== 'object' || body === null) return null;
  const b = body as any;
  const status = b.status ?? b.err_code ?? b.error_code ?? -1;
  if (Number(status) !== 1) return null;
  const data = b.data;
  if (typeof data !== 'object' || data === null) return null;
  const info = typeof data.info === 'object' && data.info ? data.info : {};
  const name = decodeName(String(info.name ?? ''));
  const gcol = String(info.global_collection_id ?? '');
  if (gcol) {
    const result = await getKgGcidDetail(gcol);
    if (!result.info.name) result.info.name = name;
    return result;
  }
  // 老歌单：command 直出歌曲列表
  const list: any[] = Array.isArray(data.list) ? data.list : [];
  const songs = list
    .map(parseKgSong)
    .filter((s): s is PluginSearchResult => s !== null);
  if (songs.length === 0) return null;
  return { source: 'kg', songs, total: songs.length, info: { name, img: '', desc: '', author: '', playCount: '' } };
}

async function getKgMusicInfos(list: any[]): Promise<PluginSearchResult[]> {
  if (list.length === 0) return [];

  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const item of list) {
    const hash = item.hash || '';
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    deduped.push(item);
  }

  const batches: any[][] = [];
  for (let i = 0; i < deduped.length; i += 100) {
    batches.push(deduped.slice(i, i + 100));
  }

  const results = await Promise.all(batches.map(async (batch) => {
    try {
      const key = await hostKugouRequestKey();
      const dataObj = {
        area_code: '1',
        show_privilege: 1,
        show_album_info: 1,
        is_publish: '',
        appid: 1005,
        clientver: 11451,
        mid: '1',
        dfid: '-',
        clienttime: Date.now(),
        key,
        fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
        data: batch,
      };

      const resp = await httpFetch(
        'http://gateway.kugou.com/v2/album_audio/audio',
        'POST',
        {
          'KG-THash': '13a3164',
          'KG-RC': '1',
          'KG-Fake': '0',
          'KG-RF': '00869891',
          'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
          'x-router': 'kmr.service.kugou.com',
          'Content-Type': 'application/json',
        },
        JSON.stringify(dataObj),
      );

      const body = resp.body;
      if (typeof body !== 'object' || body === null) return [];

      const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
      if (errCode !== 0) return [];

      const dataArr = body.data || [];
      const songs: PluginSearchResult[] = [];
      for (const item of dataArr) {
        const first = Array.isArray(item) ? item[0] : item;
        if (first) {
          const parsed = parseKgSongDetailV2(first);
          if (parsed) songs.push(parsed);
        }
      }
      return songs;
    } catch (e: any) {
      log(`getKgMusicInfos batch failed: ${e?.message}`);
      return [];
    }
  }));

  return results.flat();
}

function parseKgSongDetailV2(item: any): PluginSearchResult | null {
  const audioInfo = item.audio_info || {};
  const albumInfo = item.album_info || {};
  const hash = audioInfo.hash || '';
  const audioId = String(audioInfo.audio_id ?? '');
  if (!hash && !audioId) return null;

  const singerName = decodeName(item.author_name || '');
  const songname = decodeName(item.songname || '');
  const albumName = decodeName(albumInfo.album_name || '');
  const albumCover = String(albumInfo.sizable_cover || albumInfo.cover || '')
    .replace('{size}', '400');
  const durationMs = audioInfo.timelength || 0;

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: songname,
    singer: singerName,
    source: 'kg',
    interval: formatPlayTime(Math.floor(durationMs / 1000)),
  };
  if (hash) rawData.hash = hash;

  return createSearchResult({
    id: songIdStr,
    title: songname,
    artist: singerName,
    album: albumName,
    coverUrl: albumCover,
    duration: durationMs,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

export async function fetchKgTrackMetaByIds(
  items: { id: string; title?: string; artist?: string }[],
  albumId?: string,
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  if (items.length === 0) return patches;

  const hashIndex = new Map<string, { durationMs: number; coverUrl: string }>();
  const numIndex = new Map<string, { durationMs: number; coverUrl: string }>();
  const register = (hash: any, nums: any[], durationSec: number, coverUrl: string) => {
    if (durationSec <= 0) return;
    const entry = { durationMs: durationSec * 1000, coverUrl: coverUrl || '' };
    const h = String(hash || '').trim().toLowerCase();
    if (h) hashIndex.set(h, entry);
    for (const n of nums) {
      const key = String(n ?? '').trim();
      if (key && /^\d+$/.test(key)) numIndex.set(key, entry);
    }
  };
  const lookup = (id: string): { durationMs: number; coverUrl: string } | undefined =>
    hashIndex.get(id.toLowerCase()) || numIndex.get(id);

  if (albumId && /^\d+$/.test(albumId)) {
    try {
      const resp = await httpFetch(
        `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${albumId}&page=1&pagesize=-1`,
        'GET',
        { Referer: 'https://www.kugou.com/' },
      );
      const info = ((resp.body as any)?.data?.info || []) as any[];
      for (const track of info) {
        register(track.hash, [track.audio_id, track.album_audio_id, track.mixsongid], Number(track.duration) || 0, '');
      }
    } catch { /* 专辑接口失败走搜索兜底 */ }
  }

  let searched = 0;
  for (const item of items) {
    const hit = lookup(item.id);
    if (hit) {
      patches.set(item.id, hit);
      continue;
    }
    if (!item.title || searched >= 40) continue;
    searched++;
    try {
      const resp = await httpFetch(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(item.title)}` +
        `&page=1&pagesize=30&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`,
        'GET',
        { Referer: 'https://www.kugou.com/' },
      );
      const lists = ((resp.body as any)?.data?.lists || []) as any[];
      for (const track of lists) {
        register(track.FileHash, [track.MixSongID, track.Audioid, track.AudioId], Number(track.Duration) || 0, '');
        const m = lookup(item.id);
        if (m) {
          patches.set(item.id, m);
          break;
        }
      }
    } catch { /* 逐首失败忽略 */ }
  }

  return patches;
}

export { getListDetailKg };