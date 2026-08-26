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
const moved = fs.readdirSync('src/services/domain')
  .filter(f => /\.(ts|tsx|js)$/.test(f))
  .map(f => f.replace(/\.(ts|tsx|js)$/, ''));
let bad = 0;
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  for (const r of moved) {
    const re = new RegExp('services/' + r + '(?=[/\'"\\\\.])');
    if (re.test(c)) { console.log(f + ': services/' + r); bad++; break; }
  }
}
console.log('bad refs:', bad);