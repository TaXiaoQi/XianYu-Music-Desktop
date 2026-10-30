// 网盘业务代理命令：TS 经本命令调用内嵌的 crate::cloud 十盘业务实现
//（同步自移动端 rust/src/cloud）。登录类操作留在 TS 侧，不走本命令。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 网盘业务代理（十盘统一入口）。`req_json` 为 {provider, op, cred, params}
/// JSON；返回 {result, rotated_cred?} 的 JSON；业务失败 Err(中文文案) 直接
/// 透传给前端。
#[tauri::command]
pub async fn cloud_proxy(req_json: String) -> Result<String, String> {
    let req = crate::cloud::types::CloudReq::parse(&req_json).map_err(|(_, m)| m)?;
    crate::cloud::dispatch(req)
        .await
        .map_err(|(_, m)| m)
        .and_then(|v| serde_json::to_string(&v).map_err(|e| e.to_string()))
}

const OAUTH_LOGIN_WINDOW_LABEL: &str = "oauth-login";
// OAuth 回调宿主与路径前缀（百度开放平台注册的 redirect_uri 固定指向
// github.io 且页面不可达；按 host+path 前缀判定，其他盘 oauth 回调可复用）。
const OAUTH_CALLBACK_HOST: &str = "xianyu-music.github.io";
const OAUTH_CALLBACK_PATH_PREFIX: &str = "/oauth/";

/// 重复打开先关旧窗并等它真正销毁：close() 仅是异步派发，立即重建会同
/// label 冲突（"a webview with label ... already exists"），最长等 2s。
async fn close_webview_window_and_wait(app: &AppHandle, label: &str) {
    if let Some(old) = app.get_webview_window(label) {
        let _ = old.close();
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if app.get_webview_window(label).is_none() {
                return;
            }
        }
    }
}

/// 登录/授权窗独立 user data 目录（temp 下毫秒代数命名）：每次开窗全新
/// 目录 = 全新会话（等效 incognito，修复「添加其他账号」抓到旧账号），
/// 但不依赖 WebView2 InPrivate——夸克营销页在真 incognito 下整页白屏
/// （实测），独立持久目录方案下正常渲染。目录与主窗 profile 隔离，清理
/// 不影响应用数据；旧目录由 spawn_cleanup_login_profile_dirs 延迟删除。
fn login_profile_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("xym-login-profile-{}", now_millis()))
}

/// 开窗后延迟清理旧 profile 目录：只删修改时间超 10 分钟的（活跃窗目录
/// 新建不会被误删；WebView2 释放目录句柄有延迟，删不掉的留待下次）。
fn spawn_cleanup_login_profile_dirs(current: std::path::PathBuf) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
        let cur_name = current
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with("xym-login-profile-") || name == cur_name {
                continue;
            }
            let path = e.path();
            let stale = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| now_secs.saturating_sub(d.as_secs()) > 600)
                .unwrap_or(false);
            if stale {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    });
}

