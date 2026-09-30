import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  httpFetch,
  log,
  type PlaylistImportResult,
  type PlaylistInfo,
} from './playlistImportBase';


// ==================== 常量（与移动端 qishui_sheet_import.dart 对齐） ====================

const PC_BASE = 'https://api.qishui.com/luna/pc';
const PC_QUERY =
  'aid=386088&app_name=luna_pc&region=cn&geo_region=cn&os_region=cn' +
  '&sim_region=&device_id=2081836196178571&cdid=&iid=2081836196182667' +
  '&version_name=3.8.0&version_code=30080000&channel=official' +
  '&build_mode=master&network_carrier=&ac=wifi&tz_name=Asia/Shanghai' +
  '&resolution=&device_platform=windows&device_type=Windows' +
  '&os_version=Windows%2011%20Pro%20for%20Workstations' +
  '&fp=2081836196178571';
const PC_HEADERS: Record<string, string> = {
  'Accept': '*/*',
  'Content-Type': 'application/json; charset=utf-8',
  'Accept-Encoding': 'gzip, deflate',
  'User-Agent': 'LunaPC/3.8.0(467160162)',
  'x-luna-background-type': 'foreground',
  'x-luna-is-background-req': '0',
  'x-luna-is-local-user': '0',
};
const WEB_SHARE_URL = 'https://music.douyin.com/qishui/share/playlist';
const WEB_SHARE_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};
const DOUYIN_IMAGE_BASE = 'https://p3-luna.douyinpic.com/img/';

const QUALITY_TO_BAKA: Record<string, string> = {
  medium: '128k',
  higher: '192k',
  highest: '320k',
  lossless: 'flac',
  hi_res: 'hires',
  spatial: 'atmos',
};
const FALLBACK_BITRATE: Record<string, number> = {
  medium: 128000,
  higher: 192000,
  highest: 320000,
  lossless: 1411000,
  hi_res: 2304000,
  spatial: 324000,
};

// ==================== 关键词/来源判定 ====================

export function isQishuiKeyword(keyword: string): boolean {
  const t = (keyword || '').trim().toLowerCase();
  return t.includes('qishui') || (keyword || '').includes('汽水') || t.includes('douyin.com');
}

export function isQishuiSource(name: string, sources: string[]): boolean {
  const n = (name || '').toLowerCase();
  if (n.includes('汽水') || n.includes('qishui')) return true;
  for (const s of sources || []) {
    const t = (s || '').trim().toLowerCase();
    if (t === 'qishui' || t.includes('汽水') || t.includes('qishui')) return true;
  }
  return false;
}

// ==================== 歌单详情 ====================

