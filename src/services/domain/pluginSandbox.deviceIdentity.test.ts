import { describe, expect, it } from 'vitest';
import { randomizePinnedDeviceIdentity } from './pluginSandbox.deviceIdentity';

const QQ_SCRIPT = `
const headers = { referer: "https://y.qq.com" };
async function searchMusicDesktop(query, page) {
  const body = {
    comm: {
      guid: "1F70E520B2EAA7D25E11760783C53CA9",
      wid: "7223299733393904640",
      uin: "0",
    },
  };
  const sign = zzcSign(JSON.stringify(body));
  return body;
}
`;

describe('randomizePinnedDeviceIdentity', () => {
  it('replaces hardcoded guid and wid with random values', () => {
    const result = randomizePinnedDeviceIdentity(QQ_SCRIPT);
    const guid = result.match(/guid:\s*"([0-9A-F]{32})"/)?.[1];
    const wid = result.match(/wid:\s*"(\d{18,20})"/)?.[1];

    expect(guid).toMatch(/^[0-9A-F]{32}$/);
    expect(guid).not.toBe('1F70E520B2EAA7D25E11760783C53CA9');
    expect(wid).toMatch(/^\d{18,20}$/);
    expect(wid).not.toBe('7223299733393904640');
    // 其余脚本内容保持不变
    expect(result).toContain('const sign = zzcSign(JSON.stringify(body));');
    expect(result).toContain('referer: "https://y.qq.com"');
  });

  it('generates different identities per call', () => {
    const first = randomizePinnedDeviceIdentity(QQ_SCRIPT);
    const second = randomizePinnedDeviceIdentity(QQ_SCRIPT);
    expect(first).not.toBe(second);
  });

  it('does not touch other guid-like values (lowercase hex, short ids, unquoted)', () => {
    const script = `
      const a = { guid: "1f70e520b2eaa7d25e11760783c53ca9" };
      const b = { guid: "1F70E520B2EAA7D25E11760783C53CA" };
      const c = { guid: '1F70E520B2EAA7D25E11760783C53CA9' };
      const d = { mid: '1', dfid: '-' };
      const e = { userid: 390523108 };
      const f = guidValue;
    `;
    expect(randomizePinnedDeviceIdentity(script)).toBe(script);
  });

  it('returns empty script unchanged', () => {
    expect(randomizePinnedDeviceIdentity('')).toBe('');
  });
});
