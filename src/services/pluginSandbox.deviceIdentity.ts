/**
 * 部分插件（如 Baka 系 QQ 音乐）在请求体中硬编码 guid/wid 设备标识，
 * 所有用户共享同一身份，上游按设备维度限流时表现为搜索间歇性空结果。
 * 加载时把这类硬编码标识替换为每次加载唯一的随机值。
 * 签名由插件基于替换后的同一对象计算，不受影响。
 */
export function randomizePinnedDeviceIdentity(script: string): string {
  if (!script) return script;
  let mutated = false;
  const randomized = script
    .replace(/(guid:\s*")([0-9A-F]{32})(")/g, (_m, prefix: string, _hex: string, suffix: string) => {
      let value = '';
      for (let i = 0; i < 32; i++) value += Math.floor(Math.random() * 16).toString(16).toUpperCase();
      mutated = true;
      return `${prefix}${value}${suffix}`;
    })
    .replace(/(wid:\s*")(\d{18,20})(")/g, (_m, prefix: string, _digits: string, suffix: string) => {
      let value = String(Math.floor(Math.random() * 9) + 1);
      while (value.length < 19) value += Math.floor(Math.random() * 10);
      mutated = true;
      return `${prefix}${value}${suffix}`;
    });
  return mutated ? randomized : script;
}
