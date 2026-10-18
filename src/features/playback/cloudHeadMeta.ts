// 网盘曲目头部元数据预取（列表期，未播放也显示内嵌封面/时长）。
//
// 网盘列表接口不返回内嵌标签；这里逐曲解析直链后调 probe_cloud_head_meta
// （Rust 侧 Range 拉头 512KB 解析），经 cloud-track-meta-ready 事件回填——
// 与播放期探针共用同一事件与回填链路。会话内按 path 去重、串行执行，
// 避免直链请求风暴。

import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Song } from '../../types';
import {
  CloudPlayContext,
  resolveCloudDirectLink,
} from './cloudPlaybackResolver';

/** 本地元数据索引条目（Rust cloud_meta_index.json，camelCase 冻结）。 */
interface CloudMetaPayload {
  cloudPath: string;
  url?: string;
  lyricsRaw: string | null;
  coverPath: string | null;
  durationSecs: number | null;
}

/** 已探测/已入队的网盘曲目（会话级）。 */
const scheduled = new Set<string>();

// 启动期加载本地索引（懒触发）：命中即前端直接 emit 回填，零网络。
let indexPromise: Promise<Record<string, CloudMetaPayload>> | null = null;
const metaIndex = (): Promise<Record<string, CloudMetaPayload>> => {
  indexPromise ??= invoke<Record<string, CloudMetaPayload>>(
    'load_cloud_meta_index',
  ).catch(() => ({}) as Record<string, CloudMetaPayload>);
  return indexPromise;
};

// 小型工作池：非会员直链单连接限速 ~32KB/s，一首头部 ~146KB 约 5s，
// 串行 20 首要 2 分钟；并发 4 压到 ~30s（每连接独立限速，并行即加速）。
const MAX_CONCURRENT = 4;
const queue: Array<() => Promise<void>> = [];
let active = 0;

const pump = (): void => {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const task = queue.shift();
    if (!task) break;
    active++;
    task().finally(() => {
      active--;
      pump();
    });
  }
};

const contextOf = (song: Song): CloudPlayContext | null =>
  CloudPlayContext.tryParse(
    typeof song.rawData?.cloud === 'string' ? song.rawData.cloud : null,
  ) ?? CloudPlayContext.tryParsePath(song.path);

/** 对无封面的网盘曲目安排一次头部元数据探测（幂等、限并发、失败静默）。 */
export const scheduleCloudHeadMeta = (song: Song): void => {
  if (!song.path.startsWith('cloud://')) return;
  if (scheduled.has(song.path)) return;
  if (song.cover_thumb_path) return;
  const ctx = contextOf(song);
  if (!ctx) return;
  scheduled.add(song.path);

  queue.push(async () => {
    try {
      // 本地索引命中：直接回填，连直链解析都不做
      const idx = await metaIndex();
      const hit = idx[song.path];
      if (hit) {
        await emit('cloud-track-meta-ready', hit);
        return;
      }
      const link = await resolveCloudDirectLink(ctx);
      await invoke('probe_cloud_head_meta', {
        url: link.url,
        headers: link.headers ?? null,
        cloudPath: song.path,
        durationHint: song.duration > 0 ? Math.round(song.duration) : 0,
      });
    } catch (e) {
      // 失败可见化：定位用（播放期探针仍会兜底）；原因透传落盘便于离线排查
      const why = e instanceof Error ? e.message : String(e);
      console.warn('[cloud-head] 头部元数据预探失败:', song.name, why);
      try {
        await invoke('log_cloud_meta_diag', {
          line: `[cloud-head] 预探失败 ${ctx.provider}/${ctx.accountId} «${song.name}»: ${why}`,
        });
      } catch {
        /* 日志命令不可用（旧后端）时忽略 */
      }
    }
  });
  pump();
};

/** 查持久化索引中的单条网盘元数据（播放期兜底：实例未带回填字段时取封面/歌词/时长）。 */
export const lookupCloudMeta = async (
  cloudPath: string,
): Promise<CloudMetaPayload | null> => {
  const idx = await metaIndex();
  return idx[cloudPath] ?? null;
};

/** 批量安排（搜索结果/歌单导入等列表装配点调用）。 */
export const scheduleCloudHeadMetaBatch = (songs: readonly Song[]): void => {
  songs.forEach(scheduleCloudHeadMeta);
};
