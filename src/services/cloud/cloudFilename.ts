// 网盘音频文件名解析（与移动端 lib/src/cloud/cloud_filename.dart 同构）：
// 「歌手 - 歌名.flac」「歌名 (FLAC).mp3」等常见命名 → {artist, title}。
// 解析仅供展示与日推候选匹配，不参与播放（播放用 CloudFile 原始数据）。

const AUDIO_EXTS = [
  'mp3',
  'flac',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'opus',
  'ape',
  'wma',
  'aiff',
];

const TAG_KEYWORDS = [
  'flac',
  '无损',
  'hi-res',
  'sq',
  'hq',
  'dsd',
  '320k',
  '128k',
  'ape',
  'wav',
  '全辑',
  '伴奏',
  'dj版',
  'live',
];

/** 中英文括号包裹的分组：【…】[…]（…）（…） */
const BRACKET_GROUP = /[【\[\(（][^\】\]\)）]*[】\]\)）]/g;

/** 去扩展名与音质/来源标签（括号包裹形式整体剔除）。 */
function cleanCloudFileName(raw: string): string {
  let name = raw.trim();
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (AUDIO_EXTS.includes(ext)) name = name.slice(0, dot);
  }
  name = name.replace(BRACKET_GROUP, (group) => {
    const low = group.toLowerCase();
    return TAG_KEYWORDS.some((k) => low.includes(k)) ? '' : group;
  });
  return name.replace(/\s+/g, ' ').trim();
}

export interface CloudNameParts {
  title: string;
  /** 单段命名（无分隔符）时为 null。 */
  artist: string | null;
}

/**
 * 网盘音频文件名拆歌名/歌手：主流命名是「歌名 - 歌手」（天天-陶喆、
 * 7 Years-Lukas Graham），两段默认段1=歌名、段2=歌手；三段以上余段
 * 并回歌手。单段整体作歌名。
 */
export function parseCloudFileName(raw: string): CloudNameParts {
  const name = cleanCloudFileName(raw);
  if (!name) return { title: raw, artist: null };
  let segments: string[];
  if (name.includes(' - ')) {
    segments = name.split(' - ');
  } else if (name.includes('–')) {
    segments = name.split('–');
  } else if (name.includes('-')) {
    segments = name.split('-');
  } else if (name.includes('_')) {
    segments = name.split('_');
  } else {
    return { title: name, artist: null };
  }
  if (segments.length < 2) return { title: name, artist: null };
  const s1 = segments[0].trim();
  const s2 = segments.slice(1).join(' - ').trim();
  if (!s1) return { title: s2, artist: null };
  if (!s2) return { title: s1, artist: null };
  return { title: s1, artist: s2 };
}
