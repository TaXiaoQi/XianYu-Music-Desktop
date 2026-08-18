import { ref } from 'vue';
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
 * 飞封面动画是否正在进行（含飞行 + 悬停淡出阶段）。
 * PlayerDetailLeft 据此暂缓底栏封面显示，避免飞行中底栏已出现封面图标。
 */
export const isFlyingCover = ref(false);

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
    if (!sourceEl) { resolve(); return; }

    // 第一首歌播放时，launchFlyingCover 在 emit('play') 之前调用，
    // 此时 currentSong 仍为 null → PlayerFooter 尚未挂载 → [data-footer-cover] 找不到。
    // 轻量兜底：用底栏封面的固定坐标（左下角，48px 封面 + 16px 边距）作为飞行终点，
    // 不等待目标元素挂载，避免轮询延迟影响体感。
    const fromRect = sourceEl.getBoundingClientRect();
    const toRect = targetEl
      ? targetEl.getBoundingClientRect()
      : {
          left: 16,
          top: window.innerHeight - 64,
          width: 48,
          height: 48,
        };
    if (fromRect.width === 0 || fromRect.height === 0 || toRect.width === 0 || toRect.height === 0) {
      resolve();
      return;
    }

    // 优先使用源元素内已渲染的 <img> src（可能是代理后的 data: URL），
    // 其次回退到调用方提供的 coverUrl（原始 URL）。
    // 这样在线歌曲列表中已代理的封面能直接用于飞行动画，
    // 避免原始 URL 因 CDN 防盗链 403 导致飞封面图片加载失败。
    const resolveCoverUrl = (): string =>
      (sourceEl.querySelector('img') as HTMLImageElement | null)?.src
      || coverUrl
      || '';

    const resolvedCoverUrl = resolveCoverUrl();

    // 封面可能尚未加载完成（如播放队列为空时首次播放，封面异步提取中）。
    // 短暂轮询源元素内 <img> 的出现，最多等待 300ms，避免动画因封面未就绪而跳过。
    if (!resolvedCoverUrl) {
      let elapsed = 0;
      const POLL_MS = 50;
      const MAX_WAIT_MS = 300;
      const pollCover = setInterval(() => {
        if (flyId !== currentFlyId) {
          clearInterval(pollCover);
          resolve();
          return;
        }
        elapsed += POLL_MS;
        const url = resolveCoverUrl();
        if (url) {
          clearInterval(pollCover);
          beginFlight(url);
        } else if (elapsed >= MAX_WAIT_MS) {
          clearInterval(pollCover);
          resolve();
        }
      }, POLL_MS);
      return;
    }

    beginFlight(resolvedCoverUrl);

    function beginFlight(url: string) {
      if (flyId !== currentFlyId) { resolve(); return; }

      isFlyingCover.value = true;

      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.setAttribute('aria-hidden', 'true');
      img.style.cssText =
        `position:fixed;left:0;top:0;width:${fromRect.width}px;height:${fromRect.height}px;` +
        `border-radius:8px;object-fit:cover;pointer-events:none;will-change:transform,opacity;` +
        `box-shadow:0 6px 20px rgba(0,0,0,0.25);z-index:9999;` +
        `transform:translate(${fromRect.left}px, ${fromRect.top}px);opacity:1;`;
      document.body.appendChild(img);

      const remove = () => {
        if (flyId === currentFlyId) img.remove();
        if (flyId === currentFlyId) isFlyingCover.value = false;
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
        if (store.currentCover && store.currentCover === url) {
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
            // 图片已断开（可能被取消），确保 resolve 并清除飞行标志
            isFlyingCover.value = false;
            resolve();
          }
        }, 60);
      }
    }
  });

  // 记录当前飞封面 Promise，供 playSong 在 playAudio 前 await
  currentFlyPromise = flyPromise;
  return flyPromise;
}

/** 取消当前正在进行的飞入动画 */
export function cancelFlyingCover(): void {
  currentFlyId++;
  isFlyingCover.value = false;
}
