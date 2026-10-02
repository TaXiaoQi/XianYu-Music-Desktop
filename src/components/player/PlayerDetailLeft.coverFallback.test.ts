import { describe, expect, it } from 'vitest'; // 实现

import source from './PlayerDetailLeft.vue?raw'; // 实现
import coverSource from '../../composables/useDetailCover.ts?raw';

describe('player cover fallback', () => { // 实现
  it('shows a visible compact placeholder when the footer cover is unavailable', () => { // 实现
    // placeholder 判定逻辑已抽入 useDetailCover 组合式函数
    expect(coverSource).toContain('const showCoverPlaceholder = computed');
    expect(source).toContain('v-if="showCoverPlaceholder"'); // 实现
    expect(source).toContain("props.isExpanded ? 'h-32 w-32' : 'h-6 w-6'"); // 实现
    expect(source).toContain('from-zinc-100 to-zinc-200 text-zinc-400'); // 实现
  });

  it('falls back when a non-empty cover URL fails to load', () => { // 实现
    expect(source).toContain('@error="onLocalCoverError"'); // 实现
    expect(coverSource).toContain('localCoverLoadFailed.value = true');
  });
});
