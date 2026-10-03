use super::LxSearchItem;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

struct SearchCacheEntry {
    items: Vec<LxSearchItem>,
    expires_at: Instant,
    last_access: Instant,
}

static SEARCH_CACHE: OnceLock<Arc<RwLock<HashMap<String, SearchCacheEntry>>>> = OnceLock::new();

fn search_cache() -> &'static Arc<RwLock<HashMap<String, SearchCacheEntry>>> {
    SEARCH_CACHE.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

const SEARCH_CACHE_TTL_SECS: u64 = 300;
const SEARCH_CACHE_MAX_ENTRIES: usize = 200;

pub(super) fn make_search_cache_key(source: &str, keyword: &str, limit: u32) -> String {
    format!("{}/{}/{}", source, keyword, limit)
}

pub(super) async fn get_cached_search(source: &str, keyword: &str, limit: u32) -> Option<Vec<LxSearchItem>> {
    let key = make_search_cache_key(source, keyword, limit);
    let mut cache = search_cache().write().await;
    let now = Instant::now();
    let entry = cache.get_mut(&key)?;
    if entry.expires_at <= now {
        cache.remove(&key);
        return None;
    }
    entry.last_access = now;
    Some(entry.items.clone())
}

pub(super) async fn set_cached_search(source: &str, keyword: &str, limit: u32, items: Vec<LxSearchItem>) {
    let mut cache = search_cache().write().await;
    let key = make_search_cache_key(source, keyword, limit);
    let now = Instant::now();
    cache.insert(
        key,
        SearchCacheEntry {
            items,
            expires_at: now + Duration::from_secs(SEARCH_CACHE_TTL_SECS),
            last_access: now,
        },
    );

    evict_search_cache(&mut cache, now);
}

fn evict_search_cache(cache: &mut HashMap<String, SearchCacheEntry>, now: Instant) {
    cache.retain(|_, e| e.expires_at > now);
    let excess = cache.len().saturating_sub(SEARCH_CACHE_MAX_ENTRIES);
    if excess == 0 {
        return;
    }
    let mut keys: Vec<(String, Instant)> = cache
        .iter()
        .map(|(k, e)| (k.clone(), e.last_access))
        .collect();
    keys.sort_unstable_by_key(|(_, t)| *t);
    for (k, _) in keys.into_iter().take(excess) {
        cache.remove(&k);
    }
}
