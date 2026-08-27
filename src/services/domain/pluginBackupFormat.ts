import {
  STRINGIFIED_TRACK_ID_BACKUP_VERSION,
  type SupportedPluginBackupFormat,
} from './pluginBackupTypes';

/**
 * 插件备份导出导入 · 格式/版本检测。
 * 识别 BakaMusic / MusicFree / 洛雪音乐 三种备份格式及其版本，
 * 决定是否需要还原字符串化的数字歌曲 ID。被 pluginBackupImport 门面编排复用。
 */

interface DetectedBackup {
  format: SupportedPluginBackupFormat;
  sheets: any[];
  /** 备份声明的版本号；缺失或非数字时为 null */
  version: number | null;
  /** 是否需要还原被字符串化的数字 ID */
  restoreStringifiedIds: boolean;
}

/**
 * 通过分析歌曲数据中的字段特征来推断备份来源。
 *
 * BakaMusic 歌曲倾向使用：artist, title, album
 * MusicFree 歌曲倾向使用：singer, name, albumName
 *
 * 通过统计这些特征字段的出现比例来判断格式。
 */
function inferFormatFromSongFields(sheets: any[]): SupportedPluginBackupFormat | null {
  let bakaScore = 0;
  let mfScore = 0;
  let sampleCount = 0;
  const MAX_SAMPLES = 50; // 只采样前 50 首歌曲，避免大文件解析过慢

  for (const sheet of sheets) {
    const musicList = Array.isArray(sheet?.musicList) ? sheet.musicList : [];
    for (const song of musicList) {
      if (sampleCount >= MAX_SAMPLES) break;
      sampleCount++;

      // BakaMusic 特征：使用 artist（而非 singer）
      if (typeof song.artist === 'string' && song.artist.trim()) bakaScore += 2;
      // BakaMusic 特征：使用 title（而非 name）作为歌曲名
      if (typeof song.title === 'string' && song.title.trim() && !song.name) bakaScore += 1;
      // BakaMusic 特征：使用 album（而非 albumName）
      if (typeof song.album === 'string' && song.album.trim() && !song.albumName) bakaScore += 1;

      // MusicFree 特征：使用 singer（而非 artist）
      if (typeof song.singer === 'string' && song.singer.trim()) mfScore += 2;
      // MusicFree 特征：使用 name（而非 title）作为歌曲名
      if (typeof song.name === 'string' && song.name.trim() && !song.title) mfScore += 1;
      // MusicFree 特征：使用 albumName（而非 album）
      if (typeof song.albumName === 'string' && song.albumName.trim()) mfScore += 1;
      // MusicFree 特征：使用 musicId（BakaMusic 用 id）
      if (song.musicId !== undefined && song.id === undefined) mfScore += 2;
    }
    if (sampleCount >= MAX_SAMPLES) break;
  }

  // 需要明显的差异才做判断，避免误判
  if (sampleCount === 0) return null;
  const threshold = Math.max(sampleCount * 0.3, 2); // 至少有 30% 的差异或 2 分
  if (bakaScore > mfScore + threshold) return 'bakamusic';
  if (mfScore > bakaScore + threshold) return 'musicfree';
  return null;
}

/**
 * 检测备份数据中是否包含 Toskysun 标识（BakaMusic 的开发者）。
 * 如果存在则一定是 BakaMusic 格式。
 */
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

/**
 * 检测明确的 MusicFree 作者标识。
 * 时迁酱的插件可能带有类似 Baka 的音质字段，因此身份标识应优先于结构和字段推断。
 */
function hasMusicFreeAuthorSignature(data: any): boolean {
  return getBackupIdentityFields(data).some(field => field.includes('时迁酱'));
}

/**
 * 将洛雪音乐备份中歌曲的 meta 字段展平到顶层，使现有提取器能正常工作。
 * 洛雪歌曲结构：{ id, name, singer, source, interval, meta: { songId, albumName, picUrl, ... } }
 */
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

/**
 * 识别备份格式与版本。
 *
 * 检测策略（按优先级）：
 * 0. 洛雪音乐：defaultList / loveList / userList 结构
 * 1. schema 字段明确标识 BakaMusic
 * 2. 作者身份：Toskysun → BakaMusic；时迁酱 → MusicFree
 * 3. 结构特征：data.musicSheets（嵌套）→ 倾向 BakaMusic；顶层 musicSheets → 倾向 MusicFree
 * 4. 歌曲字段特征：通过 artist/singer、title/name 等字段的使用模式区分
 *
 * 版本策略：只用于决定是否还原字符串化的数字 ID，不做版本白名单拦截。
 * 作为导入方应尽量宽容——遇到未知版本仍照常解析，只是不做迁移，
 * 而不是因为版本号不认识就拒绝用户的文件。
 */
