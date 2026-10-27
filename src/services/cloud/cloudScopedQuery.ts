// 文件夹范围网盘搜索：只遍历指定文件夹找音频，替代全盘 searchFiles。
// 移植自移动端 lib/src/cloud/cloud_scoped_query.dart：账号在移动端勾选了
// 一个或多个文件夹（经跨设备同步落到本地）时，搜索/日推用本实现代替
// 全盘搜索——BFS 完整遍历选定文件夹子树（不设深度/数量/页数上限），
// 文件名包含关键词（忽略大小写）即收集。
//
// 目录间并发遍历（worker 池，上限 DIR_CONCURRENCY）：串行逐目录 listDir
// 在大目录树下是几十上百次网络往返，是搜索结果页慢的主因；同目录翻页
// 仍串行（cursor 链式依赖）。并发上限对齐头部元数据探针（4），温和不触
// 发风控。
//
// 路径语义与浏览页/选择器一致：进入子目录取「条目 path 非空且异于
// 当前目录时用 path，否则用 id」（覆盖 path 型盘与 id 型盘）。

import { logApplicationEvent } from '../applicationLogger';
import type { CloudProvider } from './cloudProvider';
import type { CloudFile } from './cloudTypes';

const DIR_CONCURRENCY = 4;

/** path 是否落在任一 root 子树内（目录边界：路径前缀 + '/'）。
 * root 本身也命中（filesearch 对目录本身不返回，防御性兜住）。 */
const isUnderRoots = (path: string, roots: string[]): boolean =>
  roots.some(r => {
    const base = r.endsWith('/') ? r : `${r}/`;
    return path === r || path.startsWith(base);
  });

/** 百度特化：filesearch 服务端全盘检索一次返回（含 path），1 次 API 替代
 * 逐目录 listDir 遍历——几十个目录的树即使并发也要多轮往返，是百度范围
 * 搜索慢的主因。命中按 roots 路径前缀过滤 + 文件名 contains 复核
 * （filesearch 是服务端分词匹配，可能宽于本地 contains）。
 * 失败（OAuth 轨无搜索接口等）返回 null，调用方回落通用遍历。
 * 注意：服务端索引对新建文件有短暂延迟，极新文件可能搜不到（通用遍历无
 * 此差异）。 */
