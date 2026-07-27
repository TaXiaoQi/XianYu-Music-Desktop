# 全屏切换：消除闪烁 + 丝滑过渡动画

## 问题根因
退出全屏回到最大化时的闪烁，来自窗口状态切换的中间帧：
`setFullscreen(false)` 会先把窗口恢复到「进全屏前被 unmaximize 掉的普通小窗尺寸」，
紧接着 `maximize()` 再跳到最大化。中间那一帧普通小窗口被 OS 即时渲染出来，就是「闪一下」。

原生窗口的 resize 由操作系统即时执行，**无法直接对窗口本身加 CSS 缓动**。业界（Electron/Tauri）
通用做法是：**用一个覆盖全窗口的 DOM 遮罩层，在状态切换的瞬间盖住画面**，把 resize 跳变藏在
遮罩后面，同时给遮罩做淡入淡出，从而得到「丝滑过渡」的观感。

## 方案：遮罩层掩盖 + 淡入淡出

### 1. 新增遮罩状态与编排
在 `PlayerDetail.vue` 的 `<script setup>` 中：

- 新增 `const isWindowTransitioning = ref(false)` 控制遮罩显隐。
- 新增一个 `sleep` 小工具（`(ms) => new Promise(r => setTimeout(r, ms))`）。
- 新增两个时间常量：`OVERLAY_FADE = 180`（遮罩淡入/淡出时长，ms）、
  `WINDOW_SETTLE = 120`（原生 resize 落定的缓冲，ms）。

### 2. 重写 `toggleFullscreen`（编排时序）
统一走「先盖遮罩 → 改窗口状态 → 撤遮罩」，进出全屏都覆盖：

```
toggleFullscreen():
  if 正在过渡中: return           // 防连点重入
  try:
    next = !isFullscreen()
    isWindowTransitioning = true  // 遮罩淡入
    await sleep(OVERLAY_FADE)     // 等遮罩完全盖住，再动窗口
    if next:
      wasMaximizedBeforeFullscreen = await isMaximized()
      if wasMaximizedBeforeFullscreen: await unmaximize()
      await setFullscreen(true)
    else:
      await setFullscreen(false)
      if wasMaximizedBeforeFullscreen:
        await maximize()          // 这一步的小窗中间帧被遮罩挡住，不再可见
        wasMaximizedBeforeFullscreen = false
    isFullscreen.value = next
    await sleep(WINDOW_SETTLE)    // 等 OS resize 落定
  catch:
    showToast('切换全屏失败','error'); void syncFullscreenState()
  finally:
    isWindowTransitioning = false // 遮罩淡出，露出新布局
```

关键点：
- **遮罩先完全盖住再改窗口**，退出全屏→最大化的中间小窗帧被藏住，闪烁消除。
- `finally` 保证任何异常路径遮罩都会撤除，不会卡死黑屏。
- 加「正在过渡中」判断，避免动画期间连点造成状态错乱。

### 3. 新增遮罩 DOM
在模板根容器内、最顶层加一个覆盖全屏的固定遮罩：

```html
<Transition name="fs-overlay">
  <div
    v-if="isWindowTransitioning"
    class="pointer-events-none fixed inset-0 z-[9999] bg-black"
  ></div>
</Transition>
```

- 用纯黑遮罩（详情页本身是深色沉浸背景，纯黑过渡最不突兀，也彻底遮住任何底层跳变）。
- `pointer-events-none` 不拦截交互（过渡极短，且期间本就不应操作）。
- `z-[9999]` 高于顶栏与右键菜单。

### 4. 遮罩过渡动画（scoped CSS）
用 Vue `<Transition>` + CSS 控制淡入淡出，时长与 `OVERLAY_FADE` 对齐：

```css
.fs-overlay-enter-active,
.fs-overlay-leave-active {
  transition: opacity 180ms ease;
}
.fs-overlay-enter-from,
.fs-overlay-leave-to {
  opacity: 0;
}
```

（若项目已启用 prefers-reduced-motion 兜底，可顺带加一条把 transition 时长压到极小；
本次先与现有风格保持一致，不额外引入。）

## 不改动的部分
- `onResized` 同步逻辑保持不变：外部（F11/系统手势）触发的全屏变化仍能同步图标。
  注意此路径不经过 `toggleFullscreen`，因此不会触发遮罩动画，也不消费
  `wasMaximizedBeforeFullscreen`——与当前行为一致，本次不扩大范围处理。
- 全屏按钮本身、`toggleMaximize`、顶栏自动隐藏逻辑均不动。

## 验证
- `npx eslint src/components/player/PlayerDetail.vue`
- `npx vite build`
- 逻辑/构建可静态验证；**动画观感需你在 `npx tauri dev` 实测**：
  1. 最大化 → 点全屏：应平滑进入全屏，无小窗跳变。
  2. 全屏 → 点全屏退出：应平滑回到最大化，中间不再闪普通小窗。
  3. 普通窗口 → 全屏 → 退出：应回到普通窗口。
  4. 动画期间连点按钮：不应造成状态错乱。

## 影响文件
- `src/components/player/PlayerDetail.vue`（脚本编排 + 模板遮罩 + scoped 动画）
- 仅此一个文件，无新增依赖。
