/**
 * MD5 哈希算法
 *
 * 使用 blueimp-md5 库（经过广泛验证的纯 JS MD5 实现）。
 * 浏览器原生 Web Crypto 不支持 MD5（仅支持 SHA 系列），因此使用此库。
 * 用于 XY Music API 的请求签名：sign = md5(timestamp + nonce + body + api_secret)。
 */
import md5Lib from 'blueimp-md5';

/** 计算字符串的 MD5 哈希，返回 32 位小写十六进制字符串 */
export function md5(input: string): string {
  return md5Lib(input);
}