export function detectBackup(data: any): DetectedBackup {
  const version = typeof data?.version === 'number' ? data.version : null;

  // 0. 洛雪音乐
  // 支持以下来源：
  //   a) v3 备份文件：type 为 allData_v3 / playList_v3，
  //      全量备份的歌单嵌套在 data.lists 下（defaultList / loveList / userList / tempList），
  //      列表备份的歌单在 data 数组中，每项 { id, name, list: [...] }
  //   b) v2/v1 备份文件：type 为 allData_v2 / playList_v2 / allData / playList，
  //      歌单在 playList（全部备份）或 data（列表备份）数组中，每项 { id, name, list: [...] }
  //   c) 内部存储结构：defaultList / loveList / userList
  // v3 全量备份的 lists 嵌套在 data.data.lists 下，提取到 lxData 以复用 0b 的内部存储结构解析
  const lxData = data?.type === 'myList' && data?.data ? data.data
    : data?.type === 'allData_v3' && data?.data?.lists ? data.data.lists
    : data;

  // 0a. 洛雪备份文件（allData_v2 / playList_v3 / playList_v2 / allData / playList）
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
    // 歌单全部为空时返回空结果（不抛错），让上层正常返回 0 歌单
    return { format: 'lxmusic', sheets, version: null, restoreStringifiedIds: false };
  }

  // 0a-1. 洛雪设置备份（setting_v2 / setting）不含歌单
  if (lxBackupType === 'setting_v2' || lxBackupType === 'setting') {
    throw new Error('未找到可导入的歌单');
  }

  // 0b. 洛雪内部存储结构 / v3 全量备份（ListDataFull / ListSaveInfo / allData_v3）
  // v3 全量备份的 lxData 已被提取为 data.data.lists，结构与内部存储一致
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

  // 1. BakaMusic: schema 字段存在时优先判定（最可靠的标识）
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

  // 2. 作者身份标识优先于结构和歌曲字段推断
  const nestedSheets = Array.isArray(data?.data?.musicSheets) ? data.data.musicSheets : null;
  const topLevelSheets = Array.isArray(data?.musicSheets) ? data.musicSheets : null;
  const identifiedSheets = nestedSheets ?? topLevelSheets ?? [];

  // Toskysun 是 BakaMusic 开发者，有此标识则必为 BakaMusic
  if (hasToskysunSignature(data)) {
    return {
      format: 'bakamusic',
      sheets: identifiedSheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  // 时迁酱是 MusicFree 作者，即使结构或歌曲字段像 Baka 也强制按 MusicFree 处理
  if (hasMusicFreeAuthorSignature(data)) {
    return {
      format: 'musicfree',
      sheets: identifiedSheets,
      version,
      restoreStringifiedIds: false,
    };
  }

  // 3. 按结构特征初步判断，再用歌曲字段特征验证/修正

  if (nestedSheets) {
    // 结构上像 BakaMusic（嵌套在 data 下），但用歌曲字段验证
    const inferred = inferFormatFromSongFields(nestedSheets);
    // 如果歌曲字段明确指向 MusicFree，则修正判断
    if (inferred === 'musicfree') {
      return { format: 'musicfree', sheets: nestedSheets, version, restoreStringifiedIds: false };
    }
    // 否则保持 BakaMusic 判断
    return {
      format: 'bakamusic',
      sheets: nestedSheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  if (topLevelSheets) {
    // 结构上像 MusicFree（顶层 musicSheets），但用歌曲字段验证
    const inferred = inferFormatFromSongFields(topLevelSheets);
    // 如果歌曲字段明确指向 BakaMusic，则修正判断
    if (inferred === 'bakamusic') {
      return {
        format: 'bakamusic',
        sheets: topLevelSheets,
        version,
        restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
      };
    }
    // 否则保持 MusicFree 判断
    return { format: 'musicfree', sheets: topLevelSheets, version, restoreStringifiedIds: false };
  }

  throw new Error('无法识别备份格式，请选择 BakaMusic、MusicFree 或洛雪音乐导出的备份文件');
}