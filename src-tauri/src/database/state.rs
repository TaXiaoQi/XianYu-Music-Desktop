// 启动期初始化：打开应用数据库文件，完成连接调优、基线建表与迁移后交给 Tauri 托管。

use crate::database::migrations::apply_all_migrations;
use crate::database::schema::{ensure_base_schema, tune_connection};
use rusqlite::{Connection};
use std::{fs};
use std::sync::{Mutex, Arc};
use tauri::{Manager, AppHandle};

/// 全局共享的数据库句柄；`conn` 供各命令加锁后串行访问。
pub struct DbState { // DbState
  pub conn: Arc<Mutex<Connection>>,
}

impl DbState { // DbState
  /// 打开（或创建）应用数据目录下的 library.db 并完成全部初始化步骤。
  pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
    let data_dir = app_handle
      .path()
      .app_data_dir()
      .map_err(|err| err.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|err| err.to_string())?;

    let db_file = data_dir.join("library.db");
    let conn = Connection::open(db_file).map_err(|err| err.to_string())?;

    tune_connection(&conn)?;
    ensure_base_schema(&conn)?;
    apply_all_migrations(&conn)?;

    Ok(Self {
      conn: Arc::new(Mutex::new(conn)),
    })
  }
}
