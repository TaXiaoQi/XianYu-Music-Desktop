/**
 * 歌词子系统数据模型契约。
 *
 * 本文件是对外 API 的一部分：除文末新增的内部 AML 行类型外，
 * 所有导出的 interface / type 名称与字段形状均需保持稳定。
 */

import type { // 实现
  DesktopLyricsSettings, // 实现
  DesktopLyricsPlayerAlignment, // 实现
  ImportedLyricsFont, // 实现
  LyricsColorScheme, // 实现
  LyricsFontPreset, // 实现
  LyricsPlayerAlignment, // 实现
  LyricsPlayerRenderMode, // 实现
  LyricsSettings, // 实现
} from '../../types'; // 实现

export type { // 实现
  DesktopLyricsSettings, // 实现
  DesktopLyricsPlayerAlignment, // 实现
  ImportedLyricsFont, // 实现
  LyricsColorScheme, // 实现
  LyricsFontPreset, // 实现
  LyricsPlayerAlignment, // 实现
  LyricsPlayerRenderMode, // 实现
  LyricsSettings, // 实现
};

/* ==================== 展示层模型 ==================== */

export interface LyricWord {
  text: string; // 实现
  start: number;
  end: number;
  romaji?: string;
}

export interface LyricLine { // 实现
  time: number; // 实现
  endTime: number; // 实现
  text: string; // 实现
  translation: string; // 实现
  romaji: string; // 实现
  words?: LyricWord[]; // 实现
  romajiWords?: LyricWord[]; // 实现
  secondary?: string[]; // 实现
  speaker?: string;
  isBG: boolean;
  isDuet: boolean;
  isDuetPartner: boolean;
  /** 启发式判定：这一行是把 CJK 行与其罗马化音译交换后的结果，罗马音子行应无视全局开关显示。 */
  isRomanized?: boolean;
}

export interface CurrentLyricDisplayLine { // 实现
  kind: 'main' | 'romaji' | 'translation'; // 实现
  text: string; // 实现
  words?: LyricWord[]; // 实现
}

export interface CurrentLyricDisplayState { // 实现
  text: string; // 实现
  lines: string[]; // 实现
  displayLines: CurrentLyricDisplayLine[]; // 实现
}

export interface DisplayFragment {
  text: string; // 实现
  startMs?: number;
  endMs?: number; // 实现
}

export interface RenderLine {
  startMs: number; // 实现
  endMs: number; // 实现
  main: DisplayFragment[];
  translation?: DisplayFragment[];
  roman?: DisplayFragment[];
  secondary?: DisplayFragment[];
}

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'; // 实现

export interface LyricsPayload {
  rawLyrics: string;
  document?: LyricDocument;
  semanticLines: SemanticLine[];
  displayLines: LyricLine[];
}

/* ==================== 解析层模型 ==================== */

export type ParsedLineSourceFormat = // 实现
  | 'lrc'
  | 'enhanced_lrc' // 实现
  | 'eslrc'
  | 'yrc'
  | 'qrc'
  | 'lys'
  | 'ttml';

export interface ParsedWord { // 实现
  text: string; // 实现
  startMs: number; // 实现
  endMs: number; // 实现
  romanText?: string; // 实现
}

export type ExplicitLineRole = 'translation' | 'roman'; // 实现

export interface ParsedLine { // 实现
  startMs: number; // 实现
  endMs?: number; // 实现
  text: string; // 实现
  words?: ParsedWord[]; // 实现
  translatedText?: string; // 实现
  romanText?: string; // 实现
  sourceFormat: ParsedLineSourceFormat; // 实现
  sourceIndex: number; // 实现
  explicitRole?: ExplicitLineRole; // 实现
}

/* ==================== 轨道划分与语义行 ==================== */

export type ClassificationConfidence = 'explicit' | 'parser-native' | 'heuristic'; // 实现

export type LyricTrackRole = // 实现
  | 'main'
  | 'translation' // 实现
  | 'romanization' // 实现
  | 'secondary' // 实现
  | 'alternate-main' // 实现
  | 'background' // 实现
  | 'metadata' // 实现
  | 'unknown'; // 实现

export type LyricTimingMode = 'line' | 'word' | 'syllable' | 'none'; // 实现

export interface LyricIssue { // 实现
  code: string; // 实现
  message: string; // 实现
  severity: 'info' | 'warning' | 'error'; // 实现
}

export interface LyricTrackLine { // 实现
  id: string;
  startMs: number; // 实现
  endMs: number; // 实现
  text: string; // 实现
  words?: ParsedWord[]; // 实现
  sourceIndex: number; // 实现
  explicitRole?: ExplicitLineRole; // 实现
  roleSource?: ClassificationConfidence; // 实现
  clusterIndex?: number; // 实现
  slotIndex?: number; // 实现
}

