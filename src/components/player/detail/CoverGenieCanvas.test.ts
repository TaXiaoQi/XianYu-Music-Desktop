// @vitest-environment happy-dom
// CoverGenieCanvas 组件级功能复现：真挂载 + 假定时器 + stub Image/getContext，
// 直接证明「漏斗确实逐帧绘制、done 在 700ms 发出、前置条件缺失立即 finish」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import CoverGenieCanvas from './CoverGenieCanvas.vue';

class FakeImage {
  static instances: FakeImage[] = [];
  referrerPolicy = '';
  decoding = '';
  naturalWidth = 800;
  naturalHeight = 800;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private loaded = false;

  set src(_value: string) {
    FakeImage.instances.push(this);
    if (this.loaded) {
      this.onload?.();
    }
  }

  load() {
    this.loaded = true;
    this.onload?.();
  }

  fail() {
    this.loaded = true;
    this.onerror?.();
  }
}

function makeFakeCtx() {
  return {
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
  };
}

const FROM = { x: 0, y: 100, w: 400, h: 400 };
const TO_ABOVE = { x: 20, y: 20, w: 60, h: 60 };

function makeToEl(rect: { x: number; y: number; width: number; height: number }) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      x: rect.x,
      y: rect.y,
    }) as DOMRect;
  return () => el;
}

function mountCanvas(props: Partial<Record<string, unknown>> = {}) {
  return mount(CoverGenieCanvas, {
    props: {
      src: 'cover://test',
      direction: 'exit',
      fromRect: FROM,
      toEl: makeToEl({ x: TO_ABOVE.x, y: TO_ABOVE.y, width: TO_ABOVE.w, height: TO_ABOVE.h }),
      ...props,
    },
  });
}

function teleportedCanvas(): HTMLElement | null {
  return document.body.querySelector('canvas');
}

let fakeCtx: ReturnType<typeof makeFakeCtx>;
let originalGetContext: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.body.innerHTML = '';
  originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  );
  fakeCtx = makeFakeCtx();
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => fakeCtx,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalGetContext) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
  }
  vi.useRealTimers();
});

describe('CoverGenieCanvas 屏幕空间漏斗', () => {
  it('exit 方向：首帧接近全幅 from，末帧收敛进 dock rect，约 700ms 发 done', () => {
    const wrapper = mountCanvas();

    expect(FakeImage.instances).toHaveLength(1);
    FakeImage.instances[0].load();
    vi.advanceTimersByTime(16); // 首个 rAF 帧

    const firstFrame = fakeCtx.drawImage.mock.calls;
    expect(firstFrame.length).toBeGreaterThan(8);
    // 首帧顶行（锚点行）：仍接近 from 全幅
    const [dx, dy, dw] = [firstFrame[0][5], firstFrame[0][6], firstFrame[0][7]];
    expect(dx).toBeLessThan(30);
    expect(dy).toBeLessThan(FROM.y + 20);
    expect(dw).toBeGreaterThan(FROM.w * 0.7);

    fakeCtx.drawImage.mockClear();
    vi.advanceTimersByTime(700);

    expect(wrapper.emitted('done')).toHaveLength(1);
    const calls = fakeCtx.drawImage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastFrame = calls.slice(-firstFrame.length); // 末帧（704ms 处 t=1）
    const anchor = lastFrame[0];
    const far = lastFrame[lastFrame.length - 1];
    // 末帧：整体落进 TO 矩形垂直范围；锚点行宽 > 远端行
    expect(anchor[6]).toBeGreaterThanOrEqual(TO_ABOVE.y - 1);
    expect(anchor[6] + anchor[8]).toBeLessThanOrEqual(TO_ABOVE.y + TO_ABOVE.h + 1);
    expect(anchor[7]).toBeGreaterThan(far[7]);
  });

  it('enter 方向：从收敛态起步，末帧恢复 from 全幅后 done', () => {
    const wrapper = mountCanvas({ direction: 'enter' });
    FakeImage.instances[0].load();
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(700);
    expect(wrapper.emitted('done')).toHaveLength(1);
    const calls = fakeCtx.drawImage.mock.calls;
    const last = calls[calls.length - 1];
    expect(last[5]).toBeLessThanOrEqual(FROM.x + 2);
    expect(last[7]).toBeGreaterThan(FROM.w * 0.9);
  });

  it('起点矩形缺失：立即 done 回退，不绘制', () => {
    const wrapper = mountCanvas({ fromRect: null });
    vi.advanceTimersByTime(50);
    expect(wrapper.emitted('done')).toHaveLength(1);
    expect(fakeCtx.drawImage).not.toHaveBeenCalled();
  });

  it('图片加载失败：立即 done 回退', () => {
    const wrapper = mountCanvas();
    FakeImage.instances[0].fail();
    vi.advanceTimersByTime(50);
    expect(wrapper.emitted('done')).toHaveLength(1);
    expect(fakeCtx.drawImage).not.toHaveBeenCalled();
  });

  it('done 后 teleported 画布隐藏', async () => {
    const wrapper = mountCanvas();
    FakeImage.instances[0].load();
    vi.advanceTimersByTime(750);
    expect(wrapper.emitted('done')).toHaveLength(1);
    await wrapper.vm.$nextTick();
    const canvas = teleportedCanvas();
    expect(canvas).not.toBeNull();
    expect(canvas!.style.display).toBe('none');
  });
});
