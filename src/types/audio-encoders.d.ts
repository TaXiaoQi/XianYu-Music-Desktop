// 前端音效引擎（YinDongMusic 迁移）录制 tab 依赖的音频编码库类型声明。
// 这两个库通过动态 import 在运行时加载，未安装时录制导出功能不可用，
// 但不影响均衡器/音效面板界面的渲染与交互。
// 安装 `npm i lamejs libflacjs` 后即可启用 MP3 / FLAC 导出。

declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number)
    encodeBuffer(left: Int8Array | Float32Array, right?: Int8Array | Float32Array): Int8Array
    flush(): Int8Array
  }
  const content: { Mp3Encoder: typeof Mp3Encoder }
  export default content
}

declare module 'libflacjs' {
  const content: any
  export default content
}
