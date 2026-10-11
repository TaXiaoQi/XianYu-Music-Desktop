// 桌面端 RSA PKCS#1 v1.5 加密（纯 BigInt 实现）。
// 对照移动端 http_login_support.dart 的 rsaPkcs1Hex（pointycastle
// PKCS1Encoding）：天翼 logbox 账密登录用，输出 hex。

function hexToBigInt(hex: string): bigint {
  const trimmed = hex.trim();
  if (!/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error('RSA 公钥参数格式错误');
  }
  return BigInt(trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntToHex(v: bigint, byteLen: number): string {
  let hex = v.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const target = byteLen * 2;
  if (hex.length < target) hex = '0'.repeat(target - hex.length) + hex;
  return hex;
}

/**
 * RSA PKCS#1 v1.5（type-2 填充）加密，hex 输出（长度 = 模数字节数 × 2）。
 * message 按 UTF-8 编码，与 Dart 端 `utf8.encode(plain)` 语义一致。
 */
export function rsaEncryptHex(modulusHex: string, exponentHex: string, message: string): string {
  const n = hexToBigInt(modulusHex);
  const e = hexToBigInt(exponentHex);
  const k = Math.ceil(n.toString(2).length / 8);

  const msgBytes = new TextEncoder().encode(message);
  if (msgBytes.length > k - 11) {
    throw new Error('RSA 明文过长');
  }

  // EM = 0x00 || 0x02 || PS(≥8 个非零随机字节) || 0x00 || M
  const em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = 0x02;
  const psLen = k - msgBytes.length - 3;
  const pool = new Uint8Array(Math.max(16, psLen));
  let filled = 0;
  let p = 0;
  while (filled < psLen) {
    if (p >= pool.length) {
      crypto.getRandomValues(pool);
      p = 0;
    }
    const b = pool[p];
    p += 1;
    if (b !== 0) {
      em[2 + filled] = b;
      filled += 1;
    }
  }
  em[2 + psLen] = 0x00;
  em.set(msgBytes, 3 + psLen);

  const c = modPow(bytesToBigInt(em), e, n);
  return bigIntToHex(c, k);
}
