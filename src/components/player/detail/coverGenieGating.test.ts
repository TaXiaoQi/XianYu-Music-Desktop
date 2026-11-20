// @vitest-environment happy-dom
// genie 门控链复现：真实挂载 PlayerDetailLeft，模拟父层的「翻转 + 静置窗」时序，
// 断言冻结 class 与 Teleport 画布随 covering 同起同落。补上源码断言测试测不到的
// 运行时环节（fromRect 预拾、computed 门控、props watcher 顺序）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

vi.mock('../../../features/playback/usePlaybackController', () => ({
  usePlaybackController: () => ({
    isPlaying: ref(false),
    dominantColors: ref(['#000000']),
  }),
}));

vi.mock('../../../composables/useDetailCover', () => ({
  useDetailCover: () => ({
    currentSongPath: ref('song://a'),
    displayedLocalCoverUrl: ref('cover://a'),
    currentBigCoverUrl: ref(''),
    showCoverPlaceholder: ref(false),
    fullCoverLoading: ref(false),
    bigCoverLoaded: ref(false),
    onBigCoverLoad: vi.fn(),
    onBigCoverError: vi.fn(),
    onLocalCoverError: vi.fn(),
  }),
}));

import PlayerDetailLeft from '../PlayerDetailLeft.vue';

class SilentImage {
  referrerPolicy = '';
  decoding = '';
  naturalWidth = 400;
  naturalHeight = 400;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    // 永不触发 onload/onerror：画布保持挂载，门控断言不受动画循环干扰
  }
}

const fakeCtx = {
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

let originalGetContext: PropertyDescriptor | undefined;

function fakeRect(x: number, y: number, width: number, height: number) {
  return () =>
    ({
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    }) as DOMRect;
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.stubGlobal('Image', SilentImage);
  document.body.innerHTML = '';
  originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => fakeCtx,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  if (originalGetContext) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
  }
  document.body.innerHTML = '';
});

describe('PlayerDetailLeft genie 门控（C7）', () => {
  it('关闭：genieActive 开启 + isExpanded 翻转 → 冻结 class 与画布同挂载；静置窗结束双双卸载；打开同链路', async () => {
    wrapper = mount(PlayerDetailLeft, {
      attachTo: document.body,
      props: { isExpanded: true, amll: true, genieActive: false, genieDirection: 'exit' },
      global: { stubs: { CoverReflection: true } },
    });
    await wrapper.vm.$nextTick();

    const stage = wrapper.find('.cover-stage').element as HTMLElement;
    expect(stage.classList.contains('cover-stage--open')).toBe(true);
    stage.getBoundingClientRect = fakeRect(100, 100, 300, 300);

    // —— 关闭：方向先记 exit，静置窗开启 + isExpanded 翻转（同一批 props 更新）——
    await wrapper.setProps({ genieActive: true, genieDirection: 'exit', isExpanded: false });
    await wrapper.vm.$nextTick();
    expect(stage.classList.contains('cover-stage--genie-frozen')).toBe(true);
    expect(document.body.querySelector('canvas')).not.toBeNull();
    expect(stage.classList.contains('cover-stage--docked')).toBe(true);

    // —— 静置窗结束：画布与冻结一起撤 ——
    await wrapper.setProps({ genieActive: false });
    await wrapper.vm.$nextTick();
    expect(stage.classList.contains('cover-stage--genie-frozen')).toBe(false);
    expect(document.body.querySelector('canvas')).toBeNull();

    // —— 打开：同链路反向 ——
    await wrapper.setProps({ genieActive: true, genieDirection: 'enter', isExpanded: true });
    await wrapper.vm.$nextTick();
    expect(stage.classList.contains('cover-stage--genie-frozen')).toBe(true);
    expect(document.body.querySelector('canvas')).not.toBeNull();
  });

  it('非 amll 皮肤：同样的父层时序也不启用 genie（classic/vinyl 零影响）', async () => {
    wrapper = mount(PlayerDetailLeft, {
      attachTo: document.body,
      props: { isExpanded: true, amll: false, genieActive: false, genieDirection: 'exit' },
      global: { stubs: { CoverReflection: true } },
    });
    await wrapper.vm.$nextTick();
    const stage = wrapper.find('.cover-stage').element as HTMLElement;
    stage.getBoundingClientRect = fakeRect(100, 100, 300, 300);

    await wrapper.setProps({ genieActive: true, genieDirection: 'exit', isExpanded: false });
    await wrapper.vm.$nextTick();
    expect(stage.classList.contains('cover-stage--genie-frozen')).toBe(false);
    expect(document.body.querySelector('canvas')).toBeNull();
  });

  it('快速连点：genieActive 保持时再次翻转仍重挂画布（cycle 键）', async () => {
    wrapper = mount(PlayerDetailLeft, {
      attachTo: document.body,
      props: { isExpanded: true, amll: true, genieActive: true, genieDirection: 'exit' },
      global: { stubs: { CoverReflection: true } },
    });
    await wrapper.vm.$nextTick();
    const stage = wrapper.find('.cover-stage').element as HTMLElement;
    stage.getBoundingClientRect = fakeRect(100, 100, 300, 300);

    // 已在静置窗内再次翻转（模拟开→关快速连点，genieActive 未回落）
    await wrapper.setProps({ isExpanded: false });
    await wrapper.vm.$nextTick();
    expect(stage.classList.contains('cover-stage--genie-frozen')).toBe(true);
    expect(document.body.querySelectorAll('canvas').length).toBe(1);

    await wrapper.setProps({ genieDirection: 'enter', isExpanded: true });
    await wrapper.vm.$nextTick();
    expect(document.body.querySelectorAll('canvas').length).toBe(1);
  });
});
