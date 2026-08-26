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
const moved = new Set();
for (const f of fs.readdirSync('src/services/domain')) moved.add(f.replace(/\.(ts|tsx|js)$/, ''));
function from(rel) { return rel.startsWith('src/services/domain/'); }
let hits = 0;
for (const f of files) {
  const rel = path.relative('.', f).replace(/\\/g, '/');
  if (from(rel)) continue; // domain handled separately
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // bare ../<moved> that is NOT under services/domain (i.e. wrong depth)
    const m = lines[i].match(/['"]\.\.\/([^'"\n]+)['"]/);
    if (m) {
      const t = m[1].replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
      if (moved.has(t)) { console.log(`${rel}:${i + 1}: ../${m[1]}`); hits++; }
    }
  }
}
console.log('non-domain bare ../<moved> hits:', hits);