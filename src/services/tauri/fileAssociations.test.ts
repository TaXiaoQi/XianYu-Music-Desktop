import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUDIO_FILE_ASSOCIATION_EXTENSIONS } from '../../features/settings/audioFileAssociations';

const PROJECT_ROOT = process.cwd();

const read = (relative: string) => readFileSync(resolve(PROJECT_ROOT, relative), 'utf8');

const TAURI_CONF = read('src-tauri/tauri.conf.json');
const INSTALLER_HOOKS = read('src-tauri/installer-hooks.nsh');
const FILE_ASSOC_RS = read('src-tauri/src/file_assoc.rs');

const AUDIO_PROGID = 'XianYu Music Audio';

interface FileAssociationEntry {
  ext: string[];
  name: string;
}

/** 从 tauri.conf.json 取出 fileAssociations 数组。 */
function readFileAssociations(): FileAssociationEntry[] {
  const conf = JSON.parse(TAURI_CONF) as {
    bundle?: { fileAssociations?: FileAssociationEntry[] };
  };
  return conf.bundle?.fileAssociations ?? [];
}

/** 音频组（XianYu Music Audio）的扩展名（小写）。 */
function configuredAudioExtensions(): string[] {
  const group = readFileAssociations().find((entry) => entry.name === AUDIO_PROGID);
  return (group?.ext ?? []).map((ext) => ext.toLowerCase());
}

/** 去掉 NSIS 注释行（行首 `;`）后的可执行内容。 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(';'))
    .join('\n');
}

const INSTALLER_HOOKS_CODE = stripComments(INSTALLER_HOOKS);

/** 取出某个 `!macro <name> ... !macroend` 的宏体（不含 !macro / !macroend 行）。 */
function macroTemplate(name: string): string {
  const start = INSTALLER_HOOKS.indexOf(`!macro ${name}`);
  if (start === -1) return '';
  const afterHeader = INSTALLER_HOOKS.indexOf('\n', start);
  const end = INSTALLER_HOOKS.indexOf('!macroend', afterHeader);
  if (end === -1) return '';
  return INSTALLER_HOOKS.slice(afterHeader + 1, end);
}

/** 取出某个 hook 宏的宏体。 */
function hookBody(macroName: string): string {
  return macroTemplate(macroName);
}

/** 收集 hook 体内 `!insertmacro <macroName> "<arg>"` 的 arg 列表。 */
function insertmacroArgs(hookSource: string, macroName: string): string[] {
  const re = new RegExp(`!insertmacro\\s+${macroName}\\s+"([^"]+)"`, 'g');
  const args: string[] = [];
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(hookSource)) !== null) args.push(hit[1].toLowerCase());
  return args;
}

describe('tauri fileAssociations 配置', () => {
  it('音频组恰好是 11 个扩展名，且不含 js', () => {
    const audio = configuredAudioExtensions();
    expect(audio).toHaveLength(11);
    expect(audio).not.toContain('js');
    expect(audio).toEqual(expect.arrayContaining(['mp3', 'wav', 'flac', 'mp4']));
  });

  it('.js 属于独立的插件脚本组', () => {
    const script = readFileAssociations().find((entry) => entry.name.includes('Plugin Script'));
    expect(script?.ext).toEqual(['js']);
  });
});

