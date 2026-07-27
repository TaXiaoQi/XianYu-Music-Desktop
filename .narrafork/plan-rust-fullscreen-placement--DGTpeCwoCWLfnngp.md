# 全屏 ↔ 最大化 无小窗切换：根治方案

## 已查证的根因（读 tao 0.34.5 源码得出）
tao 的 `set_fullscreen` 在 Windows 上：
- **进全屏**（window.rs:777-783）：`GetWindowPlacement` 保存当前 placement 到 `saved_window`。
  `WINDOWPLACEMENT.showCmd` 会记录当时是否最大化。然后 `SetWindowPos` 用整个 monitor
  尺寸盖满屏（796-805），并 `taskbar_mark_fullscreen` 调 `ITaskbarList::MarkFullscreenWindow`
  隐藏任务栏（822）。
- **退全屏**（window.rs:809-818）：`SetWindowPlacement(hwnd, &saved)` 一步恢复。
  **如果 saved 的 showCmd 是 SW_SHOWMAXIMIZED，会直接恢复成最大化，不经过普通小窗。**

**结论**：小窗中间帧的真正来源，是我在 JS 层进全屏前调了 `unmaximize()`——
导致 tao 保存 placement 时窗口已是普通尺寸，showCmd 记成普通态，退出自然回小窗。
tao 本身完全有能力一步回到最大化。

## 关键矛盾（必须实测厘清）
之前有一版纯直切（无 unmaximize、无遮罩）实测反馈：
「最大化点全屏不能进全屏，任务栏周围有诡异的线」。
但从源码看 tao 直切应当可行且会隐藏任务栏。差异最可能来自本项目窗口配置：
`decorations: false` + `transparent: true`（无边框透明窗），无边框全屏在 tao 上有边界差异。

因此需要先用最小实验确认「无边框窗直切全屏」到底行不行，再决定走哪个方案。

## 方案 A（首选，改动最小）：去掉 JS 干预，让 tao placement 机制工作
仅改 `src/components/player/PlayerDetail.vue`：
- `toggleFullscreen`：直接 `setFullscreen(!isFullscreen)`，**不再 unmaximize/maximize**，
  移除遮罩与 sleep 时序（那些是失败方案的残留）。
- `toggleMaximize`：全屏态下点最大化 → 直接 `setFullscreen(false)`（tao 自动恢复最大化）；
  非全屏 → 原有 maximize/unmaximize。
- 进全屏若 OS 层仍有极短跳变，可保留一个**极短的同色遮罩**（详情页底色 #0b1222）纯做视觉柔化，
  但不再依赖它掩盖小窗（因为根治后没有小窗）。

**前提**：无边框窗直切全屏能成功且任务栏正常隐藏。若之前的「诡异的线」复现，方案 A 不成立。

## 方案 B（兜底，Rust 原生）：仅当方案 A 的直切在无边框窗下失败时采用
在 `src-tauri` 新增 `window_fullscreen.rs`，暴露一个 command
`toggle_immersive_fullscreen(window, enter: bool)`：
- 用项目现成写法拿 HWND（参考 taskbar.rs:117-120 的 `window_handle()` → `win32.hwnd`）。
- 进全屏：`GetWindowPlacement` 存到模块内 static（按 hwnd 存 showCmd/rect）→
  `SetWindowLongPtr` 去掉/调整样式 → `SetWindowPos` 覆盖 monitor 全区 →
  `ITaskbarList::MarkFullscreenWindow(hwnd, TRUE)` 隐藏任务栏。
- 退全屏：读回 static 的 placement → `SetWindowPlacement`（showCmd 若为 SW_SHOWMAXIMIZED
  则一步回最大化）→ `MarkFullscreenWindow(hwnd, FALSE)`。
- 依赖已就绪：`windows-sys` 0.59 已启用 `Win32_UI_WindowsAndMessaging`/`Win32_UI_Shell`/
  `Win32_Foundation`/`Win32_Graphics_Gdi`，`SetWindowPlacement`/`SetWindowPos`/
  `ITaskbarList` 均可用。
- 在 lib.rs 的 `generate_handler!` 注册；前端 `toggleFullscreen`/`toggleMaximize` 改调此 command。
- **风险**：绕过 tao 后，tao 内部 `window_state.fullscreen` 与实际不同步，
  `appWindow.isFullscreen()` 会失真。需要前端自己维护 `isFullscreen` 状态、不再查 tao；
  且要处理 F11/系统手势外部触发（onResized 里的 syncFullscreenState 将不可靠）。
  这是方案 B 的主要复杂度与隐患，非必要不采用。

## 执行顺序
1. 先做**方案 A**：改前端为直切、去掉 unmaximize 与遮罩时序。
2. eslint + vite build 静态验证。
3. **你实测**四个场景（见下）。重点确认：最大化→全屏能否成功、任务栏是否隐藏、有无「诡异的线」。
4. 若方案 A 实测通过 → 收工。
5. 若最大化→全屏仍失败/有诡异线 → 转**方案 B**（Rust 原生），并处理 isFullscreen 状态同步。

## 实测场景（tauri dev）
1. 最大化 → 全屏：成功进全屏、任务栏隐藏、无诡异的线？
2. 全屏 → 点全屏按钮退出：一步回到最大化，无小窗？
3. 全屏 → 点最大化按钮：退出全屏并变最大化、任务栏正常？
4. 普通窗口 → 全屏 → 退出：回到普通窗口？

## 影响文件
- 方案 A：仅 `src/components/player/PlayerDetail.vue`
- 方案 B（若需要）：新增 `src-tauri/src/window_fullscreen.rs` + 改 `lib.rs` + 改前端调用
