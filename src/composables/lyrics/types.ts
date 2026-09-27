/**
 * 歌词子系统数据模型契约。
 *
 * 本文件是对外 API 的一部分：除文末新增的内部 AML 行类型外，
 * 所有导出的 interface / type 名称与字段形状均需保持稳定。
 */

import type {
  DesktopLyricsSettings,
  DesktopLyricsPlayerAlignment,
  ImportedLyricsFont,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsPlayerRenderMode,
  LyricsSettings,
} from '../../types';

export type {
  DesktopLyricsSettings,
  DesktopLyricsPlayerAlignment,
  ImportedLyricsFont,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsPlayerRenderMode,
  LyricsSettings,
};

/* ==================== 展示层模型 ==================== */

export interface LyricWord {
  text: string;
  start: number;
  end: number;
  romaji?: string;
}

export interface LyricLine {
  time: number;
  endTime: number;
  text: string;
  translation: string;
  romaji: string;
  words?: LyricWord[];
  romajiWords?: LyricWord[];
  secondary?: string[];
  speaker?: string;
  isBG: boolean;
  isDuet: boolean;
  isDuetPartner: boolean;
}

export interface CurrentLyricDisplayLine {
  kind: 'main' | 'romaji' | 'translation';
  text: string;
  words?: LyricWord[];
}

export interface CurrentLyricDisplayState {
  text: string;
  lines: string[];
  displayLines: CurrentLyricDisplayLine[];
}

export interface DisplayFragment {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface RenderLine {
  startMs: number;
  endMs: number;
  main: DisplayFragment[];
  translation?: DisplayFragment[];
  roman?: DisplayFragment[];
  secondary?: DisplayFragment[];
}

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface LyricsPayload {
  rawLyrics: string;
  document?: LyricDocument;
  semanticLines: SemanticLine[];
  displayLines: LyricLine[];
}

/* ==================== 解析层模型 ==================== */

export type ParsedLineSourceFormat =
  | 'lrc'
  | 'enhanced_lrc'
  | 'eslrc'
  | 'yrc'
  | 'qrc'
  | 'lys'
  | 'ttml';

export interface ParsedWord {
  text: string;
  startMs: number;
  endMs: number;
  romanText?: string;
}

export type ExplicitLineRole = 'translation' | 'roman';

export interface ParsedLine {
  startMs: number;
  endMs?: number;
  text: string;
  words?: ParsedWord[];
  translatedText?: string;
  romanText?: string;
  sourceFormat: ParsedLineSourceFormat;
  sourceIndex: number;
  explicitRole?: ExplicitLineRole;
}

/* ==================== 轨道划分与语义行 ==================== */

export type ClassificationConfidence = 'explicit' | 'parser-native' | 'heuristic';

export type LyricTrackRole =
  | 'main'
  | 'translation'
  | 'romanization'
  | 'secondary'
  | 'alternate-main'
  | 'background'
  | 'metadata'
  | 'unknown';

export type LyricTimingMode = 'line' | 'word' | 'syllable' | 'none';

export interface LyricIssue {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface LyricTrackLine {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: ParsedWord[];
  sourceIndex: number;
  explicitRole?: ExplicitLineRole;
  roleSource?: ClassificationConfidence;
  clusterIndex?: number;
  slotIndex?: number;
}

export interface LyricTrackAttachment {
  trackId: string;
  role: Extract<LyricTrackRole, 'translation' | 'romanization' | 'secondary'>;
  confidence: number;
  lineMatchRatio: number;
}

export interface LyricTrackScores {
  main: number;
  translation: number;
  romanization: number;
}

export interface LyricTrack {
  id: string;
  role: LyricTrackRole;
  lang?: string;
  timingMode: LyricTimingMode;
  sourceFormat: ParsedLineSourceFormat | 'mixed';
  confidence: number;
  dominantScript: DominantScript;
  lines: LyricTrackLine[];
  attachments: LyricTrackAttachment[];
  scores?: LyricTrackScores;
}

export interface LyricDocument {
  metadata: {
    totalLines: number;
    sourceFormats: ParsedLineSourceFormat[];
  };
  tracks: LyricTrack[];
  issues: LyricIssue[];
  confidence: number;
  displayTrackId?: string;
}

export interface SemanticLine {
  startMs: number;
  endMs: number;
  mainText: string;
  mainWords?: ParsedWord[];
  translationText?: string;
  romanText?: string;
  romanWords?: ParsedWord[];
  secondaryTexts?: string[];
  confidence: ClassificationConfidence;
  speaker?: string;
  isBG: boolean;
  isDuet: boolean;
  isDuetPartner: boolean;
}

export interface ClassifiedGroupResult {
  main: ParsedLine;
  translationLine: ParsedLine | null;
  romajiLine: ParsedLine | null;
  secondaryLines: ParsedLine[];
  confidence: ClassificationConfidence;
}

/* ==================== 文字类型分析 ==================== */

export type DominantScript = 'latin' | 'han' | 'kana' | 'hangul' | 'mixed' | 'other';

export interface LineScriptProfile {
  latinCount: number;
  hanCount: number;
  kanaCount: number;
  hangulCount: number;
  dominantScript: DominantScript;
}

/* ==================== 内部 AML 行类型（替代上游 wasm / core 类型） ==================== */

/** 解析器内部使用的词级条目；字段允许缺省以兼容各格式产出的中间形态。 */
export interface AmlLyricWord {
  startTime: number;
  endTime: number;
  word: string;
  romanWord?: string;
}

/** 独立的罗马音时间轴条目（播放器端 ruby 渲染用）。 */
export interface AmlRomajiWord {
  text: string;
  startTime: number;
  endTime: number;
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
  endTime: number;
  word: string;
  romanWord: string;
  obscene: boolean;
}

export interface AmlPlayerLine {
  words: AmlPlayerWord[];
  translatedLyric: string;
  romanLyric: string;
  startTime: number;
  endTime: number;
  isBG: boolean;
  isDuet: boolean;
  romajiWords?: AmlRomajiWord[];
}
