/**
 * 应用备份导出/导入服务 —— 门面（Facade）。
 *
 * 支持将歌单（在线/本地/混合）、插件、本地设置导出为 JSON 文件，
 * 并可从 JSON 文件快速导入恢复。汇聚 re-export 拆分后的子模块，保持既有
 * 消费者（SettingsAdvanced / SettingsDebug / AppBackupResultModal）的
 * 入口路径不变。已拆分的子模块：
 *   - appBackupTypes  常量 + 类型 + 歌曲/歌单分类（叶子）
 *   - appBackupExport 导出（歌单/收藏/插件/设置）
 *   - appBackupImport 解析/摘要/导入
 *
 * 备份格式：
 * {
 *   schema: "xianyu-music.app-backup",
 *   version: 1,
 *   createdAt: ISOString,
 *   data: {
 *     playlists: [...],
 *     plugins: [...],
 *     settings: {...}
 *   }
 * }
 */

export {
  exportAppBackup,
} from './appBackupExport';

export {
  parseAppBackup,
  importAppBackup,
} from './appBackupImport';

export type { AppBackupImportResult } from './appBackupTypes';