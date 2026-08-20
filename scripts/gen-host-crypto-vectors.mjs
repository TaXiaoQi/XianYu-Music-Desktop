// 用前端现有 JS 实现生成 host_crypto 的 Rust 单元测试对照向量
import CryptoJs from 'crypto-js';
import { createHash, createCipheriv } from 'node:crypto';

// ===== zzcSign（从 lxMusicSdk.ts 移植） =====
const TX_PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const TX_PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const TX_SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

function sha1Hex(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

function zzcSign(text) {
  const hash = sha1Hex(text);
  const part1 = TX_PART_1_INDEXES.map(idx => hash[idx]).join('');
  const part2 = TX_PART_2_INDEXES.map(idx => hash[idx]).join('');
  const part3 = TX_SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const b64Part = Buffer.from(part3).toString('base64').replace(/[\\/+=]/g, '');
  return `zzc${part1}${b64Part}${part2}`.toLowerCase();
}

// ===== 酷狗签名 =====
function kugouSignature(params, keyparam, body) {
  const paramList = params.split('&').sort();
  return CryptoJs.MD5(`${keyparam}${paramList.join('')}${body}${keyparam}`).toString();
}

// ===== 咪咕签名 =====
function mgCreateSignature(time, str) {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
  const sign = CryptoJs.MD5(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`).toString();
  return { sign, deviceId };
}

// ===== linuxapiEncrypt（playlistImport.ts） =====
function linuxapiEncrypt(obj) {
  const text = JSON.stringify(obj);
  const key = Buffer.from('rFgB&h#%2?^eDg:Q', 'utf8');
  // AES-128-ECB 标准PKCS7（node autopadding 与 crypto-js pad.Pkcs7 等价）
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const enc = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  return enc.toString('hex').toUpperCase();
}

// ===== weapiEncrypt（playlistImport.ts，固定 key 版便于对照） =====
const WEAPI_PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud', 'utf8');
const WEAPI_IV = Buffer.from('0102030405060708', 'utf8');
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RSA_MODULUS_HEX = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';

function aesCbcEncryptB64(data, key) {
  const cipher = createCipheriv('aes-128-cbc', key, WEAPI_IV);
  return Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('base64');
}

function rsaEncrypt(data) {
  const padded = Buffer.alloc(128);
  padded.set(data, 128 - data.length);
  let m = 0n;
  for (const b of padded) m = (m << 8n) | BigInt(b);
  const n = BigInt('0x' + RSA_MODULUS_HEX);
  let result = 1n;
  let base = m % n;
  let exp = 65537n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % n;
    base = (base * base) % n;
    exp >>= 1n;
  }
  return result.toString(16).padStart(256, '0');
}

function weapiEncryptWithKey(object, keyBytes) {
  const text = JSON.stringify(object);
  const firstEncrypted = aesCbcEncryptB64(text, WEAPI_PRESET_KEY);
  const params = aesCbcEncryptB64(firstEncrypted, keyBytes);
  const reversedKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) reversedKey[i] = keyBytes[15 - i];
  const encSecKey = rsaEncrypt(reversedKey);
  return { params, encSecKey };
}

// ===== 生成对照向量 =====
const vectors = {
  zzc: [
    { text: '{"comm":{"ct":19,"cv":1859,"uin":"0"},"req":{"module":"music.search.SearchCgiService","method":"DoSearchForQQMusicDesktop","param":{"search_type":0,"query":"test","page_num":1,"num_per_page":30}}}', expected: zzcSign('{"comm":{"ct":19,"cv":1859,"uin":"0"},"req":{"module":"music.search.SearchCgiService","method":"DoSearchForQQMusicDesktop","param":{"search_type":0,"query":"test","page_num":1,"num_per_page":30}}}') },
    { text: 'hello world 中文测试', expected: zzcSign('hello world 中文测试') },
  ],
  kugou: [
    { params: 'appid=1005&clienttime=1700000000000&clienttoken=0&clientver=11409&code=fc4be23b4e972707f36b8a828a93ba8a&dfid=0&extdata=ABCDEF&kugouid=0&mid=16249512204336365674023395779019&mixsongid=123&p=1&pagesize=20&uuid=0&ver=10', body: '', salt: 'OIlwieks28dk2k092lksi2UIkp', expected: kugouSignature('appid=1005&clienttime=1700000000000&clienttoken=0&clientver=11409&code=fc4be23b4e972707f36b8a828a93ba8a&dfid=0&extdata=ABCDEF&kugouid=0&mid=16249512204336365674023395779019&mixsongid=123&p=1&pagesize=20&uuid=0&ver=10', 'OIlwieks28dk2k092lksi2UIkp', '') },
    { params: 'appid=1058&specialid=0&global_specialid=123&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-', body: '', salt: 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt', expected: kugouSignature('appid=1058&specialid=0&global_specialid=123&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-', 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt', '') },
    { params: 'b=2&a=1&c=3', body: 'BODYDATA', salt: 'OIlwieks28dk2k092lksi2UIkp', expected: kugouSignature('b=2&a=1&c=3', 'OIlwieks28dk2k092lksi2UIkp', 'BODYDATA') },
  ],
  migu: [
    { text: 'testsearch', time: '1700000000000', expected: mgCreateSignature('1700000000000', 'testsearch').sign },
  ],
  linuxapi: [
    { payload: '{"method":"/api/v1/playlist/detail","params":{"id":"123456"}}', expected: linuxapiEncrypt({ method: '/api/v1/playlist/detail', params: { id: '123456' } }) },
    { payload: '{"hello":"world"}', expected: linuxapiEncrypt({ hello: 'world' }) },
  ],
  weapi: (() => {
    const keyBytes = Buffer.from('0123456789abcdef');
    const r = weapiEncryptWithKey({ c: '[{"id":123}]', ids: '[123]' }, keyBytes);
    return { key: keyBytes.toString('hex'), payload: JSON.stringify({ c: '[{"id":123}]', ids: '[123]' }), params: r.params, encSecKey: r.encSecKey };
  })(),
  sha256: [
    { text: 'hello world 中文测试', expected: CryptoJs.SHA256('hello world 中文测试').toString() },
  ],
};

console.log(JSON.stringify(vectors, null, 2));
