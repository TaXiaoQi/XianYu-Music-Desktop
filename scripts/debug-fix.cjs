const fs = require('fs');
const path = require('path');
const domainDir = path.resolve('src/services/domain');
const movedFiles = new Map();
for (const f of fs.readdirSync(domainDir)) {
  movedFiles.set(f.replace(/\.(ts|tsx|js|mjs|cjs)$/, ''), f);
}
const movedSorted = [...movedFiles.keys()].sort((a, b) => b.length - a.length);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const absRe = new RegExp(`services/(?:${movedSorted.map(esc).join('|')})(?=[/'\\"\\.\\s]|$)`, 'g');
const relRe = /(['"])(\.[^'"\n]+)\1/g;
const MODULE_RE = /\b(import|export|require)\b|from\s*['"]|\bimport\s*\(|vi\.(?:mock|mockDeep|mocked|importActual|importMock|doMock|unmock)\s*\(/;
function isModuleLine(line) { return MODULE_RE.test(line); }

const lines = {
  'announcement': "import { getDeviceId } from '../services/usageStats';",
  'remoteSong': "import { LX_SOURCE_NAMES, type LxSourceId } from '../services/lxMusicSdk';",
  'usageStats': "import { APP_VERSION } from '../../version';",
};
for (const [k, line] of Object.entries(lines)) {
  let out = line;
  const absMatch = absRe.exec(out);
  const afterAbs = out.replace(absRe, (m) => 'services/domain/' + m.slice('services/'.length));
  const relMatch = relRe.exec(out);
  let afterRel = out;
  if (relRe.test(out)) {
    relRe.lastIndex = 0;
    afterRel = out.replace(relRe, (m, q, spec) => {
      const oldAbs = path.resolve(k === 'usageStats' ? path.resolve('src/services') : path.resolve(path.dirname(path.resolve('src/utils/' + (k === 'announcement' ? 'announcement.ts' : 'remoteSong.ts')))), spec);
      return `${q}${'<recomputed>'}${q}`;
    });
  }
  console.log(`[${k}]`);
  console.log('  isModuleLine:', isModuleLine(line));
  console.log('  absRe matched:', absMatch, '-> afterAbs:', afterAbs);
  console.log('  relRe lastIndex after:');
}