export interface LyricTrackAttachment { // 实现
  trackId: string; // 实现
  role: Extract<LyricTrackRole, 'translation' | 'romanization' | 'secondary'>; // 实现
  confidence: number; // 实现
  lineMatchRatio: number; // 实现
}

export interface LyricTrackScores { // 实现
  main: number; // 实现
  translation: number; // 实现
  romanization: number; // 实现
}

export interface LyricTrack { // 实现
  id: string;
  role: LyricTrackRole; // 实现
  lang?: string; // 实现
  timingMode: LyricTimingMode; // 实现
  sourceFormat: ParsedLineSourceFormat | 'mixed'; // 实现
  confidence: number; // 实现
  dominantScript: DominantScript; // 实现
  lines: LyricTrackLine[]; // 实现
  attachments: LyricTrackAttachment[]; // 实现
  scores?: LyricTrackScores; // 实现
}

export interface LyricDocument { // 实现
  metadata: {
    totalLines: number; // 实现
    sourceFormats: ParsedLineSourceFormat[]; // 实现
  };
  tracks: LyricTrack[]; // 实现
  issues: LyricIssue[]; // 实现
  confidence: number; // 实现
  displayTrackId?: string; // 实现
}

export interface SemanticLine { // 实现
  startMs: number; // 实现
  endMs: number; // 实现
  mainText: string; // 实现
  mainWords?: ParsedWord[]; // 实现
  translationText?: string; // 实现
  romanText?: string; // 实现
  romanWords?: ParsedWord[]; // 实现
  secondaryTexts?: string[]; // 实现
  confidence: ClassificationConfidence; // 实现
  speaker?: string;
  isBG: boolean;
  isDuet: boolean;
  isDuetPartner: boolean;
  /** 启发式判定：主行是 CJK 行、副行是其罗马化音译（如粤拼），而非「拉丁主行 + 中文翻译」。 */
  isRomanized?: boolean;
}

export interface ClassifiedGroupResult {
  main: ParsedLine;
  translationLine: ParsedLine | null;
  romajiLine: ParsedLine | null;
  secondaryLines: ParsedLine[];
  confidence: ClassificationConfidence; // 实现
  /** 启发式判定：本组发生了「CJK 主行 + 拉丁音译副行」的交换（无显式标记时）。 */
  isRomanized: boolean;
}

/* ==================== 文字类型分析 ==================== */

export type DominantScript = 'latin' | 'han' | 'kana' | 'hangul' | 'mixed' | 'other'; // 实现

export interface LineScriptProfile { // 实现
  latinCount: number; // 实现
  hanCount: number; // 实现
  kanaCount: number; // 实现
  hangulCount: number; // 实现
  dominantScript: DominantScript; // 实现
}

/* ==================== 内部 AML 行类型（替代上游 wasm / core 类型） ==================== */

/** 解析器内部使用的词级条目；字段允许缺省以兼容各格式产出的中间形态。 */
export interface AmlLyricWord {
  startTime: number;
  endTime: number; // 实现
  word: string;
  romanWord?: string;
}

/** 独立的罗马音时间轴条目（播放器端 ruby 渲染用）。 */
export interface AmlRomajiWord {
  text: string; // 实现
  startTime: number;
  endTime: number; // 实现
}

/** 各格式解析器的统一中间行表示。 */
export interface AmlLyricLine {
  words: AmlLyricWord[];
  translatedLyric?: string;
  romanLyric?: string;
  isBG?: boolean;
  isDuet?: boolean;
  startTime?: number;
  endTime?: number;
  romajiWords?: AmlRomajiWord[];
}

/**
 * 播放器（逐字动画组件）最终消费的行结构：字段全部必填，
 * 与 @applemusic-like-lyrics/core 的 LyricLine 保持结构兼容，
 * 额外携带 romajiWords 时间轴。
 */
export interface AmlPlayerWord {
  startTime: number;
  endTime: number; // 实现
  word: string;
  romanWord: string;
  obscene: boolean;
}

export interface AmlPlayerLine {
  words: AmlPlayerWord[];
  translatedLyric: string;
  romanLyric: string;
  startTime: number;
  endTime: number; // 实现
  isBG: boolean;
  isDuet: boolean;
  romajiWords?: AmlRomajiWord[];
  /** 行无词级时间轴（纯 LRC 源）：words 仅是整行伪词文本载体，播放器按整行点亮渲染。 */
  isWordless?: boolean;
}
