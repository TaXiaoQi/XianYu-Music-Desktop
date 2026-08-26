/**
 * Tauri 命令契约一致性校验
 *
 * 后端命令注册与两端声明存在三份"事实来源"，漏注册/错登记只会运行期才暴露：
 *   1. lib.rs 的 invoke_handler(generate_handler![...])   —— 实际注册的命令
 *   2. src-tauri/permissions/app-commands.toml            —— ACL 允许清单（allow-app-commands）
 *   3. services/tauri/contracts.ts 的 TauriCommandMap     —— 前端强类型桥契约
 *
 * 约定：
 *   - 注册集 == 允许集：新增命令只注册不加入 ACL 会运行期报
 *     "not allowed. Command not found"；只加 ACL 不注册是死权限。
 *   - 契约集 ⊆ 注册集 ∩ 允许集：前端只能调用真实存在且被允许的命令，
 *     避免契约指向不存在的命令（无法被编译器捕获的串行化漂移）。
 *   - 注册集 ⊇ 契约集 之外的命令（有注册无契约）仅提示，不视为错误——
 *     部分命令可能确实不被前端直调。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();

const read = (relative: string) =>
  readFileSync(resolve(PROJECT_ROOT, relative), 'utf8');

/** 解析 lib.rs 中 generate_handler![...] 内登记的命令名集合。 */
function extractRegisteredCommands(source: string): Set<string> {
  const block = source.match(/generate_handler!\s*\[\s*([\s\S]*?)\s*\]/);
  if (!block) return new Set();
  const commands = block[1].match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];
  return new Set(commands);
}

/** 解析 app-commands.toml 中 allow-app-commands 权限块允许的命令集合。 */
function extractAllowedCommands(source: string): Set<string> {
  const blocks = source.split('[[permission]]');
  for (const block of blocks) {
    if (!/identifier\s*=\s*"allow-app-commands"/.test(block)) continue;
    const section = block.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/);
    if (!section) return new Set();
    const names = section[1].match(/"([^"]+)"/g) ?? [];
    return new Set(names.map((entry) => entry.slice(1, -1)));
  }
  return new Set();
}

/** 解析 contracts.ts 中 TauriCommandMap 接口的顶层属性（命令）名集合。 */
function extractContractCommands(source: string): Set<string> {
  const head = source.indexOf('interface TauriCommandMap {');
  if (head === -1) return new Set();
  const open = source.indexOf('{', head);
  const commands = new Set<string>();
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) break;
    } else if (depth === 1 && /[A-Za-z_]/.test(char)) {
      let end = i;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
      const word = source.slice(i, end);
      let cursor = end;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
      if (source[cursor] === ':') commands.add(word);
      i = end - 1;
    }
  }
  return commands;
}

const sortList = (set: Set<string>): string[] => [...set].sort();

const DIFFER =
  '注册集 ↔ ACL 允许集 ↔ 前端契约集三者不一致，见上方 diff（英文为命令名，非文案）';

describe('Tauri 命令契约一致性', () => {
  const registered = extractRegisteredCommands(read('src-tauri/src/lib.rs'));
  const allowed = extractAllowedCommands(
    read('src-tauri/permissions/app-commands.toml'),
  );
  const contracted = extractContractCommands(
    read('src/services/tauri/contracts.ts'),
  );

  it('lib.rs 注册的命令 == ACL 允许的命令（新增命令必须三处同步）', () => {
    const notAllowed = [...registered].filter((name) => !allowed.has(name));
    const notRegistered = [...allowed].filter((name) => !registered.has(name));
    expect({ notAllowed, notRegistered, diff: notAllowed.length + notRegistered.length }, DIFFER).toEqual(
      { notAllowed: [], notRegistered: [], diff: 0 },
    );
  });

  it('契约集是注册集与允许集的子集（前端只能调用真实存在且被允许的命令）', () => {
    const missingInLib = [...contracted].filter((name) => !registered.has(name));
    const missingInAcl = [...contracted].filter((name) => !allowed.has(name));
    expect({ missingInLib, missingInAcl, diff: missingInLib.length + missingInAcl.length }, DIFFER).toEqual(
      { missingInLib: [], missingInAcl: [], diff: 0 },
    );
  });

  it('登记命令都应具备类型契约（缺失项仅提示，便于收敛死接口）', () => {
    const withoutContract = sortList(
      new Set([...registered].filter((name) => !contracted.has(name))),
    );
    // 该用例只做信息提示，不阻断；有值请在 contracts.ts 补齐契约或确认确无前端调用
    if (withoutContract.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[无契约命令，请确认是否有前端调用并补契约]:', withoutContract.join(', '));
    }
  });
});