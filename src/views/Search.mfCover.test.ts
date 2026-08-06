import { describe, expect, it } from 'vitest';

import searchSource from './Search.vue?raw';

/**
 * MusicFree 搜索结果的封面补获。
 *
 * 背景：部分平台的搜索接口不返回封面 URL（如网易云 weapi/search/get 返回的
 * album 只有 picId 没有 picUrl），插件的 formatMusicItem 取到 undefined，
 * 结果项 coverUrl 为空串。LX 路径有 triggerCoverLoading 兜底，MusicFree
 * 路径此前没有，导致这类平台的搜索列表封面全空（但点开播放后有封面，因为
 * 播放路径调了 pluginGetCover）。
 *
 * 与 Search.lifecycle.test.ts 一致，用 raw source 断言（该 SFC 未做逻辑抽离，
 * 组件挂载测试需要 mock 整条插件引擎链，成本不成比例）。
 */
describe('MusicFree search cover backfill', () => {
  it('backfills covers via pluginGetCover for both first page and pagination', () => {
    // 首屏搜索后触发
    expect(searchSource).toContain('pluginSearchResults.value = results;');
    // 分页追加后触发
    expect(searchSource).toContain('pluginSearchResults.value = [...pluginSearchResults.value, ...results];');
    // 两处调用点都传入 PluginSource
    expect(searchSource.match(/triggerMfCoverLoading\(source\.source\);/g)?.length).toBe(2);
    // 补获走插件的 getMusicInfo（pluginGetCover 内部实现）
    expect(searchSource).toContain('pluginGetCover(pluginSource, item)');
  });

  it('bounds concurrency and per-request latency like the LX cover path', () => {
    expect(searchSource).toContain('function triggerMfCoverLoading(pluginSource: PluginSource)');
    // 滑动窗口并发，避免一次性打爆插件侧
    expect(searchSource).toContain('const CONCURRENCY = 8;');
    // 单请求 8s 超时，慢平台不拖住整队
    expect(searchSource).toContain('withTimeoutFallback(\n          pluginGetCover(pluginSource, item),\n          8000,\n          null,\n        )');
  });

  it('cancels in-flight work when the search or source changes', () => {
    // 与 LX 路径共用版本号，切换来源时互相取消
    expect(searchSource).toContain('const version = ++coverLoadVersion;');
    // worker 与 UI 定时器都检查版本号
    expect(searchSource).toContain('if (version !== coverLoadVersion) return; // 新搜索/切换来源，停止旧任务');
  });

  it('never re-requests an item whose cover lookup already failed', () => {
    // coverUrl 是 string，无法用 null/'' 区分"未尝试"与"已失败"，用 WeakSet 记对象身份
    expect(searchSource).toContain('const mfCoverAttempted = new WeakSet<PluginSearchResult>();');
    // 入队即标记，防止并发重入重复请求
    expect(searchSource).toContain('if (item.coverUrl || mfCoverAttempted.has(item)) return false;');
    expect(searchSource).toContain('mfCoverAttempted.add(item);');
  });
});
