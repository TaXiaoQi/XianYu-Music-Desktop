use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use rquickjs::{AsyncContext, AsyncRuntime, Function};

use super::bridges::register_bridges;
use super::misc::{engine_error_message, now_ms};
use super::{EngineLog, HOST_SHIM_JS, PACKAGES_BUNDLE_JS, PluginEngine};

const MEMORY_LIMIT: usize = 256 * 1024 * 1024;
const MAX_STACK_SIZE: usize = 2 * 1024 * 1024;

impl PluginEngine {
    pub(super) async fn create_runtime(&self) -> Result<(AsyncRuntime, AsyncContext, Arc<AtomicI64>), String> {
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
        &self,
        plugin_id: &str,
        ctx: &AsyncContext,
        logs: &Arc<StdMutex<Vec<EngineLog>>>,
        current_call: &Arc<AtomicU64>,
    ) -> Result<(), String> {
        let http = self.http.clone();
        let store = self.store.clone();
        let update_alert = self
            .emitter
            .as_ref()
            .map(|e| (plugin_id.to_string(), e.clone()));
        ctx.async_with(async |ctx| {
            let inner: rquickjs::Result<()> = (|| {
                register_bridges(&ctx, &http, &store, logs, current_call, &update_alert)?;
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
}
