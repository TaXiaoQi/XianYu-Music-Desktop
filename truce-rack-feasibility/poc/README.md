# truce-rack PoC 归档（2026-08-20）

本目录归档可行性研究（见 `../truce-rack-feasibility.html`）的全部可复现产物。
原始工作目录在 `%TEMP%`（会被系统清理），此处为持久副本。

## 文件清单

| 文件 | 说明 |
|------|------|
| `patched-truce-rack-vst3-lib.rs` | truce-rack 1.1.5 `crates/truce-rack-vst3/src/lib.rs` 的补丁版。**补丁点：`Vst3Plugin` 结构体 `_module: LoadedModule` 字段移至末尾**，保证 DLL 在 COM 指针释放之后才卸载，修复实例 drop 时的 STATUS_ACCESS_VIOLATION。 |
| `patched-truce-rack-clap-lib.rs` | truce-rack 1.1.5 `crates/truce-rack-clap/src/lib.rs` 的补丁版。**补丁点：`load_from` 以静态 `MINIMAL_HOST`（含版本/名称/无操作回调）替代空 `clap_host` 指针**，修复插件加载时的 STATUS_STACK_BUFFER_OVERRUN。 |
| `harness-main.rs` | 端到端测试 harness：扫描 → 加载 → 激活 → 设参 → DSP 验证（2s 1kHz 正弦，RMS 比对）→ 状态往返 → 销毁。注意 VST3 分支 `set_before_activate=true`（激活后设参被上游静默丢弃）。 |
| `harness-Cargo.toml` | harness 的 Cargo 配置，含 `[patch]` 本地指向打过补丁的 truce-rack 源码。 |

## 复现步骤

1. 还原 truce-rack 1.1.5 源码（git clone 或 crates.io 下载），用上面两个补丁文件覆盖对应 `lib.rs`。
2. 新建 cargo 项目，放入 `harness-main.rs` / `harness-Cargo.toml`，修正 `[patch]` 路径。
3. 测试插件：nih-plug `plugins/examples/gain`，`cargo xtask bundle gain --release` 同时产出 VST3 + CLAP bundle，安装到 `%LOCALAPPDATA%\Programs\Common\VST3` 与 `%LOCALAPPDATA%\Programs\Common\CLAP`。
4. `cargo run --release`，期望输出：双格式 DSP ratio ≈ 0.5003，无崩溃。

## 后续落地（报告 §7）

- 两个补丁优先以 fork PR 提交上游；短期内以 `[patch.crates-io]` + vendor 目录方式合入主工程。
- 主工程新建 `src-tauri/src/player/plugin_host/` 模块（scanner / host / source 三层，见报告 §6.3）。
- 插入点：`sound_effect` 之后、`UserVolumeSource` 之前，双输出路径（runtime.rs 共享模式、wasapi_exclusive.rs 独占模式）opt-in，与移植组零冲突。
- 引入 2–3 款真实免费插件做兼容性冒烟，建立崩溃插件黑名单机制。
