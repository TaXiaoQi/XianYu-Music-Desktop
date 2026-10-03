import { httpFetch, log, type WyTrackMetaPatch } from './playlistImportBase';

// 歌单导入内置实现已下沉 Rust（src-tauri music/playlist_fetcher/tx.rs），
// 本文件仅保留 TrackMeta 富字段补齐链路（fetchQqTrackMetaByIds）。

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