const scopedSearchAudioBaidu = async (
  provider: CloudProvider,
  cred: Record<string, string>,
  roots: string[],
  keyword: string,
): Promise<CloudFile[] | null> => {
  try {
    // 百度 filesearch 无翻页（nextCursor 恒空），一次拉全
    const all = (await provider.searchFiles(cred, keyword.trim())).files;
    return all.filter(
      f =>
        !f.isDir &&
        f.isAudio &&
        f.name.toLowerCase().includes(keyword.trim().toLowerCase()) &&
        f.path != null &&
        isUnderRoots(f.path, roots),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 网络类失败（频控/断网）不回落 BFS：几十次 listDir 连击会加重百度
    // 风控（实测连播同域名播放直链一起打到 403/连接重置），风控期返回
    // 空结果；仅业务不支持（OAuth 轨无搜索接口）回落通用遍历。
    if (!msg.includes('OAuth') && !msg.includes('不支持')) {
      console.warn('[scopedSearch] baidu filesearch 失败(网络/风控?)，返回空:', msg);
      return [];
    }
    console.warn('[scopedSearch] baidu filesearch 不支持，回落遍历:', msg);
    return null;
  }
};

/** 目录树 BFS 遍历收集音频：keyword 非空时按文件名 contains 过滤
 * （忽略大小写，范围搜索），为空时全量收集（网盘页全量列表）。
 * 同 id 只留一条（目录间并发遍历，结果顺序不定）；网络异常的子文件夹
 * 跳过但计数并记录末次错误——全目录失败时上层据此给出可见错误，
 * 而不是静默返回 0 首。 */
interface WalkOutcome {
  files: CloudFile[];
  failedDirs: number;
  lastError: string;
}

const walkAudioDirs = async (
  provider: CloudProvider,
  cred: Record<string, string>,
  roots: string[],
  keyword: string | null,
): Promise<WalkOutcome> => {
  const kw = keyword?.trim().toLowerCase() ?? '';
  const seen = new Set<string>();
  const out: CloudFile[] = [];
  const queue: string[] = [...roots];
  let active = 0;
  let failedDirs = 0;
  let lastError = '';
  // 并发上限：百度（网页 API 高频触发风控，连带播放直链 403）、
  // 阿里（v2/file/list 对并发连击限流——文件夹浏览/在线搜索是单请求所以
  // 正常，唯独全量扫描连击会成片失败）收紧到 2，其余 4。
  const dirConcurrency =
    provider.id === 'baidu' || provider.id === 'aliyun' ? 2 : DIR_CONCURRENCY;
  // 自适应并发：起步 1（与文件夹页串行浏览完全同节奏——串行从未被拦），
  // 连续 4 个目录成功才 +1 档提速；任一目录失败立即退回 1 并退避重试。
  let currentLimit = 1;
  let successStreak = 0;

  // 单个目录：整页拉完（翻页串行），发现的子目录入共享队列；返回是否成功
  const scanDir = async (cur: string): Promise<boolean> => {
    let cursor: string | null = null; // 首页为 null，有 nextCursor 才翻页
    for (;;) {
      let r;
      try {
        r = await provider.listDir(cred, cur, cursor);
      } catch {
        // 限流/抖动常为瞬态：退避后重试一次再放弃
        await new Promise((res) => setTimeout(res, 900));
        try {
          r = await provider.listDir(cred, cur, cursor);
        } catch (e2) {
          // 与移动端 AppLog.warn('[walkAudio] ...') 对齐：失败目录记日志，
          // 便于「整盘 0 首」时从导出日志定位（401/token 过期/风控等）
          failedDirs += 1;
          lastError = e2 instanceof Error ? e2.message : String(e2);
          logApplicationEvent(
            'warn',
            'cloud',
            'walkAudio',
            `${provider.id} 列目录失败 dir=${cur || '(根)'}: ${lastError}`,
          );
          return false; // 单文件夹失败不影响其余范围
        }
      }
      for (const f of r.files) {
        if (f.isDir) {
          const next =
            f.path != null && f.path !== '' && f.path !== cur ? f.path : f.id;
          queue.push(next);
        } else if (
          f.isAudio &&
          (kw === '' || f.name.toLowerCase().includes(kw)) &&
          !seen.has(f.id)
        ) {
          seen.add(f.id);
          out.push(f);
        }
      }
      cursor = r.nextCursor;
      if (cursor == null || cursor === '') break;
    }
    return true;
  };

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (active === 0 && queue.length === 0) {
        resolve();
        return;
      }
      while (active < currentLimit && queue.length > 0) {
        const dir = queue.shift() as string;
        active++;
        scanDir(dir)
          .then((ok) => {
            if (ok) {
              successStreak += 1;
              // 连续成功 4 个目录提一档并发，直到该盘上限
              if (successStreak >= 4 && currentLimit < dirConcurrency) {
                successStreak = 0;
                currentLimit += 1;
              }
            } else {
              // 一失败立即退回串行节奏（文件夹页同款），成功后再逐步恢复
              successStreak = 0;
              currentLimit = 1;
            }
          })
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    pump();
  });
  return { files: out, failedDirs, lastError };
};

/** 在 roots 指定的文件夹范围内搜索文件名含 keyword 的音频。
 * 同 id 只留一条（并发遍历，结果顺序不定）；网络异常的子文件夹跳过。 */
export async function scopedSearchAudio(
  provider: CloudProvider,
  cred: Record<string, string>,
  roots: string[],
  keyword: string,
): Promise<CloudFile[]> {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  if (provider.id === 'baidu') {
    const viaApi = await scopedSearchAudioBaidu(provider, cred, roots, keyword);
    if (viaApi != null) return viaApi;
    // 回落通用遍历
  }
  const outcome = await walkAudioDirs(provider, cred, roots, kw);
  return outcome.files;
}

/** 网盘页全量音频列举：遍历 selectedRoots（空 = 从全盘根目录起）收集
 * 全部音频文件，无关键词过滤；BFS/并发/容错语义与 scopedSearchAudio 一致。
 * 一个文件都没拿到且有目录失败时抛错（带末次错误），避免「静默 0 首」。 */
export async function listAllCloudAudio(
  provider: CloudProvider,
  cred: Record<string, string>,
  selectedRoots: string[],
): Promise<CloudFile[]> {
  const outcome = await walkAudioDirs(
    provider,
    cred,
    selectedRoots.length > 0 ? selectedRoots : [provider.rootPath],
    null,
  );
  if (outcome.files.length === 0 && outcome.failedDirs > 0) {
    throw new Error(
      `遍历目录失败 ${outcome.failedDirs} 个：${outcome.lastError}`,
    );
  }
  return outcome.files;
}
