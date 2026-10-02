// 数据库集群入口：由连接调优（schema）、增量迁移（migrations）、
// 状态句柄（state）与数据清空（reset）四个子模块组成。

mod migrations; // 实现
mod reset;
mod schema;
mod state;

pub use reset::clear_all_app_data; // 实现
pub use state::DbState;

// 仅测试场景需要绕过迁移直接搭建基线表结构。
#[cfg(test)] // 实现
pub(crate) use schema::ensure_base_schema; // 实现
