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
