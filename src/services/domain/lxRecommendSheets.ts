import { tauriInvoke } from '../tauri/invoke';
import { dispatchFallbackModule } from '../fallbackModules/registry';
import type {
  LxRecommendSheetsResultContract,
  LxRecommendTagContract,
  LxRecommendTagsResultContract,
} from '../tauri/contractsDomain';

// ==================== lx_recommend_sheets 兜底模块（LX 音源推荐歌单） ====================
// 与 MF 插件协议同名同形：getRecommendSheetTags / getRecommendSheetsByTag。
// 服务端下发的同名 JS 模块优先（QuickJS 宿主），缺失时走 Rust builtin command。
// tag 为 null 表示各平台默认推荐（Rust 侧 tagId/digest 传空串）。

export type LxRecommendTag = LxRecommendTagContract;
export type LxRecommendTagsResult = LxRecommendTagsResultContract;
export type LxRecommendSheetsResult = LxRecommendSheetsResultContract;

export async function lxRecommendSheetTagsFallback(
  sources: string[],
): Promise<LxRecommendTagsResult | null> {
  if (sources.length === 0) return null;
  const builtin = () =>
    tauriInvoke('lx_recommend_sheet_tags', { sources });
  return dispatchFallbackModule<LxRecommendTagsResult | null>(
    'lx_recommend_sheets',
    'getRecommendSheetTags',
    { sources },
    builtin,
  );
}

export async function lxRecommendSheetsByTagFallback(
  source: string,
  tag: { id?: string; digest?: string } | null,
  page = 1,
): Promise<LxRecommendSheetsResult | null> {
  const builtin = () =>
    tauriInvoke('lx_recommend_sheets_by_tag', {
      source,
      tagId: tag?.id ?? '',
      digest: tag?.digest ?? '',
      page,
    });
  return dispatchFallbackModule<LxRecommendSheetsResult | null>(
    'lx_recommend_sheets',
    'getRecommendSheetsByTag',
    { source, tag, page },
    builtin,
  );
}