/// OAuth 授权登录窗：内嵌 WebView 打开服务商授权页。授权完成后服务商
/// 302 到注册回调（页面不可达），on_navigation 拦下该跳转——抽出 code
/// emit 给前端并关窗，用户全程看不到 404 页。前端先 listen `event`
/// 再调本命令，收到 code 后自动完成绑定（粘贴框仅作兜底）。
///
/// 必须是 async 命令：sync 命令在主线程同步执行，Windows 上主线程里
/// 同步创建 WebView2 会卡死该窗口消息循环（实测：白屏且无法关闭）；
/// async 命令跑在 runtime 线程，build 内部派发主线程创建并等待完成。
#[tauri::command]
pub async fn open_oauth_login_window(
    app: AppHandle,
    url: String,
    event: String,
) -> Result<(), String> {
    close_webview_window_and_wait(&app, OAUTH_LOGIN_WINDOW_LABEL).await;
    arm_main_size_guard(&app);
    eprintln!("[oauth-login] t={} open requested", now_millis());
    let nav_url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    let app_for_nav = app.clone();
    let profile_dir = login_profile_dir();
    WebviewWindowBuilder::new(&app, OAUTH_LOGIN_WINDOW_LABEL, WebviewUrl::External(nav_url))
        .title("授权登录")
        // 独立一次性 user data 目录：每次全新会话，不依赖 InPrivate
        .data_directory(profile_dir.clone())
        // 百度桌面授权页为左右两栏布局，宽 700 保证权限列表完整；高度收窄贴合内容
        .inner_size(700.0, 470.0)
        .min_inner_size(420.0, 420.0)
        .center()
        .devtools(true)
        .on_navigation(move |nav| {
            // 诊断日志：dev 终端可见，确认授权窗导航链路与回调拦截是否生效
            eprintln!("[oauth-login] navigate: {nav}");
            let is_callback = nav.host_str() == Some(OAUTH_CALLBACK_HOST)
                && nav.path().starts_with(OAUTH_CALLBACK_PATH_PREFIX);
            if !is_callback {
                return true;
            }
            let code = nav
                .query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default();
            let _ = app_for_nav.emit(&event, code);
            // 不在导航回调同步栈里 close（主线程重入销毁流程有卡死风险）；
            // 前端收到 code 完成绑定后经 close_oauth_login_window 关窗。
            // 阻止加载不可达的回调页。
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    // 延迟清理本窗之外的历史 profile 目录
    spawn_cleanup_login_profile_dirs(profile_dir);
    Ok(())
}

/// 关闭 OAuth 授权登录窗（前端抽到 code 完成绑定后调用；窗口不存在时 no-op）。
#[tauri::command]
pub async fn close_oauth_login_window(app: AppHandle) -> Result<(), String> {
    eprintln!("[oauth-login] t={} close requested", now_millis());
    if let Some(w) = app.get_webview_window(OAUTH_LOGIN_WINDOW_LABEL) {
        let _ = w.close();
    }
    // 销毁第二窗同样可能滞后重置主窗尺寸，进入关窗宽限期
    grace_main_size_guard(&app);
    Ok(())
}

// ── WebView 网页登录窗（夸克/UC cookie 型 + 阿里/迅雷 token 型）────

const WEBVIEW_LOGIN_WINDOW_LABEL: &str = "webview-login";
const MAIN_WINDOW_LABEL: &str = "main";
/// 每次开窗递增的代数：重开窗口后旧轮询任务据此自行退出（防双任务双 emit）。
static WEBVIEW_LOGIN_GEN: AtomicU64 = AtomicU64::new(0);

/// 对时用毫秒时间戳（诊断日志前缀）。
fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn main_size_snapshot(app: &AppHandle) -> Option<(u32, u32)> {
    let w = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    let s = w.outer_size().ok()?;
    Some((s.width, s.height))
}

/// 主窗尺寸守护状态：开窗时的快照 + 登录窗全关后的宽限截止（销毁第二
/// 窗也可能滞后触发一次重置）。
struct MainSizeGuardState {
    snap: (u32, u32),
    grace_until: Option<std::time::Instant>,
}

/// 建/销第二窗期间 WebView2 会把主窗重置回 tauri.conf 创建尺寸（960×
/// 635，实测时机不定：可晚至登录页资源加载完，轮询守护有时限必漏）。
/// 事件驱动守护：主窗每次 Resized 核对快照，登录窗存活期（含关窗后
/// 4s 宽限）内偏离即还原。最大化时不动；登录窗开着时用户手动调主窗
/// 尺寸也会被还原（登录流程短，可接受）。
static MAIN_SIZE_GUARD: std::sync::Mutex<Option<MainSizeGuardState>> = std::sync::Mutex::new(None);

/// 开登录/授权窗前武装守护（记录主窗当前物理尺寸）。
fn arm_main_size_guard(app: &AppHandle) {
    if let Some(snap) = main_size_snapshot(app) {
        if let Ok(mut g) = MAIN_SIZE_GUARD.lock() {
            *g = Some(MainSizeGuardState { snap, grace_until: None });
        }
    }
}

/// 登录/授权窗关闭：进入 4s 宽限（销毁第二窗的滞后重置仍被还原）。
fn grace_main_size_guard(app: &AppHandle) {
    let snap = MAIN_SIZE_GUARD
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.snap));
    let Some(snap) = snap.or_else(|| main_size_snapshot(app)) else { return };
    if let Ok(mut g) = MAIN_SIZE_GUARD.lock() {
        *g = Some(MainSizeGuardState {
            snap,
            grace_until: Some(std::time::Instant::now() + Duration::from_secs(4)),
        });
    }
}

