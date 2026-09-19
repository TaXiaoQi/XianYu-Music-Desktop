import {
  STRINGIFIED_TRACK_ID_BACKUP_VERSION,
  type SupportedPluginBackupFormat,
} from './pluginBackupTypes';


interface DetectedBackup {
  format: SupportedPluginBackupFormat;
  sheets: any[];
  version: number | null;
  restoreStringifiedIds: boolean;
}

function inferFormatFromSongFields(sheets: any[]): SupportedPluginBackupFormat | null {
  let bakaScore = 0;
  let mfScore = 0;
  let sampleCount = 0;
  const MAX_SAMPLES = 50;

  for (const sheet of sheets) {
    const musicList = Array.isArray(sheet?.musicList) ? sheet.musicList : [];
    for (const song of musicList) {
      if (sampleCount >= MAX_SAMPLES) break;
      sampleCount++;

      if (typeof song.artist === 'string' && song.artist.trim()) bakaScore += 2;
      if (typeof song.title === 'string' && song.title.trim() && !song.name) bakaScore += 1;
      if (typeof song.album === 'string' && song.album.trim() && !song.albumName) bakaScore += 1;

      if (typeof song.singer === 'string' && song.singer.trim()) mfScore += 2;
      if (typeof song.name === 'string' && song.name.trim() && !song.title) mfScore += 1;
      if (typeof song.albumName === 'string' && song.albumName.trim()) mfScore += 1;
      if (song.musicId !== undefined && song.id === undefined) mfScore += 2;
    }
    if (sampleCount >= MAX_SAMPLES) break;
  }

  if (sampleCount === 0) return null;
  const threshold = Math.max(sampleCount * 0.3, 2);
  if (bakaScore > mfScore + threshold) return 'bakamusic';
  if (mfScore > bakaScore + threshold) return 'musicfree';
  return null;
}

function getBackupIdentityFields(data: any): string[] {
  return [
    data?.author,
    data?.creator,
    data?.exportedBy,
    data?.appName,
    data?.app,
    data?.data?.author,
    data?.data?.creator,
    data?.schema,
  ]
    .filter((field): field is string => typeof field === 'string')
    .map(field => field.normalize('NFKC').trim().toLowerCase());
}

function hasToskysunSignature(data: any): boolean {
  return getBackupIdentityFields(data).some(field => field.includes('toskysun'));
}

function hasMusicFreeAuthorSignature(data: any): boolean {
  return getBackupIdentityFields(data).some(field => field.includes('时迁酱'));
}

function flattenLxMeta(rawSong: any): any {
  if (!rawSong?.meta || typeof rawSong.meta !== 'object') return rawSong;
  const { meta, ...rest } = rawSong;
  return {
    ...meta,
    qualities: meta._qualitys ?? rest.qualities,
    img: meta.picUrl ?? rest.img,
    localPath: meta.filePath ?? rest.localPath,
    ...rest,
  };
}

export function detectBackup(data: any): DetectedBackup {
  const version = typeof data?.version === 'number' ? data.version : null;

  const lxData = data?.type === 'myList' && data?.data ? data.data
    : data?.type === 'allData_v3' && data?.data?.lists ? data.data.lists
    : data;

  const lxBackupType = data?.type;
  const lxBackupLists: any[] | null =
    (lxBackupType === 'allData_v2' || lxBackupType === 'allData') && Array.isArray(data?.playList)
      ? data.playList
      : (lxBackupType === 'playList_v3' || lxBackupType === 'playList_v2' || lxBackupType === 'playList') && Array.isArray(data?.data)
        ? data.data
        : null;
  if (lxBackupLists) {
    const sheets: any[] = [];
    for (const list of lxBackupLists) {
      if (!Array.isArray(list?.list) || list.list.length === 0) continue;
      sheets.push({ name: list.name || '未命名歌单', musicList: list.list.map(flattenLxMeta) });
    }
    return { format: 'lxmusic', sheets, version: null, restoreStringifiedIds: false };
  }

  if (lxBackupType === 'setting_v2' || lxBackupType === 'setting') {
    throw new Error('未找到可导入的歌单');
  }

  if (Array.isArray(lxData?.defaultList) || Array.isArray(lxData?.loveList) || Array.isArray(lxData?.userList)) {
    const sheets: any[] = [];
    if (Array.isArray(lxData.loveList) && lxData.loveList.length > 0) {
      sheets.push({ name: '我的收藏', musicList: lxData.loveList.map(flattenLxMeta) });
    }
    if (Array.isArray(lxData.userList)) {
      for (const list of lxData.userList) {
        if (Array.isArray(list?.list) && list.list.length > 0) {
          sheets.push({ name: list.name || '未命名歌单', musicList: list.list.map(flattenLxMeta) });
        }
      }
    }
    if (Array.isArray(lxData.defaultList) && lxData.defaultList.length > 0) {
      sheets.push({ name: '试听列表', musicList: lxData.defaultList.map(flattenLxMeta) });
    }
    return { format: 'lxmusic', sheets, version: null, restoreStringifiedIds: false };
  }

  if (typeof data?.schema === 'string' && data.schema.startsWith('bakamusic')) {
    const sheets = Array.isArray(data?.data?.musicSheets) ? data.data.musicSheets
      : Array.isArray(data?.musicSheets) ? data.musicSheets
      : [];
    return {
      format: 'bakamusic',
      sheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  const nestedSheets = Array.isArray(data?.data?.musicSheets) ? data.data.musicSheets : null;
  const topLevelSheets = Array.isArray(data?.musicSheets) ? data.musicSheets : null;
  const identifiedSheets = nestedSheets ?? topLevelSheets ?? [];

  if (hasToskysunSignature(data)) {
    return {
      format: 'bakamusic',
      sheets: identifiedSheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  if (hasMusicFreeAuthorSignature(data)) {
    return {
      format: 'musicfree',
      sheets: identifiedSheets,
      version,
      restoreStringifiedIds: false,
    };
  }


  if (nestedSheets) {
    const inferred = inferFormatFromSongFields(nestedSheets);
    if (inferred === 'musicfree') {
      return { format: 'musicfree', sheets: nestedSheets, version, restoreStringifiedIds: false };
    }
    return {
      format: 'bakamusic',
      sheets: nestedSheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  if (topLevelSheets) {
    const inferred = inferFormatFromSongFields(topLevelSheets);
    if (inferred === 'bakamusic') {
      return {
        format: 'bakamusic',
        sheets: topLevelSheets,
        version,
        restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
      };
    }
    return { format: 'musicfree', sheets: topLevelSheets, version, restoreStringifiedIds: false };
  }

  throw new Error('无法识别备份格式，请选择 BakaMusic、MusicFree 或洛雪音乐导出的备份文件');
}