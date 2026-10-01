import { describe, expect, it } from 'vitest';

import source from './SettingsPlugins.vue?raw';

/**
 * 远程插件脚本的取数路径是踩过坑的：
 * 部分音源站点只在错误响应上带 CORS 头，正常的 200 不带，于是 WebView 的 fetch
 * 永远读不到内容（控制台表现为 `net::ERR_FAILED 200 (OK)`）。因此必须让原生请求
 * 先行，WebView fetch 只能兜底；两条都失败时也必须留下日志，否则失败会静默。
 */

const start = source.indexOf('async function fetchRemoteScript');
const end = source.indexOf('const props = withDefaults', start);
const fetchRemoteScriptBody = start >= 0 && end > start ? source.slice(start, end) : '';

describe('SettingsPlugins 远程脚本取数', () => {
  it('fetchRemoteScript 存在且可被定位', () => {
    expect(fetchRemoteScriptBody).not.toBe('');
  });

  it('原生请求排在 WebView fetch 之前', () => {
    const nativeAt = fetchRemoteScriptBody.indexOf('pluginApi.fetchPluginUrl');
    const webviewAt = fetchRemoteScriptBody.indexOf('await fetch(');
    expect(nativeAt).toBeGreaterThanOrEqual(0);
    expect(webviewAt).toBeGreaterThan(nativeAt);
  });

  it('两条路径都失败时留下诊断日志', () => {
    expect(fetchRemoteScriptBody).toContain('[fetchRemoteScript] 两种取数方式均失败');
    expect(fetchRemoteScriptBody).toContain('WebView fetch 失败');
  });
});
