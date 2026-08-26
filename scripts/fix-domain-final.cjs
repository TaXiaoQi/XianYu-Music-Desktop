// Comprehensive import fixer for src/services -> domain move.
// Runs over CLEAN (pre-edit) content. Handles:
//  (a) absolute-ish specifiers `services/<moved>` and `/src/services/<moved>` -> domain
//  (b) every relative (. / ..) string-literal specifier on any line (import/export/require/
//      vi.mock/vi.importActual/from/import() and plain path strings),
//      relocated by mapping moved-module targets to their new domain location.
const fs = require('fs');
const path = require('path');
const root = 'src';
const servicesDir = path.resolve(root, 'services');
const domainDir = path.join(servicesDir, 'domain');

const movedBase = new Set(); // base-without-ext -> true
const movedFiles = new Map(); // base-without-ext -> reldir
for (const f of fs.readdirSync(domainDir)) {
  const b = f.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
  movedBase.add(b);
  movedFiles.set(b, f);
}

function isMovedModule(oldAbs) {
  const dir = path.dirname(oldAbs);
  if (dir !== servicesDir) return false; // only the original top-level src/services/<base> count
  const b = path.basename(oldAbs).replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
  return movedBase.has(b);
}
// Map an OLD absolute target to its NEW absolute location.
function mapTarget(oldAbs) {
  if (isMovedModule(oldAbs)) {
    return path.join(domainDir, path.basename(oldAbs));
  }
  return oldAbs;
}

function walk(d = root, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p, acc); }
    else if (/\.(ts|tsx|vue|js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const relRe = /(['"])(\.[^'"\n]+)\1/g;
// Only rewrite relative specifiers on genuine module-directive lines (incl. vi.mock family),
// never on regex literals, data strings, or string-assertions ('%s', '.flac', etc.).
const MODULE_RE = /\b(import|export|require)\b|from\s*['"]|\bimport\s*\(|vi\.(?:mock|mockDeep|mocked|importActual|importMock|doMock|unmock)\s*\(/;
function isModuleLine(line) { return MODULE_RE.test(line); }

function fix(absPath) {
  const curDir = path.dirname(path.resolve(absPath));
  const isMovedFile = curDir === domainDir; // files moved from src/services -> domain
  const oldDir = isMovedFile ? servicesDir : curDir;
  const originalContent = fs.readFileSync(absPath, 'utf8');

  // (a) absolute specifiers `services/<moved>` / `/src/services/<moved>`
  const movedSorted = [...movedFiles.keys()].sort((a, b) => b.length - a.length);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absRe = new RegExp(`services/(?:${movedSorted.map(esc).join('|')})(?=[/'\\"\\.\\s]|$)`, 'g');

  const lines = originalContent.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !isModuleLine(line)) continue;
    let out = line;

    // (a) absolute -> domain
    out = out.replace(absRe, (m) => 'services/domain/' + m.slice('services/'.length));

    // (b) relative specifier relocation
    if (relRe.test(out)) {
      relRe.lastIndex = 0;
      out = out.replace(relRe, (m, q, spec) => {
        const oldAbs = path.resolve(oldDir, spec);
        const newAbs = mapTarget(oldAbs);
        const newSpec = path.relative(curDir, newAbs).replace(/\\/g, '/');
        if (newSpec === spec) return m;
        return `${q}${newSpec.startsWith('.') ? newSpec : './' + newSpec}${q}`;
      });
    }

    if (out !== line) { lines[i] = out; changed = true; }
  }
  if (!changed) return false;
  fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
  return true;
}

let n = 0;
for (const f of walk()) {
  if (fix(f)) { console.log('[fixed]', path.relative('.', f).replace(/\\/g, '/')); n++; }
}
console.log('files fixed:', n);