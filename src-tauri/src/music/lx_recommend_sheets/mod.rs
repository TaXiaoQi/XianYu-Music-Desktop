// lx_recommend_sheets shim：四平台推荐歌单聚合实现统一在共享 core
// （xianyu_core::music::lx_recommend_sheets），端侧仅保留 Tauri 命令包装
// （command 参数为 owned 值、聚合结果包装为 Result）。
pub(crate) use xianyu_core::music::lx_recommend_sheets::{
    LxRecommendSheetsResult, LxRecommendTagsResult,
};

/// getRecommendSheetTags：四平台并发，失败平台跳过，按入参 sources 顺序合并。
#[tauri::command]
pub async fn lx_recommend_sheet_tags(
    sources: Vec<String>,
) -> Result<LxRecommendTagsResult, String> {
    Ok(xianyu_core::music::lx_recommend_sheets::lx_recommend_sheet_tags(&sources).await)
}

/// getRecommendSheetsByTag：tag_id/digest 空串表示各平台默认标签。
#[tauri::command]
pub async fn lx_recommend_sheets_by_tag(
    source: String,
    tag_id: String,
    digest: String,
    page: u32,
) -> Result<LxRecommendSheetsResult, String> {
    xianyu_core::music::lx_recommend_sheets::lx_recommend_sheets_by_tag(
        &source, &tag_id, &digest, page,
    )
    .await
}
