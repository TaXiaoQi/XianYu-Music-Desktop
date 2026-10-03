import { describe, expect, it } from 'vitest';

import searchQuerySource from '../composables/search/useSearchQuery.ts?raw';
import searchResultsSource from '../composables/search/useSearchResults.ts?raw';
import { expectSourceContains } from '../testing/sourceText';

describe('MusicFree search cover backfill', () => {
  it('backfills covers via pluginGetCover for both first page and pagination', () => {
    expectSourceContains(searchQuerySource, 'pluginSearchResults.value = results;');
    expectSourceContains(searchQuerySource, 'pluginSearchResults.value = [...pluginSearchResults.value, ...results];');
    expect(searchQuerySource.match(/triggerMfCoverLoading\(source\.source\);/g)?.length).toBe(2);
    expectSourceContains(searchResultsSource, 'pluginGetCover(pluginSource, item)');
  });

  it('bounds concurrency and per-request latency like the LX cover path', () => {
    expectSourceContains(searchResultsSource, 'function triggerMfCoverLoading(pluginSource: PluginSource)');
    expectSourceContains(searchResultsSource, 'const CONCURRENCY = 8;');
    expectSourceContains(searchResultsSource, 'withTimeoutFallback(\n            pluginGetCover(pluginSource, item),\n            8000,\n            null,\n          )');
  });

  it('cancels in-flight work when the search or source changes', () => {
    expectSourceContains(searchResultsSource, 'const version = ++coverLoadVersion;');
    expectSourceContains(searchResultsSource, 'if (version !== coverLoadVersion) return;');
  });

  it('never re-requests an item whose cover/duration lookup already succeeded or failed', () => {
    expectSourceContains(searchResultsSource, 'const mfCoverAttempted = new WeakSet<PluginSearchResult>();');
    expectSourceContains(searchResultsSource, 'if ((item.coverUrl && item.duration) || mfCoverAttempted.has(item)) return false;');
    expectSourceContains(searchResultsSource, 'mfCoverAttempted.add(item);');
  });
});