/// 主窗 Resized 事件钩子（lib.rs on_window_event 调用）：守护生效期内
/// 尺寸偏离快照即异步还原。还原本身再触发一次 Resized，届时尺寸已等于
/// 快照自然收敛，不会循环。
pub fn enforce_main_size_on_resize(window: &tauri::Window) {
    let snap = {
        let Ok(g) = MAIN_SIZE_GUARD.lock() else { return };
        let Some(state) = g.as_ref() else { return };
        let within_grace = state
            .grace_until
            .map(|t| std::time::Instant::now() < t)
            .unwrap_or(false);
        if !within_grace {
            // 无宽限则要求登录窗仍存活，否则守护期满卸下
            let app = window.app_handle();
            let alive = app.get_webview_window(WEBVIEW_LOGIN_WINDOW_LABEL).is_some()
                || app.get_webview_window(OAUTH_LOGIN_WINDOW_LABEL).is_some();
            if !alive {
                if let Ok(mut g) = MAIN_SIZE_GUARD.lock() {
                    *g = None;
                }
                return;
            }
        }
        state.snap
    };
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let Ok(size) = window.outer_size() else { return };
    if size.width == snap.0 && size.height == snap.1 {
        return;
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        // 稍候重置流程走完再还原，避免与进行中的 SetWindowPos 打架
        tokio::time::sleep(Duration::from_millis(60)).await;
        if let Some(m) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            if !m.is_maximized().unwrap_or(false) {
                eprintln!("[main-size] 主窗被重置，还原为 {}x{}", snap.0, snap.1);
                let _ = m.set_size(tauri::PhysicalSize::new(snap.0, snap.1));
            }
        }
    });
}

/// 窗口登录捕获规则（前端 CloudCaptureRule 的 JSON 投影，camelCase）。
/// poll_script 非空 = token 型；否则按 cookie 型（cookie_domains 轮询）。
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct WebviewCaptureSpec {
    /// token 型：页面注入的 JS IIFE（返回非空字符串即登录凭据出现）。
    poll_script: String,
    /// JS 轮询间隔毫秒。
    poll_interval_ms: u64,
    /// cookie 型：逐域原生读取 Cookie（httpOnly 可读）。
    cookie_domains: Vec<String>,
    /// 登录态锚 Cookie：等齐即认为登录完成（如 __kps/__pus）。
    required_cookies: Vec<String>,
    /// 补签终态 Cookie：驱动落地页后最长再等 8s 拿齐（如 __puus）。
    final_cookies: Vec<String>,
    /// 登录完成后驱动一次落地页跳转的 URL（触发补签）。
    post_login_url: String,
    /// 登录页横向溢出时登录区是否靠右（夸克/UC 右置 true）。true 才
    /// 注入滚右脚本。
    scroll_to_right: bool,
    /// 强制解锁根元素滚动（迅雷锁 overflow hidden，普通滚右滚不动）。
    /// 注意仅锁死的页面用：夸克页布局依赖自身 overflow，被强制改写
    /// 后窗口 resize 时页面不重排（实测小窗内容被截断，全屏才恢复）。
    force_scrollable: bool,
    /// 登录窗默认宽/高（逻辑像素）。0 = 480 小窗；固定布局页（迅雷
    /// 营销页不可滚动）声明更大尺寸完整显示登录区。
    window_width: u64,
    window_height: u64,
}

/// 登录页横向溢出且登录区靠右（夸克/UC 营销页）：常驻脚本周期性把文
/// 档滚到最右，默认露出右侧登录卡。SPA 路由切换不触发 load 事件，
/// setInterval 兜底。不碰页面 overflow（夸克布局依赖自身锁定值）。
const SCROLL_RIGHT_INIT_JS: &str = "(function(){function f(){try{var d=document.documentElement;if(d.scrollWidth>d.clientWidth+8){window.scrollTo(d.scrollWidth,d.scrollTop);}}catch(e){}}document.addEventListener('DOMContentLoaded',f);window.addEventListener('load',f);setInterval(f,800);})();";

/// 强制解锁滚动版（仅 overflow 锁死的页面，如迅雷）：每轮先把根元素
/// overflow 改成 auto 再滚到最右。
const FORCE_SCROLL_RIGHT_INIT_JS: &str = "(function(){function f(){try{var d=document.documentElement,b=document.body;if(d)d.style.overflow='auto';if(b)b.style.overflow='auto';if(d.scrollWidth>d.clientWidth+8){window.scrollTo(d.scrollWidth,d.scrollTop);}}catch(e){}}document.addEventListener('DOMContentLoaded',f);window.addEventListener('load',f);setInterval(f,800);})();";