export async function getListDetailQishui(rawId: string): Promise<PlaylistImportResult> {
  const id = await extractQishuiId(rawId || '');
  if (!id) {
    return { source: 'qishui', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const detail = await fetchPlaylistDetail(id);
  if (!detail || detail.mediaResources.length === 0) {
    return { source: 'qishui', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const songs: PluginSearchResult[] = [];
  for (const raw of detail.mediaResources) {
    const parsed = formatTrack(raw);
    if (parsed) songs.push(parsed);
  }
  if (songs.length === 0) {
    return { source: 'qishui', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const sheet = parsePlaylistItem(detail.playlistInfo);
  const info: PlaylistInfo = {
    name: sheet.title,
    img: sheet.artwork,
    desc: sheet.description,
    author: sheet.artist,
    playCount: String(sheet.worksNum || songs.length),
  };

  return { source: 'qishui', songs, total: sheet.worksNum > 0 ? sheet.worksNum : songs.length, info };
}

// ==================== ID 提取（抄 extractQishuiId） ====================

async function extractQishuiId(input: string): Promise<string | null> {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  const plainId = trimmed.match(/^(\d+)$/)?.[1];
  if (plainId) return plainId;

  const directId = extractIdFromUrl(trimmed);
  if (directId) return directId;

  const longId = trimmed.match(/\b\d{10,}\b/)?.[0];
  if (longId) return longId;

  const urls = trimmed.match(/https?:\/\/[^\s@]+/g) || [];
  for (const url of urls) {
    const urlId = extractIdFromUrl(url);
    if (urlId) return urlId;
    const lower = url.toLowerCase();
    if (lower.includes('douyin.com/s/') || lower.includes('qishui.douyin.com')) {
      const redirectedId = await resolveRedirectId(url);
      if (redirectedId) return redirectedId;
    }
  }
  return null;
}

function extractIdFromUrl(url: string): string | null {
  let m = url.match(/playlist\/([\d]+)/)?.[1];
  if (m) return m;
  m = url.match(/[?&]playlist_id=([\d]+)/)?.[1];
  if (m) return m;
  m = url.match(/[?&]ugc_video_id=([\d]+)/)?.[1];
  if (m) return m;
  m = url.match(/[?&]id=([\d]+)/)?.[1];
  if (m) return m;
  return null;
}

/// 短链解析：读 location 逐跳跟随；落地页直接正则提取
async function resolveRedirectId(url: string): Promise<string | null> {
  try {
    const resp = await httpFetch(url, 'GET', WEB_SHARE_HEADERS);
    const location = resp.headers?.['location'] || resp.headers?.['Location'] || '';
    if (location) {
      const id = extractIdFromUrl(location);
      if (id) return id;
      const lower = location.toLowerCase();
      if (lower.includes('douyin.com/s/') || lower.includes('qishui.douyin.com')) {
        return await resolveRedirectId(location);
      }
    }
    // httpFetch 可能已自动跟随重定向：从落地页内容提取
    const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
    if (body) {
      let m = body.match(/playlist\/(\d+)/)?.[1];
      if (m) return m;
      m = body.match(/[?&]playlist_id=(\d+)/)?.[1];
      if (m) return m;
      m = body.match(/[?&]id=(\d+)/)?.[1];
      if (m) return m;
    }
    return null;
  } catch (e: any) {
    log(`[qs-import] 短链解析失败: ${e?.message}`);
    return null;
  }
}

// ==================== 歌单详情（PC API → web 兜底） ====================

interface QishuiPlaylistDetail {
  playlistInfo: Record<string, any> | null;
  mediaResources: Record<string, any>[];
}

async function fetchPlaylistDetail(id: string): Promise<QishuiPlaylistDetail | null> {
  const apiDetail = await fetchFromApi(id);
  if (apiDetail && apiDetail.mediaResources.length > 0) return apiDetail;

  const webDetail = await fetchFromWeb(id);
  if (webDetail && webDetail.mediaResources.length > 0) {
    const infoId = String(webDetail.playlistInfo?.id ?? '');
    if (infoId === id) return webDetail;
  }
  return null;
}

async function fetchFromApi(id: string): Promise<QishuiPlaylistDetail | null> {
  let cursor = '';
  let playlistInfo: Record<string, any> | null = null;
  const resources: Record<string, any>[] = [];
  const seenCursors = new Set<string>();
  for (let page = 0; page < 10000; page++) {
    const resp = await httpFetch(
      `${PC_BASE}/playlist/detail?${PC_QUERY}&playlist_id=${id}&cursor=${encodeURIComponent(cursor)}&count=100`,
      'GET',
      PC_HEADERS,
    );
    const data = resp.body;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.media_resources)) {
      if (page === 0) return null;
      throw new Error('[汽水音乐] 歌单分页数据异常');
    }
    if (!playlistInfo && typeof data.playlist === 'object' && data.playlist !== null) {
      playlistInfo = data.playlist;
    }
    for (const item of data.media_resources) {
      if (item && typeof item === 'object') resources.push(item);
    }
    const hasMore = data.has_more === true || data.has_more === 1 || data.has_more === '1';
    if (!hasMore) {
      return { playlistInfo, mediaResources: resources };
    }
    const next = String(data.next_cursor ?? '');
    if (resources.length === 0 || !next || next === cursor || seenCursors.has(next)) {
      throw new Error('[汽水音乐] 歌单分页游标未推进');
    }
    seenCursors.add(next);
    cursor = next;
  }
  return null;
}

async function fetchFromWeb(id: string): Promise<QishuiPlaylistDetail | null> {
  try {
    const resp = await httpFetch(`${WEB_SHARE_URL}?playlist_id=${id}`, 'GET', WEB_SHARE_HEADERS);
    const html = typeof resp.body === 'string' ? resp.body : '';
    if (!html) return null;
    const routerData = extractRouterData(html);
    if (!routerData) return null;
    const loaderData = routerData.loaderData;
    const playlistPage = loaderData && typeof loaderData === 'object' ? loaderData.playlist_page : null;
    if (!playlistPage || typeof playlistPage !== 'object') return null;
    const info = playlistPage.playlistInfo;
    const medias = playlistPage.medias;
    return {
      playlistInfo: info && typeof info === 'object' ? info : null,
      mediaResources: Array.isArray(medias) ? medias.filter((e: any) => e && typeof e === 'object') : [],
    };
  } catch (e: any) {
    log(`[qs-import] web 分享页解析失败: ${e?.message}`);
    return null;
  }
}

function extractRouterData(html: string): Record<string, any> | null {
  const assignment = '_ROUTER_DATA = ';
  const start = html.indexOf(assignment);
  if (start === -1) return null;
  const jsonStart = start + assignment.length;
  let jsonEnd = html.indexOf(';\nfunction runWindowFn', jsonStart);
  if (jsonEnd === -1) {
    jsonEnd = html.indexOf(';</script>', jsonStart);
  }
  if (jsonEnd === -1) return null;
  try {
    const decoded = JSON.parse(html.substring(jsonStart, jsonEnd));
    return decoded && typeof decoded === 'object' ? decoded : null;
  } catch {
    return null;
  }
}

// ==================== 条目格式化（抄 parseTrackItem） ====================

function normalizeTrack(raw: Record<string, any>): Record<string, any> {
  const entity = raw.entity;
  if (entity && typeof entity === 'object') {
    const tw = entity.track_wrapper;
    if (tw && typeof tw === 'object' && tw.track && typeof tw.track === 'object') return tw.track;
    if (entity.track && typeof entity.track === 'object') return entity.track;
    if (entity.video && typeof entity.video === 'object') return entity.video;
    if (entity.ugc_video && typeof entity.ugc_video === 'object') return entity.ugc_video;
  }
  if (raw.track && typeof raw.track === 'object') return raw.track;
  return raw;
}

function formatTrack(raw: Record<string, any>): PluginSearchResult | null {
  const track = normalizeTrack(raw);
  const isVideo = isVideoTrack(raw, track);
  const album = track.album && typeof track.album === 'object' ? track.album : null;
  const videoId = firstText(track.video_id, track.ugc_video_id, track.id, track.vid);
  const artwork = firstNotEmpty([
    buildImageUrlFromCover(album?.url_cover),
    buildImageUrlFromCover(track.cover_url),
    firstUrlList(track.image_url),
    firstUrlList(track.share_cover_url),
    track.coverURL,
    track.firstFrameURL,
  ]);
  const artistEntries = asMapList(track.artists);
  if (artistEntries.length === 0 && track.author_info && typeof track.author_info === 'object') {
    artistEntries.push(track.author_info);
  }
  const singerList = buildSingerList(artistEntries);
  const primary = singerList.length > 0 ? singerList[0] : null;
  const labelInfo = track.label_info && typeof track.label_info === 'object' ? track.label_info : null;
  const fee = labelInfo?.only_vip_playable === true ? 1 : 0;
  const id = String(track.id ?? '');
  const finalId = id || videoId;
  const title = firstNotEmpty([track.name, track.title, track.videoName, track.desc, '']);
  const artist = firstNotEmpty([primary?.name, track.artistName, track.author, '']);
  if (!finalId) return null;

  const durationSec = normalizeDurationSeconds(track.duration ?? track.duration_ms);

  const item: Record<string, any> = {
    id: finalId,
    title,
    artist,
    singerList,
    album: album?.name ?? '',
    albumId: String(album?.id ?? ''),
    artwork,
    duration: durationSec,
    qualities: qualitiesFromBitRates(track.bit_rates),
    fee,
    is_video: isVideo ? true : null,
    videoId: isVideo ? videoId : null,
    vid: isVideo ? videoId : firstText(track.vid, track.video_id),
    // 宿主补充键：兼容播放链
    songmid: finalId,
    name: title,
    singer: artist,
    source: 'qishui',
  };

  return createSearchResult({
    id: finalId,
    title,
    artist,
    album: item.album,
    coverUrl: artwork,
    duration: (durationSec ?? 0) * 1000,
    platform: '汽水音乐',
    sourceKey: 'qishui',
    rawData: item,
  });
}

function isVideoTrack(raw: Record<string, any>, track: Record<string, any>): boolean {
  const entity = raw.entity;
  if (entity && typeof entity === 'object' && (entity.video || entity.ugc_video)) return true;
  if (raw.type === 'video' || raw.media_type === 'video') return true;
  if (track.video_id != null || track.ugc_video_id != null) return true;
  if (track.type === 'ugc_video' || track.video_type === 'ugc_video') return true;
  if (track.media_type === 'ugc_video') return true;
  if (track.videoName != null) return true;
  return false;
}

function buildSingerList(artists: Record<string, any>[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const artist of artists) {
    const userInfo = artist.user_info && typeof artist.user_info === 'object'
      ? artist.user_info
      : (artist.author_info && typeof artist.author_info === 'object' ? artist.author_info : artist);
    const avatar = firstNotEmpty([
      userInfo.avatar,
      buildImageUrlFromCover(userInfo.url_avatar, '100:100'),
      buildImageUrlFromCover(userInfo.medium_avatar_url, '100:100'),
      buildImageUrlFromCover(userInfo.thumb_avatar_url, '100:100'),
      '',
    ]);
    const id = String(userInfo.id ?? artist.id ?? '');
    const name = firstNotEmpty([userInfo.name, userInfo.nickname, artist.name, '']);
    if (id || name) out.push({ id, name, avatar });
  }
  return out;
}

function qualitiesFromBitRates(bitRatesRaw: any): Record<string, Record<string, any>> {
  const qualities: Record<string, Record<string, any>> = {};
  const spatialEntries: Record<string, any>[] = [];
  for (const item of asMapList(bitRatesRaw)) {
    const qishuiQuality = String(item.quality ?? '');
    const bitrate = typeof item.br === 'number' ? item.br : FALLBACK_BITRATE[qishuiQuality];
    if (qishuiQuality === 'spatial') {
      spatialEntries.push({ size: item.size, bitrate, qishuiQuality });
      continue;
    }
    const qualityKey = QUALITY_TO_BAKA[qishuiQuality];
    if (!qualityKey) continue;
    if (!qualities[qualityKey]) {
      qualities[qualityKey] = { size: item.size, bitrate, qishuiQuality };
    }
  }
  // spatial（全景声）在导入场景取首个条目映射为 atmos
  if (spatialEntries.length > 0 && !qualities.atmos) {
    qualities.atmos = spatialEntries[0];
  }
  return qualities;
}

// ==================== 歌单信息（抄 parsePlaylistItem） ====================

function parsePlaylistItem(raw: Record<string, any> | null): {
  title: string; artist: string; artwork: string; description: string; worksNum: number;
} {
  if (!raw) return { title: '', artist: '', artwork: '', description: '', worksNum: 0 };
  const owner = raw.owner && typeof raw.owner === 'object' ? raw.owner : null;
  const userBrief = raw.user_artist_info && typeof raw.user_artist_info === 'object'
    ? raw.user_artist_info.user_brief : null;
  const worksNum = asInt(raw.count_tracks)
    ?? (raw.resource_cnt && typeof raw.resource_cnt === 'object' ? asInt(raw.resource_cnt.track_cnt) : null)
    ?? 0;
  return {
    title: firstNotEmpty([raw.title, raw.public_title, raw.name, '']),
    artist: firstNotEmpty([owner?.nickname, userBrief?.nickname, '']),
    artwork: buildImageUrlFromCover(raw.url_cover),
    description: String(raw.desc ?? ''),
    worksNum,
  };
}

// ==================== 工具 ====================

function buildImageUrlFromCover(urlCover: any, size = '960:960'): string {
  if (urlCover == null) return '';
  if (typeof urlCover === 'string') return urlCover;
  if (typeof urlCover !== 'object') return '';
  const uri = String(urlCover.uri ?? '');
  const templatePrefix = String(urlCover.template_prefix ?? '');
  if (uri && templatePrefix) {
    return `${DOUYIN_IMAGE_BASE}${uri}~${templatePrefix}-resize:${size}.png`;
  }
  if (Array.isArray(urlCover.urls)) {
    const urls = urlCover.urls.map((e: any) => String(e ?? '')).filter((e: string) => e);
    if (urls.length > 0) {
      if (!uri || urls[0].includes(uri)) return urls[0];
      return `${urls[0]}${uri}`;
    }
  }
  return '';
}

function firstUrlList(cover: any): string {
  if (cover && typeof cover === 'object' && Array.isArray(cover.urls)) {
    for (const u of cover.urls) {
      const s = String(u ?? '');
      if (s) return s;
    }
  }
  return '';
}

function firstText(...vals: any[]): string {
  for (const v of vals) {
    const s = String(v ?? '');
    if (s && s !== 'null') return s;
  }
  return '';
}

function firstNotEmpty(candidates: any[]): string {
  for (const c of candidates) {
    const s = String(c ?? '');
    if (s) return s;
  }
  return '';
}

function asInt(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return null;
}

function normalizeDurationSeconds(duration: any): number | null {
  const n = asInt(duration);
  if (n == null || n <= 0) return null;
  return n > 10000 ? Math.trunc(n / 1000) : n;
}

function asMapList(v: any): Record<string, any>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e: any) => e && typeof e === 'object' && !Array.isArray(e));
}
