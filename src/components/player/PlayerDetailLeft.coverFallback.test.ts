import { describe, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';
import source from './PlayerDetailLeft.vue?raw';
import coverSource from '../../composables/useDetailCover.ts?raw';

describe('player cover fallback', () => {
  it('shows a visible compact placeholder when the footer cover is unavailable', () => {
    // placeholder 判定逻辑已抽入 useDetailCover 组合式函数
    expectSourceContains(coverSource, 'const showCoverPlaceholder = computed');
    expectSourceContains(source, 'v-if="showCoverPlaceholder"');
    expectSourceContains(source, "props.isExpanded ? 'h-32 w-32' : 'h-6 w-6'");
    expectSourceContains(source, 'from-zinc-100 to-zinc-200 text-zinc-400');
  });

  it('falls back when a non-empty cover URL fails to load', () => {
    expectSourceContains(source, '@error="onLocalCoverError"');
    expectSourceContains(coverSource, 'localCoverLoadFailed.value = true');
  });
});
