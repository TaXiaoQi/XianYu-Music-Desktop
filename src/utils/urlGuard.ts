
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = `${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}`;
const IPV4_LITERAL_RE = new RegExp(`^${IPV4}$`);

function isForbiddenIpv4(host: string): boolean {
  const first = Number.parseInt(host.split('.')[0], 10);
  const second = Number.parseInt(host.split('.')[1], 10);
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first >= 224) return true;
  return false;
}

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
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  if (host === 'localhost') {
    throw new Error('浏览器兜底出站拒绝：localhost');
  }

  if (host.includes(':')) {
    if (isForbiddenIpv6(host)) {
      throw new Error(`浏览器兜底出站拒绝：内网/保留地址 ${host}`);
    }
  } else if (IPV4_LITERAL_RE.test(host)) {
    if (isForbiddenIpv4(host)) {
      throw new Error(`浏览器兜底出站拒绝：内网/保留地址 ${host}`);
    }
  }

  return url;
}