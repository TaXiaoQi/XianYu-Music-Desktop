use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CookieEntry {
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub domain: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PluginStoreData {
    #[serde(default)]
    pub cookies: HashMap<String, CookieEntry>,
    #[serde(default)]
    pub storage: HashMap<String, String>,
}

pub struct PluginStore {
    data: Mutex<PluginStoreData>,
    path: Option<std::path::PathBuf>,
}

fn url_hostname(url: &str) -> String {
    url::Url::parse(url)
        .map(|u| u.host_str().unwrap_or_default().to_lowercase())
        .unwrap_or_default()
}

fn cookie_domain_matches(host: &str, cookie_domain: &str) -> bool {
    let host = host.to_lowercase();
    let domain = cookie_domain.trim_start_matches('.').to_lowercase();
    !domain.is_empty() && (host == domain || host.ends_with(&format!(".{domain}")))
}

impl PluginStore {
    pub fn load(path: Option<std::path::PathBuf>) -> Self {
        let data = path
            .as_deref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<PluginStoreData>(&raw).ok())
            .unwrap_or_default();
        Self {
            data: Mutex::new(data),
            path,
        }
    }

    fn persist(&self, data: &PluginStoreData) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        if let Ok(json) = serde_json::to_string(data) {
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }

    pub fn set_cookie(&self, url: &str, name: &str, value: &str, domain: Option<&str>) -> bool {
        let host = url_hostname(url);
        if name.is_empty() {
            return false;
        }
        let mut data = self.data.lock().unwrap();
        let domain = domain
            .filter(|d| !d.is_empty())
            .map(|d| d.to_string())
            .unwrap_or(host);
        data.cookies.insert(
            name.to_string(),
            CookieEntry {
                value: value.to_string(),
                domain,
            },
        );
        self.persist(&data);
        true
    }

    pub fn get_cookies_for_url(&self, url: &str) -> HashMap<String, CookieEntry> {
        let host = url_hostname(url);
        if host.is_empty() {
            return HashMap::new();
        }
        let data = self.data.lock().unwrap();
        data.cookies
            .iter()
            .filter(|(_, c)| cookie_domain_matches(&host, &c.domain))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn cookie_header_for_url(&self, url: &str) -> String {
        self.get_cookies_for_url(url)
            .iter()
            .map(|(name, c)| format!("{}={}", name, c.value))
            .collect::<Vec<_>>()
            .join("; ")
    }

    pub fn cookie_header_for_domain(&self, domain_filter: &str) -> String {
        let filter = domain_filter.to_lowercase();
        let data = self.data.lock().unwrap();
        data.cookies
            .iter()
            .filter(|(_, c)| cookie_domain_matches(&filter, &c.domain) && !c.value.is_empty())
            .map(|(name, c)| format!("{}={}", name, c.value))
            .collect::<Vec<_>>()
            .join("; ")
    }

    pub fn capture_set_cookies(&self, url: &str, set_cookie_values: &[String]) {
        if set_cookie_values.is_empty() {
            return;
        }
        let host = url_hostname(url);
        if host.is_empty() {
            return;
        }
        let mut changed = false;
        let mut data = self.data.lock().unwrap();
        for raw in set_cookie_values {
            let first = raw.split(';').next().unwrap_or("");
            let mut parts = first.splitn(2, '=');
            let name = parts.next().unwrap_or("").trim();
            let value = parts.next().unwrap_or("").trim();
            if name.is_empty() || value.is_empty() {
                continue;
            }
            data.cookies.insert(
                name.to_string(),
                CookieEntry {
                    value: value.to_string(),
                    domain: host.clone(),
                },
            );
            changed = true;
        }
        if changed {
            self.persist(&data);
        }
    }

    pub fn storage_set(&self, key: &str, value: &str) {
        let mut data = self.data.lock().unwrap();
        data.storage.insert(key.to_string(), value.to_string());
        self.persist(&data);
    }

    pub fn storage_get(&self, key: &str) -> Option<String> {
        self.data.lock().unwrap().storage.get(key).cloned()
    }

    pub fn storage_remove(&self, key: &str) {
        let mut data = self.data.lock().unwrap();
        if data.storage.remove(key).is_some() {
            self.persist(&data);
        }
    }

    pub fn import_local(
        &self,
        cookies: HashMap<String, CookieEntry>,
        storage: HashMap<String, String>,
    ) {
        let mut changed = false;
        let mut data = self.data.lock().unwrap();
        for (name, entry) in cookies {
            if name.is_empty() || entry.value.is_empty() {
                continue;
            }
            data.cookies.entry(name).or_insert(entry);
            changed = true;
        }
        for (key, value) in storage {
            data.storage.entry(key).or_insert(value);
            changed = true;
        }
        if changed {
            self.persist(&data);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_roundtrip_and_domain_match() {
        let store = PluginStore::load(None);
        assert!(store.set_cookie("https://www.bilibili.com/x", "SESSDATA", "abc123", None));
        assert!(store.set_cookie("https://api.kugou.com/v1", "kg_token", "xyz", None));

        let header = store.cookie_header_for_url("https://www.bilibili.com/foo");
        assert!(header.contains("SESSDATA=abc123"));
        assert!(!header.contains("kg_token"));
        let api = store.cookie_header_for_url("https://api.bilibili.com/foo");
        assert!(!api.contains("SESSDATA"));

        let bili = store.cookie_header_for_domain("www.bilibili.com");
        assert!(bili.contains("SESSDATA=abc123"));
        assert!(!bili.contains("kg_token"));
        assert!(store.cookie_header_for_domain("bilibili").is_empty());
        assert!(store
            .cookie_header_for_url("https://xwww.bilibili.com/foo")
            .is_empty());
    }

    #[test]
    fn capture_set_cookies_parses_attributes() {
        let store = PluginStore::load(None);
        store.capture_set_cookies(
            "https://y.qq.com/api",
            &[
                "uin=12345; Path=/; Domain=.qq.com; HttpOnly".to_string(),
                "qqmusic_key=QK_; expires=Fri, 01-Jan-2027".to_string(),
                "invalid".to_string(),
            ],
        );
        let header = store.cookie_header_for_url("https://y.qq.com/");
        assert!(header.contains("uin=12345"));
        assert!(header.contains("qqmusic_key=QK"));
    }

    #[test]
    fn storage_ops() {
        let store = PluginStore::load(None);
        store.storage_set("plugin-a/state", "{\"v\":1}");
        assert_eq!(
            store.storage_get("plugin-a/state").as_deref(),
            Some("{\"v\":1}")
        );
        store.storage_remove("plugin-a/state");
        assert!(store.storage_get("plugin-a/state").is_none());
    }

    #[test]
    fn import_local_keeps_rust_entries() {
        let store = PluginStore::load(None);
        store.set_cookie("https://a.com/", "k", "rust", None);
        let mut cookies = HashMap::new();
        cookies.insert(
            "k".to_string(),
            CookieEntry {
                value: "local".to_string(),
                domain: "a.com".to_string(),
            },
        );
        cookies.insert(
            "new".to_string(),
            CookieEntry {
                value: "v".to_string(),
                domain: "b.com".to_string(),
            },
        );
        store.import_local(cookies, HashMap::new());
        assert_eq!(store.cookie_header_for_url("https://a.com/"), "k=rust");
        assert_eq!(store.cookie_header_for_url("https://b.com/"), "new=v");
    }
}
