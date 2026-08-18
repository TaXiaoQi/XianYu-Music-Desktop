import { describe, expect, it } from 'vitest';

import { isLxPluginScript } from './lxPluginEngine';

describe('isLxPluginScript', () => {
  it('识别明文调用 lx.on / lx.send 的标准落雪插件', () => {
    const script = `
      lx.on('request', (data) => {});
      lx.send('inited', { sources: {} });
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别引用 EVENT_NAMES.request 的落雪插件', () => {
    const script = `
      lx.on(EVENT_NAMES.request, (data) => {});
      lx.send(EVENT_NAMES.inited, { sources: {} });
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别通过 globalThis.lx 访问的混淆插件', () => {
    const script = `
      const lx = globalThis.lx;
      lx.on('request', (data) => {});
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别通过 globalThis["lx"] 访问的混淆插件', () => {
    const script = `
      const lx = globalThis['lx'];
      lx.on('request', (data) => {});
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别带服务端下发配置 SERVER_SCRIPT_CONFIG 的重度混淆插件', () => {
    const script = `
      globalThis['SERVER_SCRIPT_CONFIG'] = {"apiUrl":"https://example.com","apiKey":"lxmusic"};
      ;(function(a,b){return a(b)})(function(x){return x});
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别 unicode 转义 SCRIPT_MD5 的重度混淆插件', () => {
    const script = String.raw`
      ;(function(){return \u0053\u0043\u0052\u0049\u0050\u0054\u005f\u004d\u0044\u0035})()
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别 unicode 转义 lx 与 globalThis 组合的重度混淆插件', () => {
    const script = String.raw`
      ;(function(){return \u006c\u0078})(\u0067\u006c\u006f\u0062\u0061\u006c\u0054\u0068\u0069\u0073)
    `;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('识别真实独家音源 v5 混淆插件（VM 解释器 + 服务端配置）', () => {
    const script = `/*!
 * @name 独家音源
 * @version 5
 * @author w
 */
// ===== 服务端下发配置(自动生成, 请勿修改) =====
globalThis['SERVER_SCRIPT_CONFIG'] = {"apiUrl":"https://88.lxmusic.xn--fiqs8s","apiKey":"lxmusic","signSalt":"LxSrv@2026#Sig"};
// ===== 服务端下发配置结束 =====
;(function ﱡﹶ(ﱡﹲ,ﱡﱣ){return ﹶﹰ=function(ﱟﹺ,ﹼ){return function(ﹼﹶ,ﱡء){if(ﹼﹶ=ﹼﹶ^ﱡء)return ﹸﹼ}})()`;
    expect(isLxPluginScript(script)).toBe(true);
  });

  it('不将 MusicFree 插件误判为落雪插件', () => {
    const script = `
      const module = { exports: {} };
      module.exports = {
        platform: '网易云音乐',
        version: '1.0.0',
        search: async (query, page, type) => [],
        getMediaSource: async (musicItem, quality) => ({ url: 'https://example.com/a.mp3' }),
      };
    `;
    expect(isLxPluginScript(script)).toBe(false);
  });

  it('不将普通脚本误判为落雪插件', () => {
    const script = `
      const a = 1;
      function add(x, y) { return x + y; }
      console.log(add(a, 2));
    `;
    expect(isLxPluginScript(script)).toBe(false);
  });

  it('不将仅含 globalThis 的普通脚本误判为落雪插件', () => {
    const script = `
      const config = globalThis.config || {};
      console.log(config);
    `;
    expect(isLxPluginScript(script)).toBe(false);
  });
});
