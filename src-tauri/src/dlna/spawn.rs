use std::sync::OnceLock;
use tokio::runtime::{Builder, Runtime};

static RT: OnceLock<Runtime> = OnceLock::new();

pub fn global_runtime() -> &'static Runtime {
    RT.get_or_init(|| {
        Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("dlna-rt")
            .enable_all()
            .build()
            .expect("failed to build dlna tokio runtime")
    })
}

pub fn spawn_persistent<F>(fut: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    global_runtime().spawn(fut);
}
