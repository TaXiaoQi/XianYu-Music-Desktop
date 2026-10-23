import { describe, expect, it } from 'vitest';
import { scopedSearchAudio } from './cloudScopedQuery';
import type { CloudProvider } from './cloudProvider';
import { CloudFile, CloudListResult } from './cloudTypes';

type ListHandler = (
  cred: Record<string, string>,
  path: string,
  cursor: string | null | undefined,
) => Promise<CloudListResult>;

const fakeProvider = (handler: ListHandler): CloudProvider =>
  ({ listDir: handler }) as unknown as CloudProvider;

const audio = (id: string, name: string, path?: string): CloudFile =>
  new CloudFile({ id, name, path });
const dir = (id: string, name: string, path?: string): CloudFile =>
  new CloudFile({ id, name, isDir: true, path });

describe('scopedSearchAudio', () => {
  it('完整遍历子树并只收集音频命中', async () => {
    const provider = fakeProvider(async (_cred, path) => {
      if (path === 'root') {
        return new CloudListResult({
          files: [dir('a', 'dirA', 'root/dirA'), dir('b', 'dirB', 'root/dirB')],
        });
      }
      if (path === 'root/dirA') {
        return new CloudListResult({ files: [audio('f1', 'song one.mp3')] });
      }
      if (path === 'root/dirB') {
        return new CloudListResult({
          files: [audio('f2', 'song two.mp3'), audio('f3', 'note.txt')],
        });
      }
      return new CloudListResult({ files: [] });
    });
    const out = await scopedSearchAudio(provider, {}, ['root'], 'song');
    expect(out.map(f => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('目录间并发执行且不超过上限 4', async () => {
    let inFlight = 0;
    let peak = 0;
    const dirs = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const provider = fakeProvider(async (_cred, path) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return new CloudListResult({
        files: [audio(`id-${path}`, `${path}.mp3`)],
      });
    });
    const out = await scopedSearchAudio(provider, {}, dirs, 'd');
    expect(out).toHaveLength(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('同目录翻页串行续传 cursor，两页命中都收集', async () => {
    const provider = fakeProvider(async (_cred, path, cursor) => {
      if (path !== 'root') return new CloudListResult({ files: [] });
      if (cursor == null) {
        return new CloudListResult({
          files: [audio('p1', 'page1.mp3')],
          nextCursor: 'c2',
        });
      }
      expect(cursor).toBe('c2');
      return new CloudListResult({ files: [audio('p2', 'page2.mp3')] });
    });
    const out = await scopedSearchAudio(provider, {}, ['root'], 'page');
    expect(out.map(f => f.id)).toEqual(['p1', 'p2']);
  });

  it('同 id 去重只留一条', async () => {
    const provider = fakeProvider(async (_cred, path) =>
      new CloudListResult({
        files: [audio('same', `song-${path}.mp3`)],
      }),
    );
    const out = await scopedSearchAudio(provider, {}, ['a', 'b'], 'song');
    expect(out).toHaveLength(1);
  });

  it('单个目录列目录失败不影响其余范围', async () => {
    const provider = fakeProvider(async (_cred, path) => {
      if (path === 'bad') throw new Error('network');
      return new CloudListResult({
        files: [audio('ok', 'good song.mp3')],
      });
    });
    const out = await scopedSearchAudio(provider, {}, ['bad', 'good'], 'song');
    expect(out.map(f => f.id)).toEqual(['ok']);
  });

  it('子目录入队：path 非空且异于当前用 path，否则用 id', async () => {
    const visited: string[] = [];
    const provider = fakeProvider(async (_cred, path) => {
      visited.push(path);
      if (path === 'root') {
        return new CloudListResult({
          files: [
            dir('d1', 'has-path', 'root/real'),
            dir('d2', 'no-path', ''),
            dir('d3', 'self-loop', 'root'),
          ],
        });
      }
      return new CloudListResult({ files: [] });
    });
    await scopedSearchAudio(provider, {}, ['root'], 'song');
    expect(visited).toContain('root/real'); // path 优先
    expect(visited).toContain('d2'); // path 空回落 id
    expect(visited).not.toContain('root' + 'root'); // 病态入队不存在
    expect(visited.filter(v => v === 'root')).toHaveLength(1); // 自环 path 不重复入队
  });

  it('roots 为空或关键词为空返回空', async () => {
    const provider = fakeProvider(async () =>
      new CloudListResult({ files: [audio('x', 'x.mp3')] }),
    );
    expect(await scopedSearchAudio(provider, {}, [], 'song')).toEqual([]);
    expect(await scopedSearchAudio(provider, {}, ['root'], '  ')).toEqual([]);
  });

  it('baidu 走 filesearch 特化：全盘搜索结果按 root 子树过滤并复核文件名', async () => {
    const provider = {
      id: 'baidu',
      listDir: async () => {
        throw new Error('不应触发目录遍历');
      },
      searchFiles: async () =>
        new CloudListResult({
          files: [
            audio('s1', 'song in root.mp3', '/我的资源/song in root.mp3'),
            audio('s2', 'song outside.mp3', '/别处/song outside.mp3'),
            audio('s3', 'not audio.txt', '/我的资源/not audio.txt'),
            audio('s4', 'unrelated.mp3', '/我的资源/unrelated.mp3'),
            audio('s5', 'SONG CASE.mp3', '/我的资源/SONG CASE.mp3'),
          ],
        }),
    } as unknown as CloudProvider;
    const out = await scopedSearchAudio(provider, {}, ['/我的资源'], 'Song');
    expect(out.map(f => f.id).sort()).toEqual(['s1', 's5']);
  });

  it('baidu 特化失败回落通用遍历', async () => {
    const provider = {
      id: 'baidu',
      listDir: async (_cred: unknown, path: string) =>
        new CloudListResult({
          files: [audio(`f-${path}`, `song ${path}.mp3`)],
        }),
      searchFiles: async () => {
        throw new Error('OAuth 账号暂不支持全盘搜索');
      },
    } as unknown as CloudProvider;
    const out = await scopedSearchAudio(provider, {}, ['r1', 'r2'], 'song');
    expect(out.map(f => f.id).sort()).toEqual(['f-r1', 'f-r2']);
  });

  it('baidu 风控/网络类失败不回落遍历，返回空', async () => {
    const provider = {
      id: 'baidu',
      listDir: async () => {
        throw new Error('不应触发目录遍历');
      },
      searchFiles: async () => {
        throw new Error('搜索请求失败 (HTTP 403)');
      },
    } as unknown as CloudProvider;
    const out = await scopedSearchAudio(provider, {}, ['r1'], 'song');
    expect(out).toEqual([]);
  });
});
