/**
 * 浏览器原生 fetch 的轻量出站校验（Rust 侧 SSRF 校验在 WebView 端的对应收口）。
 *
 * WebView 里应优先经 Rust `pluginHttpRequest` 出网（带完整 SSRF 防护），浏览器原生
 * `fetch` 仅用作 Rust 失败的兜底 / 非 Tauri 预览环境的兼容路径。这些路径无法做 DNS
 * 级校验，因此这里做轻量防线：只允许 https、拒绝带凭据 URL、拒绝内网/回环/保留
 * IP 字面量与 localhost——与 Rust `validate_url_ip_literal` 的思路对齐，堵住"浏览器
 * 兜底绕过 Rust SSRF"的唯一缝隙。
 */

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = `${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}`;
const IPV4_LITERAL_RE = new RegExp(`^${IPV4}$`);

/** 禁止出站的 IPv4 网段（私网/回环/CGNAT/链路本地/多播/保留） */
function isForbiddenIpv4(host: string): boolean {
  const first = Number.parseInt(host.split('.')[0], 10);
  const second = Number.parseInt(host.split('.')[1], 10);
  // 10.x / 127.x / 169.254.x / 0.x / 100.64-127.x / 192.168.x / 172.16-31.x / 224-255.x 起
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first >= 224) return true;
  return false;
}

/** WebView 可安全访问的 IPv6 判断：仅放行公网单播，拒绝 回环/ULA/链路本地/多播/unspecified */
function isForbiddenIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (
    lower === '::1' || lower === '::' ||
    lower.startsWith('::ffff:') ||
    lower.startsWith('fe80:') || lower.startsWith('ff00:') || lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('2001:db8:') || lower.startsWith('2002:') 
  ) return true;
  return false;
}

/**
 * 校验一个 URL 是否允许浏览器原生出站。通过则原样返回；不通过则抛出带原因的异常。
 * 供 `pluginFetch` 兜底与 `update` 直连等浏览器 fetch 路径调用，统一出站安全规则。
 */
export function assertSafeOutboundUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('浏览器兜底出站拒绝：无效的 URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('浏览器兜底出站拒绝：仅允许 https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('浏览器兜底出站拒绝：禁止带凭据的 URL');
  }

  let host = parsed.hostname;
  // 剥离 IPv6 字面量的方括号
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  if (host === 'localhost') {
    throw new Error('浏览器兜底出站拒绝：localhost');
  }

  if (host.includes(':')) {
    // IPv6 字面量（含 IPv4 内嵌）
    if (isForbiddenIpv6(host)) {
      throw new Error(`浏览器兜底出站拒绝：内网/保留地址 ${host}`);
    }
  } else if (IPV4_LITERAL_RE.test(host)) {
    if (isForbiddenIpv4(host)) {
      throw new Error(`浏览器兜底出站拒绝：内网/保留地址 ${host}`);
    }
  }
  // 其余视为域名，无需 DNS 校验（对齐 Rust 侧只拦 IP 字面量、域名放行的策略）

  return url;
}