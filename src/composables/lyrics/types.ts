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
  LyricsSettings,
} from '../../types';

export type {
  DesktopLyricsSettings,
  DesktopLyricsPlayerAlignment,
  ImportedLyricsFont,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
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
  /** 启发式判定：这一行是把 CJK 行与其罗马化音译交换后的结果，罗马音子行应无视全局开关显示。 */
  isRomanized?: boolean;
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

type ParsedLineSourceFormat =
  | 'lrc'
  | 'enhanced_lrc'
  | 'eslrc'
  | 'yrc'
  | 'qrc'
  | 'lys'
  | 'ttml';

interface ParsedWord {
  text: string;
  startMs: number;
  endMs: number;
  romanText?: string;
}

type ExplicitLineRole = 'translation' | 'roman';

/* ==================== 轨道划分与语义行 ==================== */

type ClassificationConfidence = 'explicit' | 'parser-native' | 'heuristic';

type LyricTrackRole =
  | 'main'
  | 'translation'
  | 'romanization'
  | 'secondary'
  | 'alternate-main'
  | 'background'
  | 'metadata'
  | 'unknown';

type LyricTimingMode = 'line' | 'word' | 'syllable' | 'none';

interface LyricIssue {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

interface LyricTrackLine {
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

interface LyricTrackAttachment {
  trackId: string;
  role: Extract<LyricTrackRole, 'translation' | 'romanization' | 'secondary'>;
  confidence: number;
  lineMatchRatio: number;
}

interface LyricTrackScores {
  main: number;
  translation: number;
  romanization: number;
}

interface LyricTrack {
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
  /** 启发式判定：主行是 CJK 行、副行是其罗马化音译（如粤拼），而非「拉丁主行 + 中文翻译」。 */
  isRomanized?: boolean;
}

/* ==================== 文字类型分析 ==================== */

type DominantScript = 'latin' | 'han' | 'kana' | 'hangul' | 'mixed' | 'other';

/* ==================== 内部 AML 行类型（替代上游 wasm / core 类型） ==================== */

/** 独立的罗马音时间轴条目（播放器端 ruby 渲染用）。 */
export interface AmlRomajiWord {
  text: string;
  startTime: number;
  endTime: number;
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
  /** 行无词级时间轴（纯 LRC 源）：words 仅是整行伪词文本载体，播放器按整行点亮渲染。 */
  isWordless?: boolean;
}
