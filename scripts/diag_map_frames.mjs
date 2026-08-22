import fs from 'fs';
import path from 'path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const dir = 'dist/assets';
const file = fs.readdirSync(dir).find(f => f.startsWith('vendor-vue') && f.endsWith('.js'));
const jsPath = path.join(dir, file);
const mapPath = jsPath + '.map';
console.log('使用:', path.resolve(jsPath));
if (!fs.existsSync(mapPath)) { console.error('缺少 map 文件'); process.exit(1); }

const mapJson = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const tracer = new TraceMap(mapJson);

const frames = [
  { line: 17, column: 371, label: 'remove(顶层)' },
  { line: 13, column: 37861, label: 'C' },
  { line: 13, column: 38014, label: 'Bt' },
  { line: 13, column: 37650, label: 'xe' },
  { line: 13, column: 36257, label: 'ht' },
  { line: 13, column: 35015, label: 'te' },
  { line: 13, column: 33124, label: 'I' },
  { line: 13, column: 29898, label: '_' },
  { line: 13, column: 32506, label: 'V' },
  { line: 13, column: 31893, label: 'R' },
];

for (const f of frames) {
  const o = originalPositionFor(tracer, { line: f.line, column: f.column });
  const src = o.source ? o.source.replace(/.*node_modules\/@?vue\/([^/]+)\/(dist\/)?/, '$1/') : '';
  console.log(`${f.label.padEnd(14)} -> ${src} ${o.line}:${o.column}  ${o.name || ''}`.trimEnd());
}