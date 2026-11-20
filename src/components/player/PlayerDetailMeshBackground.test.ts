import { describe, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';
import source from './PlayerDetailMeshBackground.vue?raw';

describe('player detail mesh background modes', () => {
  it('同时内置 polygon 与 fluid 两套片元着色器', () => {
    expectSourceContains(source, 'const FRAG_SRC = `#version 300 es');
    expectSourceContains(source, 'const FRAG_FLUID_SRC = `#version 300 es');
  });

  it('暴露 mode prop 并按模式切换 program', () => {
    expectSourceContains(source, 'mode?: MeshBackgroundMode;');
    expectSourceContains(source, 'function ensureProgram(mode: MeshBackgroundMode): boolean');
  });

  it('窗口拖拽缩放期间暂停逐帧渲染', () => {
    expectSourceContains(source, 'if (isWindowResizing.value) return;');
  });

  it('polygon 片元的色调常量保留在着色器 uniform 通路', () => {
    expectSourceContains(source, 'const SATURATION = 0.64;');
    expectSourceContains(source, 'const BRIGHTNESS = 0.98;');
    expectSourceContains(source, 'color = max(color, vec3(0.075));');
  });

  it('色场调色/模糊参数已外置到 meshFieldMath 预设', () => {
    expectSourceContains(source, "from './meshFieldMath'");
    expectSourceContains(source, 'buildCoverFieldFromPixels(data, preset)');
  });
});
