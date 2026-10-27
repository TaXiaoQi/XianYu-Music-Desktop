import { tauriInvoke } from '../tauri/invoke';
import { fallbackMethodDisabled, fallbackModuleSourceOrder } from '../fallbackModules/registry';
import { kFallbackModuleLxRecommendSheets } from '../fallbackModules/types';
import type {
  LxRecommendSheetsResultContract,
  LxRecommendTagContract,
  LxRecommendTagsResultContract,
} from '../tauri/contractsDomain';

// ==================== lx_recommend_sheets 兜底链路（LX 音源推荐歌单） ====================
// 与 MF 插件协议同名同形：getRecommendSheetTags / getRecommendSheetsByTag。
// 固定走 Rust builtin command；服务端签名配置可关闭链路或调整平台来源。
// tag 为 null 表示各平台默认推荐（Rust 侧 tagId/digest 传空串）。

export type LxRecommendTag = LxRecommendTagContract;
export type LxRecommendTagsResult = LxRecommendTagsResultContract;
export type LxRecommendSheetsResult = LxRecommendSheetsResultContract;

export async function lxRecommendSheetTagsFallback(
  sources: string[],
): Promise<LxRecommendTagsResult | null> {
  if (sources.length === 0) return null;
  if (fallbackMethodDisabled(kFallbackModuleLxRecommendSheets, 'getRecommendSheetTags')) return null;
  const ordered = fallbackModuleSourceOrder(kFallbackModuleLxRecommendSheets, sources) ?? sources;
  return tauriInvoke('lx_recommend_sheet_tags', { sources: ordered });
}

export async function lxRecommendSheetsByTagFallback(
  source: string,
  tag: { id?: string; digest?: string } | null,
  page = 1,
): Promise<LxRecommendSheetsResult | null> {
  if (fallbackMethodDisabled(kFallbackModuleLxRecommendSheets, 'getRecommendSheetsByTag')) return null;
  return tauriInvoke('lx_recommend_sheets_by_tag', {
    source,
    tagId: tag?.id ?? '',
    digest: tag?.digest ?? '',
    page,
  });
}