/// token 型初始化脚本：把 provider 的 pollScript（返回字符串的 JS 表达式）
/// 包成定时轮询，命中即以伪协议导航外带——on_navigation 拦截抽值 emit，
/// 页面停留原处。sent 标记防重复外带。
fn token_poll_init_js(spec: &WebviewCaptureSpec) -> String {
    let interval = spec.poll_interval_ms.max(200).to_string();
    let mut js = String::from("(function(){var sent=false;var delay=");
    js.push_str(&interval);
    js.push_str(";setInterval(function(){if(sent)return;try{var v=(");
    js.push_str(&spec.poll_script);
    js.push_str(")();if(v&&String(v).length){sent=true;location.href='xianyu-capture://token?d='+encodeURIComponent(String(v));}}catch(e){}},delay);})();");
    js
}

/// 逐域原生读取 Cookie 合并进 out（httpOnly 也能拿到；官方文档：Windows 上
/// cookies_for_url 在同步命令/事件回调里会死锁，须走异步任务——本函数仅被
/// async spawn 的轮询任务调用）。
fn read_webview_cookies(w: &tauri::WebviewWindow, domains: &[String], out: &mut HashMap<String, String>) {
    for d in domains {
        let Ok(u) = tauri::Url::parse(&format!("https://{d}/")) else { continue };
        if let Ok(list) = w.cookies_for_url(u) {
            for c in list {
                out.insert(c.name().to_string(), c.value().to_string());
            }
        }
    }
}

/// cookie 型后台轮询任务：等齐 required_cookies（登录态锚，未登录恒缺）
/// 即视为登录完成 → post_login_url 非空时驱动一次落地页跳转（夸克/UC：
/// 落地页 init 请求 ~2s 后补签发 __puus），最长再等 8s 拿 final_cookies
/// → 全量 Cookie emit 给前端。窗口被关或 5 分钟超时静默退出。
async fn poll_webview_cookies(app: AppHandle, provider_id: String, event: String, spec: WebviewCaptureSpec, gen: u64) {
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut cookies: HashMap<String, String> = HashMap::new();
    // 阶段一：等登录态锚齐活
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        if WEBVIEW_LOGIN_GEN.load(Ordering::SeqCst) != gen {
            return; // 窗口已被重开，本任务过期
        }
        let Some(w) = app.get_webview_window(WEBVIEW_LOGIN_WINDOW_LABEL) else { return };
        read_webview_cookies(&w, &spec.cookie_domains, &mut cookies);
        if !spec.required_cookies.is_empty()
            && spec.required_cookies.iter().all(|n| cookies.contains_key(n.as_str()))
        {
            break;
        }
    }
    if Instant::now() >= deadline {
        return;
    }
    // 阶段二：驱动补签落地页并等终态 Cookie（最长 8s；拿不齐也照常回传，
    // __kps/__pus 任一在即有效）
    if !spec.post_login_url.is_empty() {
        if let Some(w) = app.get_webview_window(WEBVIEW_LOGIN_WINDOW_LABEL) {
            let js = format!("location.href='{}';", spec.post_login_url.replace('\'', ""));
            let _ = w.eval(&js);
        }
        tokio::time::sleep(Duration::from_millis(2500)).await;
    }
    let final_deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let Some(w) = app.get_webview_window(WEBVIEW_LOGIN_WINDOW_LABEL) else { return };
        read_webview_cookies(&w, &spec.cookie_domains, &mut cookies);
        if spec.final_cookies.is_empty()
            || spec.final_cookies.iter().all(|n| cookies.contains_key(n.as_str()))
        {
            break;
        }
        if Instant::now() >= final_deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    let payload = serde_json::json!({
        "providerId": provider_id,
        "kind": "cookies",
        "value": serde_json::to_string(&cookies).unwrap_or_default(),
    });
    let _ = app.emit(&event, payload);
}

