import { usePlaybackStore } from '../features/playback/store';

/**
 * 「飞入封面」动画：从歌曲列表中被点击的歌曲行封面，飞到底栏封面位置。
 * 用于掩盖点击播放到实际起播之间的卡顿与延迟。
 *
 * 实现：通过 [data-cover-path] 定位列表中的源封面元素、[data-footer-cover] 定位底栏目标，
 * 创建一个脱离文档流的 <img> 叠加在 body 上，用 Web Animations API 做平移 + 缩放动画。
 *
 * 关键：飞抵底栏后「悬停」在目标位置（保持半透明覆盖），等待底栏 currentCover 真正更新为新封面后
 * 再淡出 —— 这样即使在线歌曲需要 URL 解析等耗时操作，飞入的封面也能持续遮盖底栏的旧封面，
 * 直至新封面就绪，避免出现旧封面闪现。
 *
 * 调用方需提供与列表行 [data-cover-path] 一致的 songPath，以及该行当前展示的封面 URL。
 *
 * 返回值：Promise<void>，在飞行动画（封面从列表飞抵底栏）结束后 resolve。
 * playSong 内部会在调用 playAudio 前 await 此 Promise（通过 consumeFlyCoverPromise），
 * 确保封面飞到底部栏后才开始播放音频。
 * 若动画未能启动（找不到元素、无封面 URL 等），Promise 立即 resolve，不阻塞调用方。
 */

const FLY_DURATION = 520;
const FADE_DURATION = 220;
const FLY_EASING = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
/** 悬停等待底栏封面更新的最长时间；超时后无论如何淡出 */
const PARK_TIMEOUT = 3000;

let currentFlyId = 0;

/**
 * 当前飞封面动画的飞行 Promise（封面从列表飞抵底栏）。
 * playSong 在调用 playAudio 前会 await 此 Promise，
 * 确保封面飞到底部栏后才开始播放音频。
 */
let currentFlyPromise: Promise<void> | null = null;

/** 获取当前飞封面飞行 Promise（如有），用于 playSong 同步等待 */
export function getFlyCoverPromise(): Promise<void> | null {
  return currentFlyPromise;
}

/** 消费（取出并清除）当前飞封面 Promise，避免后续 playSong 误等旧 Promise */
export function consumeFlyCoverPromise(): Promise<void> | null {
  const promise = currentFlyPromise;
  currentFlyPromise = null;
  return promise;
}

