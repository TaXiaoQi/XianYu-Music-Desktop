import { beforeEach, describe, expect, it, vi } from 'vitest';

// node 环境无 localStorage，用内存桩替代。
const store = new Map<string, string>();
const localStorageShim = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
};
vi.stubGlobal('localStorage', localStorageShim);

import {
  addLibraryTheme,
  listLibraryThemes,
  removeLibraryTheme,
} from './themeLibrary';

const pkg = { version: 2, platform: 'desktop', name: '夜航', payload: {} };

describe('desktop theme library', () => {
  beforeEach(() => { store.clear(); });

  it('文件导入与广场下载都能入库并列出', () => {
    addLibraryTheme({ source: 'file', name: '手作', author: 'me', preview: '', raw: pkg });
    addLibraryTheme({ source: 'square', squareId: 7, name: '夜航', author: '上传者', preview: 'https://x/y.jpg', raw: pkg });

    const list = listLibraryThemes();
    expect(list).toHaveLength(2);
    expect(list[0].key).toBe('square-7');
    expect(list[1].source).toBe('file');
    expect(list[1].key).toMatch(/^file-/);
  });

  it('广场同 id 重复下载去重覆盖，位置提到最前', () => {
    addLibraryTheme({ source: 'square', squareId: 7, name: '旧名', author: 'a', preview: '', raw: pkg });
    addLibraryTheme({ source: 'file', name: '手作', author: 'me', preview: '', raw: pkg });
    addLibraryTheme({ source: 'square', squareId: 7, name: '新名', author: 'a', preview: '', raw: { ...pkg, name: '新名' } });

    const list = listLibraryThemes();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('新名');
    expect(list.filter((item) => item.squareId === 7)).toHaveLength(1);
  });

  it('removeLibraryTheme 按键删除，其余保留', () => {
    addLibraryTheme({ source: 'square', squareId: 7, name: '夜航', author: 'a', preview: '', raw: pkg });
    const file = addLibraryTheme({ source: 'file', name: '手作', author: 'me', preview: '', raw: pkg });

    removeLibraryTheme('square-7');
    const list = listLibraryThemes();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe(file.key);
  });

  it('重启（重读 localStorage）后数据仍在；脏数据被过滤', () => {
    addLibraryTheme({ source: 'square', squareId: 7, name: '夜航', author: 'a', preview: '', raw: pkg });
    store.set('xianyu_desktop_theme_packs_v1', JSON.stringify([
      ...JSON.parse(store.get('xianyu_desktop_theme_packs_v1') || '[]'),
      { bad: true },
      'junk',
    ]));

    expect(listLibraryThemes()).toHaveLength(1);
    expect(listLibraryThemes()[0].name).toBe('夜航');
  });

  it('localStorage 容量异常时不抛错（降级为内存态）', () => {
    const failing = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
      clear: () => {},
    };
    vi.stubGlobal('localStorage', failing);

    expect(() => addLibraryTheme({ source: 'file', name: 'x', author: '', preview: '', raw: pkg })).not.toThrow();
    expect(() => removeLibraryTheme('square-1')).not.toThrow();

    vi.stubGlobal('localStorage', localStorageShim);
  });
});
