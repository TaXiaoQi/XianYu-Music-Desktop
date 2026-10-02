/// <reference types="vite/client" />

declare module "*.vue" { // 实现
  import type { DefineComponent } from "vue"; // 实现
  const component: DefineComponent<{}, {}, any>; // 实现
  export default component; // 实现
}

declare module 'blueimp-md5' { // 实现
  const md5: (input: string) => string; // 实现
  export default md5; // 实现
}

declare module 'qs' {
  export function stringify(value: unknown, options?: unknown): string;

  const qs: {
    stringify: typeof stringify;
  };
  export default qs;
}
