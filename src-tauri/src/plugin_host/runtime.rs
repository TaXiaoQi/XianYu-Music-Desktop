use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

use rquickjs::{AsyncContext, AsyncRuntime, Function};

use super::bridges::register_bridges;
use super::misc::{engine_error_message, now_ms};
use super::{EngineLog, HOST_SHIM_JS, PACKAGES_BUNDLE_JS};

const MEMORY_LIMIT: usize = 256 * 1024 * 1024;
// JS 层栈上限必须显著小于 JS 线程的原生栈（JS_THREAD_STACK）。QuickJS 按
// 「执行线程栈顶 - 上限」判定超限：若上限 ≥ 线程实际可用原生栈（tokio
// worker 仅 2MB，Windows 主线程 1MB），栈检查永远来不及触发，深递归脚本
// （如 jsjiami 混淆 VM 的初始化解密链）会打穿 OS 守护页，整个客户端
// STATUS_STACK_OVERFLOW 崩溃（HelloWorld 插件更新即崩的根因）。
// 注意：rquickjs 0.12 的 set_max_stack_size 会把 >16MiB 的值静默视为 0
// （完全关闭栈检查），因此这里必须取 16MiB 且不可再调大。
const MAX_STACK_SIZE: usize = 16 * 1024 * 1024;
const JS_THREAD_STACK: usize = 64 * 1024 * 1024;

/// 插件 JS 专用执行线程（64MB 原生栈）。
///
/// 插件 JS 的栈预算由 MAX_STACK_SIZE 相对「执行线程栈顶」划定，不能超过
/// 线程实际原生栈。此前 JS 在 tokio worker（2MB）上执行，深递归插件直接
/// 杀进程；所有插件 JS（加载 / 调用 / 收尾驱动 / 运行时释放）统一路由到
/// 这条大栈线程执行。单线程串行即可满足：插件 JS 以网络等待为主，且同
/// 插件调用本就由 call_lock 串行。
static JS_THREAD: OnceLock<tokio::runtime::Handle> = OnceLock::new();

pub(super) fn js_thread() -> &'static tokio::runtime::Handle {
    JS_THREAD.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("plugin-js".to_string())
            .stack_size(JS_THREAD_STACK)
            .spawn(move || {
                let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    return;
                };
                let _ = tx.send(rt.handle().clone());
                // 常驻泵：驱动插件 JS 的全部任务直到进程退出
                rt.block_on(std::future::pending::<()>());
            })
            .expect("spawn plugin-js thread");
        rx.recv().expect("plugin-js runtime handle")
    })
}

/// 把一段 JS 驱动 future 路由到插件 JS 线程执行（要求 'static，按值捕获）。
pub(super) async fn drive_js<F, T>(fut: F) -> Result<T, String>
where
    F: std::future::Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    js_thread().spawn(async move {
        let out = fut.await;
        let _ = tx.send(out);
    });
    rx.await.map_err(|_| "插件 JS 任务已被丢弃".to_string())
}

pub(super) async fn create_runtime(
) -> Result<(AsyncRuntime, AsyncContext, Arc<AtomicI64>), String> {
    let runtime = AsyncRuntime::new().map_err(|e| e.to_string())?;
    runtime.set_memory_limit(MEMORY_LIMIT).await;
    runtime.set_max_stack_size(MAX_STACK_SIZE).await;
    let deadline = Arc::new(AtomicI64::new(0));
    let d = deadline.clone();
    runtime
        .set_interrupt_handler(Some(Box::new(move || {
            let until = d.load(Ordering::Relaxed);
            if until <= 0 {
                return false;
            }
            now_ms() >= until
        })))
        .await;
    let ctx = AsyncContext::full(&runtime)
        .await
        .map_err(|e| e.to_string())?;
    Ok((runtime, ctx, deadline))
}

pub(super) async fn setup_context(
    http: &Arc<super::HttpBridge>,
    store: &Arc<super::PluginStore>,
    emitter: &Option<super::PluginEventEmitter>,
    plugin_id: &str,
    ctx: &AsyncContext,
    logs: &Arc<StdMutex<Vec<EngineLog>>>,
    current_call: &Arc<AtomicU64>,
) -> Result<(), String> {
    let update_alert = emitter
        .as_ref()
        .map(|e| (plugin_id.to_string(), e.clone()));
    ctx.async_with(async |ctx| {
        let inner: rquickjs::Result<()> = (|| {
            register_bridges(&ctx, http, store, logs, current_call, &update_alert)?;
            ctx.eval::<(), _>(HOST_SHIM_JS)?;
            ctx.eval::<(), _>(PACKAGES_BUNDLE_JS)?;
            let globals = ctx.globals();
            let post: Function = globals.get("__xyPostSetup")?;
            post.call::<_, ()>(())
        })();
        inner.map_err(|e| engine_error_message(&ctx, &e))
    })
    .await
}
