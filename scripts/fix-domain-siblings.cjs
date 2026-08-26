// Precise, idempotent relative-import fixer for the src/services -> domain move.
const fs = require('fs');
const path = require('path');
const root = 'src';
const servicesDir = path.resolve(root, 'services');
const domainDir = path.join(servicesDir, 'domain');

const movedFiles = new Map();
for (const f of fs.readdirSync(domainDir)) {
  const b = f.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
  movedFiles.set(b, { abs: path.join(domainDir, f), rel: f });
}

function walk(d = root, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p, acc); }
    else if (/\.(ts|tsx|vue|js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
function isModuleLine(line) {
  return /\b(import|export|require)\b|from\s*['"]|import\(\s*['"]/.test(line);
}
const relRe = /(['"])(\.\.?\/[^'"\n]+)\1/g;

function fixFile(absPath) {
  const dir = path.dirname(path.resolve(absPath));
  const lines = fs.readFileSync(absPath, 'utf8').split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!relRe.test(line) || !isModuleLine(line)) continue;
    relRe.lastIndex = 0;
    const replaced = line.replace(relRe, (m, q, spec) => {
      const oldAbs = path.resolve(dir, spec);
      let targetAbs = oldAbs;
      const b = spec.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
      const baseName = b.split('/').pop();
      if (movedFiles.has(baseName) && !oldAbs.startsWith(domainDir + path.sep)) {
        targetAbs = movedFiles.get(baseName).abs;
      }
      let newSpec = path.relative(dir, targetAbs).replace(/\\/g, '/');
      if (newSpec === spec) return m;
      if (!newSpec.startsWith('.')) newSpec = './' + newSpec;
      return `${q}${newSpec}${q}`;
    });
    if (replaced !== line) { lines[i] = replaced; changed = true; }
  }
  if (changed) {
    fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
    return true;
  }
  return false;
}

let n = 0;
for (const f of walk()) {
  if (fixFile(f)) { console.log('[fixed]', path.relative('.', f).replace(/\\/g, '/')); n++; }
}
console.log('files fixed:', n);