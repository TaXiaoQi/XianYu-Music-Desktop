/**
 * downloadHistory 单测
 *
 * 覆盖：记录读写、同一首歌覆盖、失效记录自动清理、损坏数据容错。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tauri/invoke', () => ({
  tauriInvoke: vi.fn(),
}));

import { tauriInvoke } from './tauri/invoke';
import {
  __resetDownloadHistoryCacheForTest,
  checkDownloadExists,
  fileNameFromPath,
  getDownloadRecord,
  loadDownloadHistory,
  recordDownload,
  removeDownloadRecord,
  type DownloadRecord,
} from './downloadHistory';

/** 模拟磁盘上的 download_history.json 内容 */
let diskContent = '{}';

const makeRecord = (overrides: Partial<DownloadRecord> = {}): DownloadRecord => ({
  songPath: 'lx://kg/song123',
  filePath: 'D:\\Music\\测试歌手 - 测试歌曲.mp3',
  fileName: '测试歌手 - 测试歌曲.mp3',
  quality: '320k',
  downloadedAt: 1700000000000,
  ...overrides,
});

/** 默认桩：read 返回 diskContent，write 更新 diskContent，file_exists 返回 true */
function stubInvoke(fileExists = true) {
  (tauriInvoke as any).mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'read_download_history') return diskContent;
    if (cmd === 'write_download_history') {
      diskContent = args.content;
      return undefined;
    }
    if (cmd === 'file_exists') return fileExists;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  diskContent = '{}';
  __resetDownloadHistoryCacheForTest();
});

describe('fileNameFromPath', () => {
  it('extracts filename from Windows and POSIX paths', () => {
    expect(fileNameFromPath('D:\\Music\\a - b.mp3')).toBe('a - b.mp3');
    expect(fileNameFromPath('/home/user/music/a - b.flac')).toBe('a - b.flac');
    expect(fileNameFromPath('bare.mp3')).toBe('bare.mp3');
  });
});

describe('loadDownloadHistory', () => {
  it('returns empty map when file is missing or empty', async () => {
    stubInvoke();
    expect(await loadDownloadHistory()).toEqual({});
  });

  it('tolerates malformed JSON without throwing', async () => {
    diskContent = 'not-json{{{';
    stubInvoke();
    expect(await loadDownloadHistory()).toEqual({});
  });

  it('filters out structurally invalid entries', async () => {
    diskContent = JSON.stringify({
      'lx://kg/ok': makeRecord({ songPath: 'lx://kg/ok' }),
      'lx://kg/bad': { songPath: '', filePath: '' },
      'lx://kg/bad2': null,
    });
    stubInvoke();
    const history = await loadDownloadHistory();
    expect(Object.keys(history)).toEqual(['lx://kg/ok']);
  });

  it('backfills fileName from filePath when missing', async () => {
    diskContent = JSON.stringify({
      'lx://kg/x': { songPath: 'lx://kg/x', filePath: 'D:\\Music\\x.flac' },
    });
    stubInvoke();
    const history = await loadDownloadHistory();
    expect(history['lx://kg/x'].fileName).toBe('x.flac');
  });
});

describe('recordDownload', () => {
  it('persists a record and makes it retrievable', async () => {
    stubInvoke();
    const record = makeRecord();
    await recordDownload(record);

    expect(getDownloadRecord('lx://kg/song123')).toMatchObject({
      filePath: record.filePath,
      quality: '320k',
    });
    // 已落盘
    expect(JSON.parse(diskContent)['lx://kg/song123']).toBeTruthy();
  });

  it('overwrites the previous record for the same song', async () => {
    stubInvoke();
    await recordDownload(makeRecord({ quality: '128k' }));
    await recordDownload(makeRecord({ quality: 'flac', fileName: 'new.flac' }));

    const history = JSON.parse(diskContent);
    expect(Object.keys(history)).toHaveLength(1);
    expect(history['lx://kg/song123'].quality).toBe('flac');
    expect(history['lx://kg/song123'].fileName).toBe('new.flac');
  });
});

describe('checkDownloadExists', () => {
  it('returns the record when the file still exists', async () => {
    stubInvoke(true);
    await recordDownload(makeRecord());
    const found = await checkDownloadExists('lx://kg/song123');
    expect(found?.fileName).toBe('测试歌手 - 测试歌曲.mp3');
  });

  it('drops the stale record when the file is gone', async () => {
    stubInvoke(true);
    await recordDownload(makeRecord());

    // 文件被用户删除
    stubInvoke(false);
    const found = await checkDownloadExists('lx://kg/song123');

    expect(found).toBeNull();
    // 失效记录已被清理并落盘
    expect(JSON.parse(diskContent)).toEqual({});
    expect(getDownloadRecord('lx://kg/song123')).toBeNull();
  });

  it('returns null for songs without any record', async () => {
    stubInvoke();
    expect(await checkDownloadExists('lx://kg/never-downloaded')).toBeNull();
  });

  it('returns null for an empty song path', async () => {
    stubInvoke();
    expect(await checkDownloadExists('')).toBeNull();
  });
});

describe('removeDownloadRecord', () => {
  it('removes an existing record', async () => {
    stubInvoke();
    await recordDownload(makeRecord());
    await removeDownloadRecord('lx://kg/song123');
    expect(getDownloadRecord('lx://kg/song123')).toBeNull();
    expect(JSON.parse(diskContent)).toEqual({});
  });
});
