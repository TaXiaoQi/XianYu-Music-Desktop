import { ref } from 'vue';
import { usePlaybackStore } from '../features/playback/store';


const FLY_DURATION = 520;
const FADE_DURATION = 220;
const FLY_EASING = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
const PARK_TIMEOUT = 3000;

let currentFlyId = 0;

export const isFlyingCover = ref(false);

let currentFlyPromise: Promise<void> | null = null;

export function getFlyCoverPromise(): Promise<void> | null {
  return currentFlyPromise;
}

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
        setTimeout(() => {
          if (flyId === currentFlyId && img.isConnected) {
            startFlight();
          } else if (flyId === currentFlyId) {
            isFlyingCover.value = false;
            resolve();
          }
        }, 60);
      }
    }
  });

  currentFlyPromise = flyPromise;
  return flyPromise;
}

export function cancelFlyingCover(): void {
  currentFlyId++;
  isFlyingCover.value = false;
}
