import { describe, expect, it } from 'vitest';

import source from './PlayerDetailLeft.vue?raw';

describe('player cover fallback', () => {
  it('shows a visible compact placeholder when the footer cover is unavailable', () => {
    expect(source).toContain('const showCoverPlaceholder = computed');
    expect(source).toContain('v-if="showCoverPlaceholder"');
    expect(source).toContain("props.isExpanded ? 'h-32 w-32' : 'h-6 w-6'");
    expect(source).toContain('from-zinc-100 to-zinc-200 text-zinc-400');
  });

  it('falls back when a non-empty cover URL fails to load', () => {
    expect(source).toContain('@error="onLocalCoverError"');
    expect(source).toContain('localCoverLoadFailed.value = true');
  });
});