describe('installer-hooks.nsh 补写「打开方式」列表（病根修复）', () => {
  const installHook = hookBody('NSIS_HOOK_POSTINSTALL');
  const uninstallHook = hookBody('NSIS_HOOK_POSTUNINSTALL');

  it('写入宏把 ProgId 写进 .${EXT}\\OpenWithProgIds，根键为 HKCU', () => {
    const body = macroTemplate('XY_OPEN_WITH_PROGID');
    expect(body).toMatch(
      /WriteRegStr\s+HKCU\s+"Software\\Classes\\\.\$\{EXT\}\\OpenWithProgIds"\s+"XianYu Music Audio"\s+""/,
    );
    // 根键不能是 perMachine 的 HKLM / 合并视图 HKCR / 随上下文漂移的 SHCTX。
    expect(body).not.toMatch(/HKLM|HKCR|SHCTX|SHELL_CONTEXT/);
  });

  it('删除宏对称删除同一值，根键为 HKCU', () => {
    const body = macroTemplate('XY_DEL_OPEN_WITH_PROGID');
    expect(body).toMatch(
      /DeleteRegValue\s+HKCU\s+"Software\\Classes\\\.\$\{EXT\}\\OpenWithProgIds"\s+"XianYu Music Audio"/,
    );
    expect(body).not.toMatch(/HKLM|HKCR|SHCTX|SHELL_CONTEXT/);
  });

  it('安装钩子为每个配置的音频扩展名插入写入宏', () => {
    const inserted = insertmacroArgs(installHook, 'XY_OPEN_WITH_PROGID');
    expect(inserted.sort()).toEqual([...configuredAudioExtensions()].sort());
    // 确实写进 POSTINSTALL 宏体内（不是散落在文件其它位置）。
    expect(inserted).toHaveLength(11);
  });

  it('卸载钩子为每个音频扩展名插入删除宏（与写入集合完全一致）', () => {
    const deleted = insertmacroArgs(uninstallHook, 'XY_DEL_OPEN_WITH_PROGID');
    expect(deleted.sort()).toEqual([...configuredAudioExtensions()].sort());
    expect(deleted.sort()).toEqual(insertmacroArgs(installHook, 'XY_OPEN_WITH_PROGID').sort());
  });

  it('绝不写 Applications\\ + SupportedTypes（实测会与 OpenWithProgIds 重复条目）', () => {
    expect(INSTALLER_HOOKS_CODE).not.toContain('SupportedTypes');
    expect(INSTALLER_HOOKS_CODE).not.toMatch(/\\Applications\\/);
    expect(INSTALLER_HOOKS_CODE).not.toMatch(/Software\\Classes\\Applications/);
  });

  it('不劫持扩展名默认值（安装器只写 OpenWithProgIds）', () => {
    // 只需一条路径：hook 内不得出现写「.ext 默认值」的语句（会夺走用户当前默认程序）。
    expect(installHook).not.toMatch(/WriteRegStr\s+HKCU\s+"Software\\Classes\\\.[a-z0-9]+"\s+""/);
    expect(`${installHook}${uninstallHook}`).not.toMatch(/WriteRegStr\s+HKCU\s+"Software\\Classes\\\.[a-z0-9]+"/);
  });
});

describe('Rust 侧 AUDIO_EXTENSIONS 与配置/前端一致', () => {
  it('file_assoc.rs 的扩展名列表与 tauri.conf.json 音频组一致', () => {
    const match = FILE_ASSOC_RS.match(/AUDIO_EXTENSIONS: &\[&str\]\s*=\s*&\[([\s\S]*?)\];/);
    expect(match).not.toBeNull();
    const exts = (match![1].match(/"([a-z0-9]+)"/g) ?? []).map((token) => token.slice(1, -1));
    expect(exts.sort()).toEqual([...configuredAudioExtensions()].sort());
  });

  it('file_assoc.rs 只在 HKCU 写入（与安装器同根键）', () => {
    expect(FILE_ASSOC_RS).toContain('HKEY_CURRENT_USER');
    expect(FILE_ASSOC_RS).not.toContain('HKEY_LOCAL_MACHINE');
  });

  it('前端 AUDIO_FILE_ASSOCIATION_EXTENSIONS 与配置一致且不含 js', () => {
    const front = [...AUDIO_FILE_ASSOCIATION_EXTENSIONS].map((ext) => ext.toLowerCase());
    expect(front.sort()).toEqual([...configuredAudioExtensions()].sort());
    expect(front).not.toContain('js');
  });
});
