use super::cache::{get_cached_search, set_cached_search};
use super::LxSearchItem;
use super::kg::search_kg;
use super::kw::search_kw;
use super::mg::search_mg;
use super::tx::search_tx;
use super::wy::search_wy;

pub async fn lx_search(
    source: &str,
    keyword: &str,
    limit: u32,
) -> Result<Vec<LxSearchItem>, String> {
    let default_limit = match source {
        "tx" => 50,
        "mg" => 20,
        _ => 30,
    };
    let actual_limit = if limit == 0 { default_limit } else { limit };

    if let Some(cached) = get_cached_search(source, keyword, actual_limit).await {
        return Ok(cached);
    }

    let items = match source {
        "kw" => search_kw(keyword, actual_limit).await,
        "kg" => search_kg(keyword, actual_limit).await,
        "tx" => search_tx(keyword, actual_limit).await,
        "wy" => search_wy(keyword, actual_limit).await,
        "mg" => search_mg(keyword, actual_limit).await,
        _ => Err(format!("Unknown LX source: {}", source)),
    }?;

    set_cached_search(source, keyword, actual_limit, items.clone()).await;

    Ok(items)
}
