import { httpFetch, type WyTrackMetaPatch } from './playlistImportBase';

// 歌单导入内置实现已下沉 Rust（src-tauri music/playlist_fetcher/kg.rs），
// 本文件仅保留 TrackMeta 富字段补齐链路（fetchKgTrackMetaByIds）。

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
