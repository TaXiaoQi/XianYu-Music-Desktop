// 文件夹范围网盘搜索：只遍历指定文件夹找音频，替代全盘 searchFiles。
// 移植自移动端 lib/src/cloud/cloud_scoped_query.dart：账号在移动端勾选了
// 一个或多个文件夹（经跨设备同步落到本地）时，搜索/日推用本实现代替
// 全盘搜索——BFS 完整遍历选定文件夹子树（不设深度/数量/页数上限），
// 文件名包含关键词（忽略大小写）即收集。
//
// 路径语义与浏览页/选择器一致：进入子目录取「条目 path 非空且异于
// 当前目录时用 path，否则用 id」（覆盖 path 型盘与 id 型盘）。

import type { CloudProvider } from './cloudProvider';
import type { CloudFile } from './cloudTypes';

/** 在 roots 指定的文件夹范围内搜索文件名含 keyword 的音频。
 * 返回结果按遍历顺序去重（同 id 只留一条）；网络异常的子文件夹跳过。 */
export async function scopedSearchAudio(
  provider: CloudProvider,
  cred: Record<string, string>,
  roots: string[],
  keyword: string,
): Promise<CloudFile[]> {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const seen = new Set<string>();
  const out: CloudFile[] = [];
  for (const root of roots) {
    const queue: string[] = [root];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      let cursor: string | null = null; // 首页为 null，有 nextCursor 才翻页
      for (;;) {
        let r;
        try {
          r = await provider.listDir(cred, cur, cursor);
        } catch {
          break; // 单文件夹失败不影响其余范围
        }
        for (const f of r.files) {
          if (f.isDir) {
            const next =
              f.path != null && f.path !== '' && f.path !== cur ? f.path : f.id;
            queue.push(next);
          } else if (
            f.isAudio &&
            f.name.toLowerCase().includes(kw) &&
            !seen.has(f.id)
          ) {
            seen.add(f.id);
            out.push(f);
          }
        }
        cursor = r.nextCursor;
        if (cursor == null || cursor === '') break;
      }
    }
  }
  return out;
}