/// WebView 网页登录窗：独立 WebView 打开 provider.webviewLoginUrl（夸克/
/// UC 官方网盘页、阿里/迅雷 oauth 页）。token 型（poll_script 非空）注入
/// 轮询脚本，凭据出现即 emit；cookie 型开窗即后台轮询原生 Cookie 等登录
/// 态锚。emit payload 为 {providerId, kind:'token'|'cookies', value}。
/// 前端先 listen `event` 再调本命令，收到后自动完成绑定并关窗（粘贴框
/// 仅作兜底）。必须是 async 命令，理由同 open_oauth_login_window。
#[tauri::command]
pub async fn open_webview_login_window(
    app: AppHandle,
    provider_id: String,
    url: String,
    event: String,
    capture_json: String,
) -> Result<(), String> {
    // 重复打开先关旧窗并等销毁（同 label 重复构建会失败），并推进代数
    // 让旧轮询任务退出
    close_webview_window_and_wait(&app, WEBVIEW_LOGIN_WINDOW_LABEL).await;
    arm_main_size_guard(&app);
    let gen = WEBVIEW_LOGIN_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    eprintln!("[webview-login] t={} open requested gen={gen}", now_millis());
    let spec: WebviewCaptureSpec =
        serde_json::from_str(&capture_json).map_err(|e| format!("capture 规则解析失败: {e}"))?;
    let nav_url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    let app_for_nav = app.clone();
    let event_for_nav = event.clone();
    let pid_for_nav = provider_id.clone();

    // 默认 480 小窗（响应式登录页，900 宽大片留白）；固定布局页（迅雷
    // 营销页不可滚动）由 capture 规则声明更大尺寸完整显示登录区
    let win_w = if spec.window_width >= 200 { spec.window_width as f64 } else { 480.0 };
    let win_h = if spec.window_height >= 200 { spec.window_height as f64 } else { 480.0 };
    let profile_dir = login_profile_dir();
    let builder = WebviewWindowBuilder::new(&app, WEBVIEW_LOGIN_WINDOW_LABEL, WebviewUrl::External(nav_url))
        .title("网盘登录")
        // 独立一次性 user data 目录：每次全新会话，不依赖 InPrivate
        .data_directory(profile_dir.clone())
        .inner_size(win_w, win_h)
        .min_inner_size(480.0, 480.0)
        .center()
        .devtools(true);
    let builder = if spec.force_scrollable {
        builder.initialization_script(FORCE_SCROLL_RIGHT_INIT_JS)
    } else if spec.scroll_to_right {
        builder.initialization_script(SCROLL_RIGHT_INIT_JS)
    } else {
        builder
    };
    let builder = if spec.poll_script.is_empty() {
        builder
    } else {
        builder.initialization_script(token_poll_init_js(&spec))
    };
    builder
        .on_navigation(move |nav| {
            // 诊断日志：dev 终端可见，确认登录窗导航链路与拦截是否生效
            eprintln!("[webview-login] navigate: {nav}");
            if nav.scheme() != "xianyu-capture" {
                return true;
            }
            let value = nav
                .query_pairs()
                .find(|(k, _)| k == "d")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default();
            let payload = serde_json::json!({
                "providerId": pid_for_nav,
                "kind": "token",
                "value": value,
            });
            let _ = app_for_nav.emit(&event_for_nav, payload);
            // 拦下伪协议导航（页面停留原处）；前端完成绑定后经
            // close_webview_login_window 关窗。
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    eprintln!("[webview-login] t={} built", now_millis());
    // 延迟清理本窗之外的历史 profile 目录
    spawn_cleanup_login_profile_dirs(profile_dir);

    // cookie 型：开窗即后台轮询（官方要求异步任务里读 Cookie）
    if spec.poll_script.is_empty() && !spec.cookie_domains.is_empty() {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            poll_webview_cookies(app2, provider_id, event, spec, gen).await;
        });
    }
    Ok(())
}

/// 关闭 WebView 登录窗（前端捕获到凭据完成绑定后调用；窗口不存在时 no-op）。
#[tauri::command]
pub async fn close_webview_login_window(app: AppHandle) -> Result<(), String> {
    eprintln!("[webview-login] t={} close requested", now_millis());
    if let Some(w) = app.get_webview_window(WEBVIEW_LOGIN_WINDOW_LABEL) {
        let _ = w.close();
    }
    // 销毁第二窗同样可能滞后重置主窗尺寸，进入关窗宽限期
    grace_main_size_guard(&app);
    Ok(())
}
