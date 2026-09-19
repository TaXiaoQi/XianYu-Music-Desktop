function parseVersionParts(v: string): Array<number | string> {
  const s = String(v)
    .trim()
    .replace(/^[vV]\s*/, '')
    .replace(/(\d)([a-zA-Z])/g, '$1.$2')
    .replace(/([a-zA-Z])(\d)/g, '$1.$2');
  const parts = s.split(/[.\-_+]+/).filter(p => p.length > 0);
  return parts.map(p => (/^\d+$/.test(p) ? parseInt(p, 10) : p.toLowerCase()));
}

function compareVersionToken(a: number | string, b: number | string): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return a - b;
  if (aNum) return 1;
  if (bNum) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersionParts(a);
  const vb = parseVersionParts(b);
  const maxLen = Math.max(va.length, vb.length);
  for (let i = 0; i < maxLen; i++) {
    const ta = i < va.length ? va[i] : 0;
    const tb = i < vb.length ? vb[i] : 0;
    const diff = compareVersionToken(ta, tb);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function extractMusicFreeVersion(script: string): string | null {
  const propMatches = [...script.matchAll(/[{,]\s*version\s*:\s*['"]([^'"]+)['"]/g)];
  if (propMatches.length > 0) {
    return propMatches[propMatches.length - 1][1];
  }

  const match = script.match(/version\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

export function extractMusicFreeSrcUrl(script: string): string | null {
  const propMatches = [...script.matchAll(/[{,]\s*srcUrl\s*:\s*['"]([^'"]+)['"]/g)];
  if (propMatches.length > 0) {
    return propMatches[propMatches.length - 1][1];
  }

  const match = script.match(/srcUrl\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}