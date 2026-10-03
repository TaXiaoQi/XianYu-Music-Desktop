import { describe, expect, it } from 'vitest';

import source from './pluginApi.ts?raw';
import { condense, expectSourceContains } from '../../testing/sourceText';

/**
 * fetchPluginUrl 的坑是踩出来的：
 * 音源站点会按 User-Agent 白名单放行，Rust 侧默认的 Chrome UA 拿到了
 * `403 该 Key 不允许当前客户端（User-Agent 已被限制）`，而 WebView 的 UA 是放行的。
 * 因此原生请求必须显式带上 WebView 的 UA；同时也必须把响应体带进错误信息，
 * 否则这类 4xx 的原因完全不可见。
 */

const condensed = condense(source);
const start = condensed.indexOf(condense('async function fetchPluginUrl'));
const end = condensed.indexOf(condense('async function proxyImage'), start);
const body = start >= 0 && end > start ? condensed.slice(start, end) : '';

describe('pluginApi.fetchPluginUrl', () => {
  it('函数体可被定位', () => {
    expect(body).not.toBe('');
  });

  it('显式带上 WebView 的 User-Agent', () => {
    expectSourceContains(body, 'navigator.userAgent');
    expectSourceContains(body, "'User-Agent'");
  });

  it('非 2xx 时把响应体片段带进错误信息', () => {
    expectSourceContains(body, 'const detail = String(resp.body');
    expectSourceContains(body, 'HTTP ${resp.status}${detail');
  });
});
