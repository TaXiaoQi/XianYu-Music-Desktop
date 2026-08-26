/**
 * 高频 DTO 字段级一致性测试（前后端契约校验的第二层）。
 *
 * commandContracts.test.ts 已在「命令级」锁定注册/授权/契约命令名；本测试下沉到
 * 「字段级」：对高频请求/响应 DTO，实时读取 Rust `serde` struct 与 TS `contracts.ts`
 * interface 的**源码**，提取两侧字段名集合，规范化后断言一致。任一侧增删/改名一个
 * 字段即失败，从而拦截"类型对得上但字段已漂移"的缝隙。
 *
 * 维护提示：新增高频 DTO 时在此登记一对 { rust, ts, name } 即可；字段自动提取，
 * 无需人工录入字段名（避免把测试本身变成第二手错误源）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 提取到下一个顶层配套右花括号为止的块 */
function braceBlock(src: string, start: number): { block: string; end: number } {
  const open = src.indexOf('{', start);
  if (open === -1) throw new Error('未找到左花括号');
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return { block: src.slice(open + 1, i), end: i };
    }
  }
  throw new Error('未找到匹配的右花括号');
}

/** 提取 Rust `pub struct NAME { ... }` 的字段名（每个 `\n  (pub )?name:`） */
function rustStructFields(src: string, name: string): string[] {
  const re = new RegExp(`pub struct ${name}\\s*\\{`);
  const start = src.search(re);
  if (start === -1) throw new Error(`Rust struct ${name} 未找到`);
  const { block } = braceBlock(src, start);
  const fields: string[] = [];
  for (const line of block.split('\n')) {
    const m = line.trim().match(/^(pub\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (m) fields.push(m[2]);
  }
  return fields;
}

/** 提取 TS `interface NAME { ... }` 的字段名（允许 ? / readonly） */
function tsInterfaceFields(src: string, name: string): string[] {
  const re = new RegExp(`(?:export\\s+)?interface ${name}\\s*\\{`);
  const start = src.search(re);
  if (start === -1) throw new Error(`TS interface ${name} 未找到`);
  const { block } = braceBlock(src, start);
  const fields: string[] = [];
  for (const line of block.split('\n')) {
    const m = line.trim().match(/^(readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/);
    if (m) fields.push(m[2]);
  }
  return fields;
}

/** snake_case → camelCase（两侧统一规范，便于对比） */
function camelize(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

interface DtoPair {
  name: string;
  rust: { file: string; type: string };
  ts: { file: string; type: string };
}

const DTO_PAIRS: DtoPair[] = [
  { name: 'MovedMusicFilePath', rust: { file: 'src-tauri/src/music/files.rs', type: 'MovedMusicFilePath' }, ts: { file: 'src/services/tauri/contracts.ts', type: 'MovedMusicFilePath' } },
  { name: 'BatchMoveMusicFilesResult', rust: { file: 'src-tauri/src/music/files.rs', type: 'BatchMoveMusicFilesResult' }, ts: { file: 'src/services/tauri/contracts.ts', type: 'BatchMoveMusicFilesResult' } },
  { name: 'SaveSongInfoResponse', rust: { file: 'src-tauri/src/music/types.rs', type: 'SaveSongInfoResponse' }, ts: { file: 'src/services/tauri/contracts.ts', type: 'SaveSongInfoResponse' } },
];

describe('高频 DTO 字段级一致性', () => {
  for (const pair of DTO_PAIRS) {
    it(`${pair.name} 字段一致`, () => {
      const rust = rustStructFields(readFileSync(join(process.cwd(), pair.rust.file), 'utf8'), pair.rust.type);
      const ts = tsInterfaceFields(readFileSync(join(process.cwd(), pair.ts.file), 'utf8'), pair.ts.type);

      const rustNorm = rust.map(camelize).sort();
      const tsNorm = ts.map(camelize).sort();

      const onlyRust = rustNorm.filter(f => !tsNorm.includes(f));
      const onlyTs = tsNorm.filter(f => !rustNorm.includes(f));

      expect({
        msg: `${pair.name} 字段集合不一致`,
        onlyInRust: onlyRust,
        onlyInTs: onlyTs,
        rust: rustNorm,
        ts: tsNorm,
      }, pair.name).toEqual({
        msg: `${pair.name} 字段集合不一致`,
        onlyInRust: [],
        onlyInTs: [],
        rust: rustNorm,
        ts: tsNorm,
      });
    });
  }
});