import { describe, expect, it } from 'vitest';

import searchSource from './Search.vue?raw';

describe('MusicFree search cover backfill', () => {
  it('backfills covers via pluginGetCover for both first page and pagination', () => {
    expect(searchSource).toContain('pluginSearchResults.value = results;');
    expect(searchSource).toContain('pluginSearchResults.value = [...pluginSearchResults.value, ...results];');
    expect(searchSource.match(/triggerMfCoverLoading\(source\.source\);/g)?.length).toBe(2);
    expect(searchSource).toContain('pluginGetCover(pluginSource, item)');
  });

  it('bounds concurrency and per-request latency like the LX cover path', () => {
    expect(searchSource).toContain('function triggerMfCoverLoading(pluginSource: PluginSource)');
    expect(searchSource).toContain('const CONCURRENCY = 8;');
    expect(searchSource).toContain('withTimeoutFallback(\n          pluginGetCover(pluginSource, item),\n          8000,\n          null,\n        )');
  });

  it('cancels in-flight work when the search or source changes', () => {
    expect(searchSource).toContain('const version = ++coverLoadVersion;');
    expect(searchSource).toContain('if (version !== coverLoadVersion) return; // 新搜索/切换来源，停止旧任务');
  });

  it('never re-requests an item whose cover/duration lookup already succeeded or failed', () => {
    expect(searchSource).toContain('const mfCoverAttempted = new WeakSet<PluginSearchResult>();');
    expect(searchSource).toContain('if ((item.coverUrl && item.duration) || mfCoverAttempted.has(item)) return false;');
    expect(searchSource).toContain('mfCoverAttempted.add(item);');
  });
});
