/**
 * 在线歌曲下载服务 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块，保持既有消费者
 * （useDownloadToLocal / onlinePlaybackResolver / qualitySharedProbe /
 *  downloadService.test.ts 等）的入口路径不变。已拆分的子模块：
 *   - downloadFormat            文件名/音质候选纯函数、协议判定、扩展名推断（叶子）
 *   - downloadQualityResolver   直链解析上下文、逐档位解析（依赖 format）
 *   - downloadQualityProbe      多档并发探测（实际调用直链解析，映射可用档位与复用直链）
 *   - downloadExtras            歌词文本提取、格式转换、封面 URL 解析（叶子）
 *   - downloadExecutor          下载路径、Rust 流式下载与主编排
 *
 * 整体职责：解析 lx:// 在线歌曲的真实音源直链（按音质映射 + 自动回退）、
 * 计算目标文件路径（扩展名以真实音源为准、命名冲突处理）、
 * 调用 Rust 命令流式下载，并可选下载歌词。
 */
export * from './downloadFormat';
export * from './downloadQualityResolver';
export * from './downloadQualityProbe';
export * from './downloadExtras';
export * from './downloadExecutor';