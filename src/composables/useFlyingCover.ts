import { ref } from 'vue';
import { usePlaybackStore } from '../features/playback/store';

const FLY_DURATION = 520;
const FADE_DURATION = 220;
const FLY_EASING = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
const PARK_TIMEOUT = 3000;

let currentFlyId = 0;

export const isFlyingCover = ref(false);

let currentFlyPromise: Promise<void> | null = null;

export function consumeFlyCoverPromise(): Promise<void> | null {
  const promise = currentFlyPromise;
  currentFlyPromise = null;
  return promise;
}

const escAttr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const findSourceEl = (songPath: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-cover-path="${escAttr(songPath)}"]`);

const findTargetEl = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-footer-cover]');

export function launchFlyingCover(songPath: string, coverUrl: string): Promise<void> {
  const flyPromise = new Promise<void>((resolve) => {
    if (!songPath) { resolve(); return; }
    const flyId = ++currentFlyId;

    const sourceEl = findSourceEl(songPath);
    const targetEl = findTargetEl();
    if (!sourceEl) { resolve(); return; }

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

    const resolveCoverUrl = (): string =>
      (sourceEl.querySelector('img') as HTMLImageElement | null)?.src
      || coverUrl
      || '';

    /** 动画执行段：el 已按起点矩形定位，飞向播放条封面并停靠淡出。 */
    const animateFlight = (flyEl: HTMLElement) => {
      if (flyId !== currentFlyId) { resolve(); return; }

      isFlyingCover.value = true;
      flyEl.style.cssText +=
        `position:fixed;left:0;top:0;width:${fromRect.width}px;height:${fromRect.height}px;` +
        `border-radius:8px;pointer-events:none;will-change:transform,opacity;` +
        `box-shadow:0 6px 20px rgba(0,0,0,0.25);z-index:9999;` +
        `transform:translate(${fromRect.left}px, ${fromRect.top}px);opacity:1;`;
      document.body.appendChild(flyEl);

      const remove = () => {
        if (flyId === currentFlyId) flyEl.remove();
        if (flyId === currentFlyId) isFlyingCover.value = false;
      };

      const startFlight = () => {
        if (flyId !== currentFlyId) {
          flyEl.remove();
          resolve();
          return;
        }

        const dx = toRect.left - fromRect.left;
        const dy = toRect.top - fromRect.top;
        const sx = toRect.width / fromRect.width;
        const sy = toRect.height / fromRect.height;

        const midX = dx * 0.5;
        const midY = dy * 0.5 - Math.min(60, Math.abs(dy) * 0.25 + 24);
        const midScale = 1.12;

        const flight = flyEl.animate(
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

        flight.onfinish = () => {
          resolve();
          parkAtTarget();
        };
        flight.oncancel = () => {
          remove();
          resolve();
        };
      };

      const parkAtTarget = () => {
        if (flyId !== currentFlyId) {
          flyEl.remove();
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
          const fade = flyEl.animate(
            [{ opacity: 0.92, offset: 0 }, { opacity: 0, offset: 1 }],
            { duration: FADE_DURATION, fill: 'forwards' },
          );
          fade.onfinish = remove;
          fade.oncancel = remove;
        };

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

        const timer = setTimeout(finish, PARK_TIMEOUT);

        if (store.currentCover && store.currentCover === url0) {
          setTimeout(finish, 80);
        }
      };

      startFlight();
    };

    /** 起飞图 URL（供停靠淡出判定），闭包内可读。 */
    let url0 = '';

    function beginFlight(url: string) {
      if (flyId !== currentFlyId) { resolve(); return; }
      url0 = url;

      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.setAttribute('aria-hidden', 'true');
      img.style.cssText =
        `object-fit:cover;`;

      let started = false;
      const start = () => {
        if (started || flyId !== currentFlyId) return;
        started = true;
        animateFlight(img);
      };
      if (img.complete && img.naturalWidth > 0) {
        start();
      } else {
        img.onload = start;
        img.onerror = () => {
          if (!started) { started = true; resolve(); return; }
          img.remove();
          isFlyingCover.value = false;
          resolve();
        };
        setTimeout(() => start(), 60);
      }
    }

    /** 无封面可飞：克隆行内封面占位（灰底+音符），同样飞一遍。 */
    const flyGhost = () => {
      if (flyId !== currentFlyId) { resolve(); return; }
      const ghost = document.createElement('div');
      ghost.style.cssText =
        `background-color:${getComputedStyle(sourceEl).backgroundColor};` +
        `display:flex;align-items:center;justify-content:center;overflow:hidden;`;
      const svg = sourceEl.querySelector('svg');
      if (svg) ghost.appendChild(svg.cloneNode(true));
      animateFlight(ghost);
    };

    const resolvedCoverUrl = resolveCoverUrl();

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
          // 网盘等无封面曲目：飞占位封面，保证飞行动效不缺席
          flyGhost();
        }
      }, POLL_MS);
      return;
    }

    beginFlight(resolvedCoverUrl);
  });

  currentFlyPromise = flyPromise;
  return flyPromise;
}
