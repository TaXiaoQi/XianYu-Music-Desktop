import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl } from './urlGuard';

describe('assertSafeOutboundUrl', () => {
  it('放行公网 https 域名', () => {
    expect(() => assertSafeOutboundUrl('https://api.github.com/repos/a/b/releases/latest')).not.toThrow();
    expect(() => assertSafeOutboundUrl('https://y.qq.com/n/1.html')).not.toThrow();
  });

  it.each([
    'http://example.com/',
    'https://127.0.0.1/',
    'https://127.0.0.1:8080/x',
    'https://localhost/',
    'https://10.0.0.1/',
    'https://192.168.1.1/x',
    'https://172.16.0.1/',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/',
    'https://0.0.0.0/',
    'https://user:pass@example.com/',
    'https://[::1]/',
    'https://[fd00::1]/',
    'https://[fe80::1]/',
    'https://[::ffff:192.168.1.1]/',
    'not-a-url',
  ])('拒绝不安全/内网地址: %s', (url) => {
    expect(() => assertSafeOutboundUrl(url)).toThrow(/拒绝/);
  });
});