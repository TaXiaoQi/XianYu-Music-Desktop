/**
 * 「用弦予音乐打开的音频格式」设置项的可选项。
 *
 * 必须与 `src-tauri/tauri.conf.json` 的 `XianYu Music Audio` 组、Rust 侧
 * `src-tauri/src/file_assoc.rs` 的 `AUDIO_EXTENSIONS`、以及
 * `src-tauri/installer-hooks.nsh` 的 `XY_OPEN_WITH_PROGID` 列表四者保持一致
 * （`fileAssociations.test.ts` 会做双向断言）。
 *
 * 排除 `.js`（弦予音乐插件脚本）——它不属于「音频格式」。
 */
export const AUDIO_FILE_ASSOCIATION_EXTENSIONS = [
  'aac',
  'aif',
  'aiff',
  'flac',
  'm4a',
  'm4b',
  'mp3',
  'mp4',
  'oga',
  'ogg',
  'wav',
] as const;

export type AudioFileAssociationExtension = (typeof AUDIO_FILE_ASSOCIATION_EXTENSIONS)[number];

/** 展示用标签：语言中立，直接用大写扩展名。 */
export const audioFileAssociationLabel = (ext: string): string => ext.toUpperCase();
