/**
 * LX 平台搜索层 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的各平台独立模块，保持既有消费者
 * （lxMusicSdk 等）的入口路径不变。已拆分的子模块：
 *   - lxSearchKw      酷我(kw) 搜索实现
 *   - lxSearchKg      酷狗(kg) 搜索实现（含 kgFilterData 文件映射）
 *   - lxSearchTx      QQ音乐(tx) 搜索（Mobile/Desktop/Web 三通道）、演唱/时长内置、歌单 Desktop 兜底
 *   - lxSearchWy      网易云(wy) 搜索实现
 *   - lxSearchMg      咪咕(mg) 搜索实现（含签名）
 *
 * 各子模块仅依赖 lxMusicSdkBase（与宿主签名/工具），作为叶子模块被本门面消费。
 */

export { searchKw } from './lxSearchKw';
export { kgFilterData, searchKg } from './lxSearchKg';
export {
  txHandleResult,
  searchTx,
  txSearchAlbumsRawBuiltin,
  txBatchTrackIntervalBuiltin,
  txSheetSearchDesktopFallback,
} from './lxSearchTx';
export { searchWy } from './lxSearchWy';
export { mgCreateSignature, searchMg } from './lxSearchMg';