/** CSS 属性选择器转义：反斜杠在 CSS 选择器中是转义符，必须双写；双引号也需转义 */
const escAttr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const findSourceEl = (songPath: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-cover-path="${escAttr(songPath)}"]`);

const findTargetEl = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-footer-cover]');

/**
 * 触发飞入封面动画。在歌曲列表「点击播放」时调用。
 *
 * 返回 Promise<void>：在飞行动画（封面从列表飞抵底栏位置）结束后 resolve。
 * 调用方通常不需要 await 此 Promise —— 飞封面动画与 playSong 应并行执行，
 * 动画用于掩盖起播延迟，动画结束时歌曲应已加载就绪或即将就绪。
 *
 * 若动画未能启动（找不到元素、无封面 URL、图片加载失败等），Promise 立即 resolve。
 *
 * @param songPath  歌曲路径（需与列表行 [data-cover-path] 的值一致）
 * @param coverUrl  列表行当前展示的封面 URL；为空则尝试从源元素 <img> 中提取
 */
export function launchFlyingCover(songPath: string, coverUrl: string): Promise<void> {
  const flyPromise = new Promise<void>((resolve) => {
    if (!songPath) { resolve(); return; }
    const flyId = ++currentFlyId;

    const sourceEl = findSourceEl(songPath);
    const targetEl = findTargetEl();
    if (!sourceEl || !targetEl) { resolve(); return; }

    // 若调用方未提供封面 URL（本地歌曲封面可能尚未异步加载完成），
    // 回退到源元素内 <img> 的 src，确保动画仍能触发
    const resolvedCoverUrl = coverUrl
      || (sourceEl.querySelector('img') as HTMLImageElement | null)?.src
      || '';
    if (!resolvedCoverUrl) { resolve(); return; }

    const fromRect = sourceEl.getBoundingClientRect();
    const toRect = targetEl.getBoundingClientRect();
    if (fromRect.width === 0 || fromRect.height === 0 || toRect.width === 0 || toRect.height === 0) {
      resolve();
      return;
    }

    const img = document.createElement('img');
    img.src = resolvedCoverUrl;
    img.alt = '';
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    img.style.cssText =
      `position:fixed;left:0;top:0;width:${fromRect.width}px;height:${fromRect.height}px;` +
      `border-radius:8px;object-fit:cover;pointer-events:none;will-change:transform,opacity;` +
      `box-shadow:0 6px 20px rgba(0,0,0,0.25);z-index:9999;` +
      `transform:translate(${fromRect.left}px, ${fromRect.top}px);opacity:1;`;
    document.body.appendChild(img);

    const remove = () => {
      if (flyId === currentFlyId) img.remove();
    };

    const startFlight = () => {
      if (flyId !== currentFlyId) {
        img.remove();
        resolve();
        return;
      }

      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;
      const sx = toRect.width / fromRect.width;
      const sy = toRect.height / fromRect.height;

      // 中段略微抬升 + 放大，营造「飞」的弧线感
      const midX = dx * 0.5;
      const midY = dy * 0.5 - Math.min(60, Math.abs(dy) * 0.25 + 24);
      const midScale = 1.12;

      const flight = img.animate(
        [
          {
            transform: `translate(${fromRect.left}px, ${fromRect.top}px) scale(1, 1)`,
            opacity: 1,
            offset: 0,
          },
          {
            transform: `translate(${fromRect.left + midX}px, ${fromRect.top + midY}px) scale(${midScale}, ${midScale})`,
            opacity: 1,
            offset: 0.5,
          },
          {
            transform: `translate(${toRect.left}px, ${toRect.top}px) scale(${sx}, ${sy})`,
            opacity: 0.92,
            offset: 1,
          },
        ],
        { duration: FLY_DURATION, easing: FLY_EASING, fill: 'forwards' },
      );

      // 飞行动画结束：resolve Promise（调用方通常不 await），然后进入悬停阶段
      flight.onfinish = () => {
        resolve();
        parkAtTarget();
      };
      flight.oncancel = () => {
        remove();
        resolve();
      };
    };

    /** 飞抵底栏后悬停，等底栏 currentCover 更新为新封面后再淡出 */
    const parkAtTarget = () => {
      if (flyId !== currentFlyId) {
        img.remove();
        return;
      }

      const store = usePlaybackStore();
      const startCover = store.currentCover;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearInterval(poll);
        clearTimeout(timer);
        const fade = img.animate(
          [{ opacity: 0.92, offset: 0 }, { opacity: 0, offset: 1 }],
          { duration: FADE_DURATION, fill: 'forwards' },
        );
        fade.onfinish = remove;
        fade.oncancel = remove;
      };

      // 轮询底栏封面：一旦更新（且非初始值）即淡出
      const poll = setInterval(() => {
        if (flyId !== currentFlyId) {
          clearInterval(poll);
          clearTimeout(timer);
          remove();
          return;
        }
        const cur = store.currentCover;
        if (cur && cur !== startCover) finish();
      }, 40);

      // 超时兜底：避免异常情况下永久悬停
      const timer = setTimeout(finish, PARK_TIMEOUT);

      // 本地歌曲通常 currentCover 已同步更新：稍等即淡出
      if (store.currentCover && store.currentCover === resolvedCoverUrl) {
        setTimeout(finish, 80);
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      startFlight();
    } else {
      img.onload = startFlight;
      img.onerror = () => {
        remove();
        resolve();
      };
      // 加载稍慢也强制起跳，避免空图久等
      setTimeout(() => {
        if (flyId === currentFlyId && img.isConnected) {
          startFlight();
        } else if (flyId === currentFlyId) {
          // 图片已断开（可能被取消），确保 resolve
          resolve();
        }
      }, 60);
    }
  });

  // 记录当前飞封面 Promise，供 playSong 在 playAudio 前 await
  currentFlyPromise = flyPromise;
  return flyPromise;
}

/** 取消当前正在进行的飞入动画 */
export function cancelFlyingCover(): void {
  currentFlyId++;
}
