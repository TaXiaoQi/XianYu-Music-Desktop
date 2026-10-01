import { describe, expect, it } from 'vitest';

import source from './pluginApi.ts?raw';

/**
 * fetchPluginUrl 的坑是踩出来的：
 * 音源站点会按 User-Agent 白名单放行，Rust 侧默认的 Chrome UA 拿到了
 * `403 该 Key 不允许当前客户端（User-Agent 已被限制）`，而 WebView 的 UA 是放行的。
 * 因此原生请求必须显式带上 WebView 的 UA；同时也必须把响应体带进错误信息，
 * 否则这类 4xx 的原因完全不可见。
 */

const start = source.indexOf('async function fetchPluginUrl');
const end = source.indexOf('async function proxyImage', start);
const body = start >= 0 && end > start ? source.slice(start, end) : '';

describe('pluginApi.fetchPluginUrl', () => {
  it('函数体可被定位', () => {
    expect(body).not.toBe('');
  });

  it('显式带上 WebView 的 User-Agent', () => {
    expect(body).toContain('navigator.userAgent');
    expect(body).toContain("'User-Agent'");
  });

  it('非 2xx 时把响应体片段带进错误信息', () => {
    expect(body).toContain('const detail = String(resp.body');
    expect(body).toContain('HTTP ${resp.status}${detail');
  });
});
