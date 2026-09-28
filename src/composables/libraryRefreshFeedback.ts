/** 刷新动作返回的统计摘要（本应用只关心缺失歌曲数） */
interface RefreshSummaryLike {
  removedCount?: unknown;
}

export const REFRESH_OK_TEXT = '刷新成功';
export const REFRESH_FAILURE_PREFIX = '刷新失败: ';

/** 统一失败原因取值：优先 message 字段，否则字符串化 */
export const resolveFailureDetail = (error: unknown): string =>
  (error as { message?: string } | null | undefined)?.message || String(error);

/** 摘要能翻译成文案时返回文案；结构不符时返回 null，由调用方兜底 */
export const describeLibraryRefresh = (summary: unknown): string | null => {
  if (!summary || typeof summary !== 'object' || !('removedCount' in summary)) {
    return null;
  }

  const removedCount = Number((summary as RefreshSummaryLike).removedCount) || 0;
  return removedCount > 0
    ? `刷新成功，检测到少了 ${removedCount} 首歌曲`
    : REFRESH_OK_TEXT;
};
