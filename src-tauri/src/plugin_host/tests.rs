use std::time::Duration;

use super::*;

    fn engine() -> PluginEngine {
        PluginEngine::with_emitter(None, None)
    }

    #[tokio::test]
    async fn load_musicfree_synthetic_plugin() {
        let script = r#"
            module.exports = {
                platform: 'test-source',
                version: '1.0.0',
                author: 'tester',
                async search(keyword, page, type) {
                    const CryptoJs = require('crypto-js');
                    const zlib = require('zlib');
                    const md5 = CryptoJs.MD5(keyword).toString();
                    const compressed = zlib.deflateSync(Buffer.from('hello-' + keyword));
                    const restored = Buffer.from(zlib.inflateSync(compressed)).toString('utf8');
                    return {
                        md5,
                        restored,
                        isBuffer: Buffer.isBuffer(compressed),
                        platform: this.platform,
                    };
                },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-mf", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);
        let meta = result.metadata.unwrap();
        assert_eq!(meta["platform"], "test-source");

        let call = engine
            .call(
                "test-mf",
                "search",
                r#"["奇迹",1,"music"]"#,
                Some("{}"),
                15_000,
            )
            .await;
        assert!(call.ok, "search failed: {:?}", call.error);
        let data = call.data.unwrap();
        assert_eq!(data["restored"], "hello-奇迹");
        assert!(data["isBuffer"].as_bool().unwrap());
        assert!(data["md5"].as_str().map(|s| s.len() == 32).unwrap_or(false));
    }

    #[tokio::test]
    async fn load_lx_synthetic_plugin() {
        let script = r#"
            (async () => {
                lx.on('request', async (data) => {
                    if (data.source !== 'test') throw new Error('unsupported source');
                    if (data.action === 'musicUrl') {
                        return 'https://example.com/' + data.songmid + '/' + data.quality + '.mp3';
                    }
                    if (data.action === 'echo') {
                        const res = await lx.request('GET', 'https://example.invalid/x');
                        return res.body;
                    }
                    return null;
                });
                await lx.send(lx.EVENT_NAMES.inited, {
                    sources: {
                        test: { name: '测试', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
                    },
                });
            })();
        "#;
        let engine = engine();
        let result = engine
            .load_lx(
                "test-lx",
                script,
                r#"{"name":"test-lx","version":"1.0.0","author":"t"}"#,
            )
            .await;
        assert!(result.ok, "lx load failed: {:?}", result.error);
        let meta = result.metadata.unwrap();
        assert!(meta["sources"]["test"].is_object());

        let call = engine
            .call(
                "test-lx",
                "request",
                r#"[{"source":"test","action":"musicUrl","songmid":"abc","quality":"320k"}]"#,
                None,
                15_000,
            )
            .await;
        assert!(call.ok, "lx request failed: {:?}", call.error);
        assert_eq!(
            call.data.unwrap().as_str().unwrap(),
            "https://example.com/abc/320k.mp3"
        );

        let bad = engine
            .call(
                "test-lx",
                "request",
                r#"[{"source":"other","action":"musicUrl"}]"#,
                None,
                15_000,
            )
            .await;
        assert!(!bad.ok);
        assert_eq!(bad.error.unwrap(), "unsupported source");
    }

    #[tokio::test]
    async fn load_lx_tolerates_pending_init_request() {
        // 守卫：真实音源脚本（如 EM音源）常在 init 阶段 fire-and-forget 发一次网络请求，
        // 随后不 await 地 send(inited)。这类「加载结算时仍有未完成异步任务」的形态
        // 不得拖住加载。
        let script = r#"
            lx.on(lx.EVENT_NAMES.request, async () => 'ok');
            lx.request('https://example.invalid/check', { method: 'GET' }, function () {});
            lx.send(lx.EVENT_NAMES.inited, {
                sources: {
                    test: { name: '测试', type: 'music', actions: ['musicUrl'], qualitys: ['320k'] },
                },
            });
        "#;
        let engine = engine();
        let result = engine
            .load_lx("test-lx-pending", script, r#"{"name":"test-lx-pending"}"#)
            .await;
        assert!(result.ok, "lx load failed: {:?}", result.error);
        assert!(result.metadata.unwrap()["sources"]["test"].is_object());
    }

    #[tokio::test]
    async fn load_lx_tolerates_hanging_init_request() {
        // 上一条的加强版：init 阶段的请求长时间不结束（指向不可路由地址，连接挂到超时），
        // 加载仍必须立刻返回，而不是等到请求超时。
        let script = r#"
            lx.on(lx.EVENT_NAMES.request, async () => 'ok');
            lx.request('http://192.0.2.1/hang', { method: 'GET' }, function () {});
            lx.send(lx.EVENT_NAMES.inited, {
                sources: {
                    test: { name: '测试', type: 'music', actions: ['musicUrl'], qualitys: ['320k'] },
                },
            });
        "#;
        let engine = engine();
        let started = std::time::Instant::now();
        let result = engine
            .load_lx("test-lx-hang", script, r#"{"name":"test-lx-hang"}"#)
            .await;
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "init 期挂起的请求拖住了加载: {}ms",
            started.elapsed().as_millis()
        );
        assert!(result.ok, "lx load failed: {:?}", result.error);
    }

    #[tokio::test]
    async fn lx_update_alert_sync_before_inited() {
        let script = r#"
            (async () => {
                lx.on('request', async () => null);
                lx.send(lx.EVENT_NAMES.updateAlert, {
                    log: '修复若干问题',
                    updateUrl: 'https://example.com/script.js',
                }).catch(() => {});
                await lx.send(lx.EVENT_NAMES.inited, { sources: {} });
            })();
        "#;
        let captured: Arc<StdMutex<Vec<(String, serde_json::Value)>>> =
            Arc::new(StdMutex::new(Vec::new()));
        let sink = captured.clone();
        let emitter: PluginEventEmitter = Arc::new(move |event, payload| {
            sink.lock().unwrap().push((event.to_string(), payload));
        });
        let engine = PluginEngine::with_emitter(None, Some(emitter));
        let result = engine
            .load_lx(
                "test-lx-alert",
                script,
                r#"{"name":"test-lx-alert","version":"1.0.0","author":"t"}"#,
            )
            .await;
        assert!(result.ok, "lx load failed: {:?}", result.error);

        let events = captured.lock().unwrap();
        assert_eq!(
            events.len(),
            1,
            "expected exactly one updateAlert: {:?}",
            *events
        );
        assert_eq!(events[0].0, PLUGIN_LX_UPDATE_ALERT_EVENT);
        assert_eq!(events[0].1["pluginId"], "test-lx-alert");
        assert_eq!(events[0].1["log"], "修复若干问题");
        assert_eq!(events[0].1["updateUrl"], "https://example.com/script.js");
    }

    #[tokio::test]
    async fn lx_update_alert_async_after_load_is_driven() {
        let script = r#"
            (async () => {
                lx.on('request', async () => null);
                await lx.send(lx.EVENT_NAMES.inited, { sources: {} });
                setTimeout(() => {
                    lx.send(lx.EVENT_NAMES.updateAlert, { log: '异步更新提醒' }).catch(() => {});
                }, 30);
            })();
        "#;
        let captured: Arc<StdMutex<Vec<(String, serde_json::Value)>>> =
            Arc::new(StdMutex::new(Vec::new()));
        let sink = captured.clone();
        let emitter: PluginEventEmitter = Arc::new(move |event, payload| {
            sink.lock().unwrap().push((event.to_string(), payload));
        });
        let engine = PluginEngine::with_emitter(None, Some(emitter));
        let result = engine
            .load_lx(
                "test-lx-alert-async",
                script,
                r#"{"name":"test-lx-alert-async","version":"1.0.0","author":"t"}"#,
            )
            .await;
        assert!(result.ok, "lx load failed: {:?}", result.error);

        // load 返回后 executor 无人驱动，依赖 load_lx spawn 的后台 settle 驱动
        tokio::time::sleep(Duration::from_millis(2000)).await;
        let events = captured.lock().unwrap();
        assert_eq!(
            events.len(),
            1,
            "expected settle-driven updateAlert: {:?}",
            *events
        );
        assert_eq!(events[0].1["pluginId"], "test-lx-alert-async");
        assert_eq!(events[0].1["log"], "异步更新提醒");
        assert!(events[0].1["updateUrl"].is_null());
    }

    #[tokio::test]
    async fn sync_infinite_loop_killed_by_deadline() {
        let script = r#"
            module.exports = {
                platform: 'hang',
                async spin() { while (true) {} },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-hang", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);

        let call = engine.call("test-hang", "spin", "[]", None, 1200).await;
        assert!(!call.ok);
        assert!(
            call.error.as_deref().unwrap_or("").contains("超时")
                || call.error.as_deref().unwrap_or("").contains("interrupt"),
            "unexpected error: {:?}",
            call.error
        );
    }

    #[tokio::test]
    async fn timers_and_delay_bridge_work() {
        let script = r#"
            module.exports = {
                platform: 'timer',
                async run() {
                    const p = new Promise((resolve) => setTimeout(() => resolve('tick'), 120));
                    return await p;
                },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-timer", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);
        let call = engine.call("test-timer", "run", "[]", None, 10_000).await;
        assert!(call.ok, "run failed: {:?}", call.error);
        assert_eq!(call.data.unwrap().as_str().unwrap(), "tick");
    }

    #[tokio::test]
    async fn storage_and_cookie_bridges() {
        let script = r#"
            module.exports = {
                platform: 'store',
                async roundtrip() {
                    const storage = require('musicfree/storage');
                    await storage.setItem('k1', JSON.stringify({ a: 1 }));
                    const got = await storage.getItem('k1');
                    const cookies = require('@react-native-cookies/cookies');
                    const ok = await cookies.set('https://music.example.com/api', { name: 'sid', value: 'v42' });
                    const jar = await cookies.get('https://api.music.example.com/x');
                    return { got: JSON.parse(got), cookieSet: ok, hasSid: !!jar.sid };
                },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-store", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);
        let call = engine
            .call("test-store", "roundtrip", "[]", None, 10_000)
            .await;
        assert!(call.ok, "roundtrip failed: {:?}", call.error);
        let data = call.data.unwrap();
        assert_eq!(data["got"]["a"], 1);
        assert_eq!(data["cookieSet"], true);
        assert_eq!(data["hasSid"], true);
    }

    #[tokio::test]
    async fn http_bridge_error_path() {
        let script = r#"
            module.exports = {
                platform: 'http',
                async fetchBad() {
                    try {
                        await fetch('not-a-url');
                        return 'no-throw';
                    } catch (e) {
                        return 'threw';
                    }
                },
                async fetchReal() {
                    const res = await fetch('https://www.baidu.com/');
                    const text = await res.text();
                    return { status: res.status, len: text.length > 0 };
                },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-http", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);

        let call = engine
            .call("test-http", "fetchBad", "[]", None, 10_000)
            .await;
        assert!(call.ok);
        assert_eq!(call.data.unwrap().as_str().unwrap(), "threw");

        let real = engine
            .call("test-http", "fetchReal", "[]", None, 30_000)
            .await;
        assert!(real.ok, "fetchReal failed: {:?}", real.error);
        let data = real.data.unwrap();
        assert_eq!(data["status"], 200);
        assert_eq!(data["len"], true);
    }

    #[tokio::test]
    async fn user_vars_refreshed_per_call() {
        let script = r#"
            module.exports = {
                platform: 'vars',
                async getVar() {
                    return env.getUserVariables().TOKEN;
                },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-vars", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);

        let call = engine
            .call(
                "test-vars",
                "getVar",
                "[]",
                Some(r#"{"TOKEN":"abc"}"#),
                10_000,
            )
            .await;
        assert!(call.ok);
        assert_eq!(call.data.unwrap().as_str().unwrap(), "abc");

        let call2 = engine
            .call(
                "test-vars",
                "getVar",
                "[]",
                Some(r#"{"TOKEN":"xyz"}"#),
                10_000,
            )
            .await;
        assert!(call2.ok);
        assert_eq!(call2.data.unwrap().as_str().unwrap(), "xyz");
    }

    #[tokio::test]
    #[ignore]
    async fn plugin_smoke_live() {
        let dir = std::env::var("PLUGIN_ADAPT_DIR").unwrap_or_else(|_| {
            std::env::temp_dir()
                .join("plugin_adapt")
                .to_string_lossy()
                .into_owned()
        });
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .expect("plugin dir missing")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "js").unwrap_or(false))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no plugin scripts in {}", dir);

        let only: Option<String> = std::env::var("PLUGIN_ONLY").ok();
        let keyword = std::env::var("PLUGIN_KEYWORD").unwrap_or_else(|_| "晴天 周杰伦".to_string());
        let engine = engine();

        for path in &files {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            if let Some(filter) = &only {
                if !name.contains(filter.as_str()) {
                    continue;
                }
            }
            let script = std::fs::read_to_string(path).unwrap();
            println!("\n================ {} ================", name);

            let load = engine.load_musicfree(&name, &script, "{}").await;
            if !load.ok {
                println!("[LOAD FAILED] {:?}", load.error);
                continue;
            }
            let meta = load.metadata.unwrap();
            println!(
                "[LOADED] platform={:?} version={:?} qualities={:?} userVars={:?}",
                meta["platform"].as_str(),
                meta["version"].as_str(),
                meta["supportedQualities"],
                meta["userVariables"]
            );

            let search_args = format!(r#"["{}",1,"music"]"#, keyword);
            let search = engine
                .call(&name, "search", &search_args, Some("{}"), 30_000)
                .await;
            if !search.ok {
                println!("[SEARCH FAILED] {:?}", search.error);
                continue;
            }
            let items = search
                .data
                .as_ref()
                .and_then(|d| d.get("data"))
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            if items.is_empty() {
                println!("[SEARCH EMPTY] data={}", search.data.unwrap_or_default());
                continue;
            }
            let first = &items[0];
            println!(
                "[SEARCH OK] {} items, first: id={:?} title={:?} artist={:?}",
                items.len(),
                first["id"].to_string(),
                first["title"].as_str(),
                first["artist"].as_str()
            );

            for quality in ["320k", "128k", "flac"] {
                let args = format!(r#"[{}, "{}"]"#, first, quality);
                let call = engine
                    .call(&name, "getMediaSource", &args, Some("{}"), 30_000)
                    .await;
                match &call.data {
                    Some(v) => println!("[MEDIA {}] {}", quality, v),
                    None => {
                        let logs: Vec<String> = call
                            .logs
                            .iter()
                            .map(|l| format!("{}|{}", l.level, l.message))
                            .collect();
                        println!(
                            "[MEDIA {} FAILED] {:?} logs={:?}",
                            quality, call.error, logs
                        )
                    }
                }
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn plugin_app_flow_live() {
        let dir = std::env::var("PLUGIN_ADAPT_DIR").unwrap_or_else(|_| {
            std::env::temp_dir()
                .join("plugin_adapt")
                .to_string_lossy()
                .into_owned()
        });
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .expect("plugin dir missing")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "js").unwrap_or(false))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no plugin scripts in {}", dir);

        let only: Option<String> = std::env::var("PLUGIN_ONLY").ok();
        let keyword = std::env::var("PLUGIN_KEYWORD").unwrap_or_else(|_| "晴天 周杰伦".to_string());
        let engine = engine();
        let http = crate::netproxy::client_builder()
            .timeout(Duration::from_secs(12))
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .unwrap();

        for path in &files {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            if let Some(filter) = &only {
                if !name.contains(filter.as_str()) {
                    continue;
                }
            }
            let script = std::fs::read_to_string(path).unwrap();
            println!("\n================ {} ================", name);

            let load = engine.load_musicfree(&name, &script, "{}").await;
            if !load.ok {
                println!("[LOAD FAILED] {:?}", load.error);
                continue;
            }

            let platform = load
                .metadata
                .as_ref()
                .and_then(|m| m.get("platform"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if platform.contains("QQ") {
                let host_item = serde_json::json!({
                    "id": "97773",
                    "songmid": "0039MnYb0qxYhV",
                    "title": "晴天",
                    "artist": "周杰伦",
                    "album": "叶惠美",
                    "albumid": "10658",
                    "albummid": "002Neh8l0RxIVZ",
                    "artwork": "https://y.gtimg.cn/music/photo_new/T002R300x300M000002Neh8l0RxIVZ.jpg",
                    "interval": "269",
                    "qualities": {
                        "128k": { "size": "4298221" },
                        "320k": { "size": "10792943" },
                        "flac": { "size": "27164239" }
                    },
                    "_hostQqFallback": true,
                    "platform": platform
                });
                for quality in ["high", "standard", "lossless", "320k", "flac", "128k"] {
                    let args = format!(r#"[{}, "{}"]"#, host_item, quality);
                    let call = engine
                        .call(&name, "getMediaSource", &args, Some("{}"), 30_000)
                        .await;
                    match &call.data {
                        Some(data) => {
                            let url = data.get("url").and_then(|v| v.as_str()).unwrap_or("");
                            println!("[HOST-ITEM {}] url={}", quality, &url[..url.len().min(72)]);
                        }
                        None => println!("[HOST-ITEM {} FAILED] {:?}", quality, call.error),
                    }
                }
            }

            let search_args = format!(r#"["{}",1,"music"]"#, keyword);
            let search = engine
                .call(&name, "search", &search_args, Some("{}"), 30_000)
                .await;
            if !search.ok {
                println!("[SEARCH FAILED] {:?}", search.error);
                continue;
            }
            let items = search
                .data
                .as_ref()
                .and_then(|d| d.get("data"))
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            if items.is_empty() {
                println!("[SEARCH EMPTY]");
                continue;
            }
            let first = &items[0];
            println!(
                "[SEARCH OK] {} items, first: id={} title={:?}",
                items.len(),
                first["id"],
                first["title"].as_str()
            );

            let is_baka = name.starts_with("baka_");
            let quality_keys: [&str; 3] = if is_baka {
                ["320k", "128k", "flac"]
            } else {
                ["high", "standard", "lossless"]
            };

            for quality in quality_keys {
                let args = format!(r#"[{}, "{}"]"#, first, quality);
                let call = engine
                    .call(&name, "getMediaSource", &args, Some("{}"), 30_000)
                    .await;
                let Some(data) = &call.data else {
                    println!(
                        "[MEDIA {} FAILED] {:?} logs={:?}",
                        quality,
                        call.error,
                        call.logs.len()
                    );
                    continue;
                };
                let url = data.get("url").and_then(|v| v.as_str()).unwrap_or("");
                if url.is_empty() {
                    println!("[MEDIA {}] 无 url: {}", quality, data);
                    continue;
                }
                let mut req = http.get(url).header("Range", "bytes=0-2047");
                if let Some(headers) = data.get("headers").and_then(|h| h.as_object()) {
                    for (k, v) in headers {
                        if let Some(v) = v.as_str() {
                            let lk = k.to_ascii_lowercase();
                            if lk == "host" || lk == "accept-encoding" || lk == "content-length" {
                                continue;
                            }
                            req = req.header(k.as_str(), v);
                        }
                    }
                }
                let short = &url[..url.len().min(72)];
                match req.send().await {
                    Ok(resp) => {
                        let status = resp.status().as_u16();
                        let ct = resp
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("-")
                            .to_string();
                        let cr = resp
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("-")
                            .to_string();
                        println!(
                            "[MEDIA {} PROBE] HTTP {} ct={} range={} url={}",
                            quality, status, ct, cr, short
                        );
                    }
                    Err(e) => println!("[MEDIA {} PROBE FAIL] {} -> {}", quality, short, e),
                }
            }
        }
    }

    #[tokio::test]
    async fn logs_collected_per_call() {
        let script = r#"
            module.exports = {
                platform: 'loggy',
                async shout() {
                    console.log('hello-from-plugin');
                    console.error('boom');
                    return 'done';
                },
            };
        "#;
        let engine = engine();
        let result = engine.load_musicfree("test-log", script, "{}").await;
        assert!(result.ok, "load failed: {:?}", result.error);
        let call = engine.call("test-log", "shout", "[]", None, 10_000).await;
        assert!(call.ok);
        assert!(call
            .logs
            .iter()
            .any(|l| l.message.contains("hello-from-plugin")));
        assert!(call
            .logs
            .iter()
            .any(|l| l.level == "error" && l.message.contains("boom")));
    }
