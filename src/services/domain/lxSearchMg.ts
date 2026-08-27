import { formatSingerName } from '../../utils/musicFormat';
import { hostMiguSign } from '../tauri/hostCryptoApi';
import {
  formatPlayTime,
  httpGetJson,
  sizeFormate,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';

/**
 * LX 平台搜索层 · MG (咪咕)。
 * 仅依赖 lxMusicSdkBase 与 hostCryptoApi，作为叶子模块被 lxSearchPlatform 门面 re-export。
 */

// ==================== MG (咪咕) Search ====================

export async function mgCreateSignature(time: string, str: string): Promise<{ sign: string; deviceId: string }> {
  return hostMiguSign(str, time);
}

function mgFilterData(rawData: any[][]): LxSearchResultItem[] {
  const list: LxSearchResultItem[] = [];
  const ids = new Set<string>();
  rawData.forEach(item => {
    item.forEach(data => {
      if (!data.songId || !data.copyrightId || ids.has(data.copyrightId)) return;
      ids.add(data.copyrightId);
      const types: LxSearchResultItem['types'] = [];
      const _types: LxSearchResultItem['_types'] = {};
      if (data.audioFormats) {
        data.audioFormats.forEach((type: any) => {
          let size: string | null;
          switch (type.formatType) {
            case 'PQ':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: '128k', size });
              _types['128k'] = { size };
              break;
            case 'HQ':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: '320k', size });
              _types['320k'] = { size };
              break;
            case 'SQ':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: 'flac', size });
              _types.flac = { size };
              break;
            case 'ZQ24':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: 'flac24bit', size });
              _types.flac24bit = { size };
              break;
          }
        });
      }
      let img: string | null = data.img3 || data.img2 || data.img1 || null;
      if (img && !/https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img;
      list.push({
        singer: formatSingerName(data.singerList),
        name: data.name,
        albumName: data.album,
        albumId: data.albumId,
        songmid: data.songId,
        copyrightId: data.copyrightId,
        source: 'mg',
        interval: formatPlayTime(data.duration),
        img,
        lrcUrl: data.lrcUrl,
        mrcUrl: data.mrcurl,
        trcUrl: data.trcUrl,
        types,
        _types,
      });
    });
  });
  return list;
}

export async function searchMg(str: string, page = 1, limit = 20, retryNum = 0): Promise<LxSearchResult> {
  if (++retryNum > 3) throw new Error('MG search: try max num');
  const time = Date.now().toString();
  const signData = await mgCreateSignature(time, str);
  const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`;
  const result = await httpGetJson(url, {
    uiVersion: 'A_music_3.6.1',
    deviceId: signData.deviceId,
    timestamp: time,
    sign: signData.sign,
    channel: '0146921',
    'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
  });
  if (!result || result.code !== '000000') throw new Error(result ? result.info : 'MG搜索失败');
  const songResultData = result.songResultData || { resultList: [], totalCount: 0 };
  const list = mgFilterData(songResultData.resultList);
  if (list == null) return searchMg(str, page, limit, retryNum);
  const total = parseInt(songResultData.totalCount);
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'mg',
  };
}