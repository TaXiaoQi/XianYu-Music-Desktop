// Fix imports after moving src/services/* -> src/services/domain/*
// 1) In every TS/Vue/TSX under src: rewrite `services/<moved>` -> `services/domain/<moved>`
// 2) Inside domain files: re-express relative (./ and ../) specifiers from the new location.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const servicesDir = path.join(srcDir, 'services');
const domainDir = path.join(servicesDir, 'domain');

const moved = new Set();
for (const f of fs.readdirSync(domainDir)) {
  const b = f.replace(/\.(ts|tsx|js)$/, '');
  if (b) moved.add(b);
}
const movedSorted = [...moved].sort((a, b) => b.length - a.length);
const specRe = new RegExp(`services/(${movedSorted.map(esc).join('|')})(?=[/'"\\\\.])`, 'g');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx|mts|cts|vue|js|mjs|cjs)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Match a quoted relative specifier only on lines that involve module semantics
const relRe = /(['"])(\.\.?\/[^'"\n]+)\1/g;
function isModuleLine(line) {
  return /(^|[^A-Za-z0-9_$])(import|export|require|from|importingAs)([^A-Za-z0-9_$])/.test(line) ||
    /\b(import|export|require)\b|\bfrom\s*['"]/.test(line);
}

function fixRelativeImportsInFile(content, file) {
  const oldDir = servicesDir; // old location dirname was src/services
  const newDir = path.dirname(file); // src/services/domain
  const lines = content.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!relRe.test(line)) continue;
    relRe.lastIndex = 0;
    if (!/(^|[\s;]\s*)(import|export|require)\b|(^|\s)from\s*/.test(line)) {
      // be conservative: only lines containing import/export/require/from
      if (!/\b(import|export|require)\b|from\s*['"]|import\(\s*['"]/.test(line)) {
        continue;
      }
    }
    const replaced = line.replace(relRe, (m, q, spec) => {
      const oldAbs = path.resolve(oldDir, spec);
      const newSpec = path.relative(newDir, oldAbs).replace(/\\/g, '/');
      return `${q}${newSpec}${q}`;
    });
    if (replaced !== line) {
      lines[i] = replaced;
      changed = true;
    }
  }
  return changed ? lines.join('\n') : content;
}

const allFiles = walk(srcDir);
let filesChanged = 0;
let domainChanged = 0;

for (const file of allFiles) {
  const rel = path.relative(srcDir, file).replace(/\\/g, '/');
  const isDomain = file.startsWith(domainDir + path.sep);
  const orig = fs.readFileSync(file, 'utf8');
  let content = orig;

  // Step 1: external specifier `services/<moved>` -> `services/domain/<moved>`
  content = content.replace(specRe, (m) => 'services/domain/' + m.slice('services/'.length));
  // Step 2: relative imports inside moved files
  if (isDomain) content = fixRelativeImportsInFile(content, file);

  if (content !== orig) {
    fs.writeFileSync(file, content, 'utf8');
    filesChanged++;
    if (isDomain) domainChanged++;
    console.log(`[changed] ${rel}`);
  }
}

console.log(`\nTotal files changed: ${filesChanged} (domain internal: ${domainChanged})`);