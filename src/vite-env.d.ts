/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'blueimp-md5' {
  const md5: (input: string) => string;
  export default md5;
}
