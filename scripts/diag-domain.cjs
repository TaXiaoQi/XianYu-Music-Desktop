const fs = require('fs');
const path = require('path');
function w(d, a = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) w(p, a); }
    else if (/\.(ts|tsx|vue|js|mjs|cjs)$/.test(e.name)) a.push(p);
  }
  return a;
}
const files = w('src');
// moved basenames including test variants, without extension
const movedSet = new Set();
for (const f of fs.readdirSync('src/services/domain')) {
  movedSet.add(f.replace(/\.(ts|tsx|js)$/, ''));
}
function base(p) { return path.basename(p).replace(/\.(ts|tsx|js|mjs|cjs)$/, ''); }

console.log('=== 1) /src/services/<moved> absolute refs ===');
const abs = [];
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/['"](\/src\/services\/([^'"]+))['"]/);
    if (m) { abs.push(`${path.relative('.', f).replace(/\\/g, '/')}:${i + 1}: ${m[1]}`); }
  }
}
console.log(abs.join('\n') || '(none)');

console.log('\n=== 2) sibling ../<moved> in domain files ===');
const sib = [];
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  const rel = path.relative('.', f).replace(/\\/g, '/');
  if (!rel.startsWith('src/services/domain/')) continue;
  const lines = c.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const mm = lines[i].match(/['"]\.\.\/([^'"\n]+)['"]/);
    if (mm) {
      const t = mm[1].replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
      if (movedSet.has(t)) sib.push(`${rel}:${i + 1}: ../${mm[1]}`);
    }
  }
}
console.log(sib.join('\n') || '(none)');