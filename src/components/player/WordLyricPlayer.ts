/**
 * 自研逐字歌词渲染核心（框架无关，DOM 直操作）。
 *
 * 职责：
 * - 接收毫秒制逐字行数据（AmlPlayerLine），渲染主行 / 罗马音 ruby / 翻译副行；
 * - 逐字渐亮：单词级 alpha 遮罩随播放进度横扫，活动行逐帧刷新；
 * - 行位移动画：每行独立弹簧（带自上而下的级联延迟），支持对齐锚点与对齐比例；
 * - 行状态：活动行全亮、非活动行按距离分档压暗 + 模糊缩放、BG 行播放中折叠、暂停时展开；
 * - 间奏呼吸点：行间空隙 ≥ 4s 时在行间插入三点呼吸动画；
 * - 手动滚轮偏移：停手 1.8s 后自动回弹到当前行。
 *
 * 所有跨帧可复用的判定（强调词、词进度、活动行、间奏窗口、弹簧积分）
 * 以纯函数导出，供单元测试直接覆盖。
 */
import type { AmlPlayerLine, AmlPlayerWord } from '../../composables/lyrics';
import { resolveSubLineProgressValue } from './subLineHighlight';

/* ==================== 对外类型 ==================== */

export type WordLyricAlignAnchor = 'top' | 'bottom' | 'center';

export interface WordLyricLineClickEvent {
  line: AmlPlayerLine;
  lineIndex: number;
}

/* ==================== 纯逻辑（可单测） ==================== */

/** 视作「一整块东亚文字」的判定：汉字 / 假名连续串（含假名长音符 U+30FC，其 script 属 Common）。 */
const CJK_TEXT_PATTERN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]+$/u;

/**
 * 强调辉光的词级判定：东亚词唱够 200ms 即可强调（逐字语言常见），
 * 拉丁词需要 ≥1s 且长度在 2~7 个字符之间。
 */
export function isEmphasizedWord(word: { word: string; startTime: number; endTime: number }): boolean {
  const text = word.word.trim();
  if (!text) return false;
  const duration = word.endTime - word.startTime;
  if (CJK_TEXT_PATTERN.test(text)) return duration >= 200;
  return duration >= 1000 && text.length > 1 && text.length <= 7;
}

/** 单词演唱进度：0 = 未唱，1 = 唱毕；时长非法时按时间前后给 0/1。 */
export function wordProgress(word: AmlPlayerWord, timeMs: number): number {
  const duration = word.endTime - word.startTime;
  if (duration <= 0) return timeMs >= word.endTime ? 1 : 0;
  return Math.min(1, Math.max(0, (timeMs - word.startTime) / duration));
}

/** 活动行集合：非 BG 行命中 [start,end)，并连带其后紧邻的 BG 行。 */
export function findActiveLineIndices(lines: AmlPlayerLine[], timeMs: number): number[] {
  const actives: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.isBG) continue;
    if (line.startTime <= timeMs && line.endTime > timeMs) {
      actives.push(i);
      if (lines[i + 1]?.isBG) actives.push(i + 1);
    }
  }
  return actives;
}

export interface LyricInterludeWindow {
  startMs: number;
  endMs: number;
  /** 间奏前的锚定行；起播预滚场景为 -1（呼吸点显示在首行之前）。 */
  anchorIndex: number;
  durationMs: number;
}

/**
 * 间奏窗口：仅在无活动行时成立。优先取「已唱完行 → 下一行」的空隙；
 * 首行尚未起唱时取「当前时间 → 首行前 250ms」的预滚窗口。
 */
export function findInterludeWindow(lines: AmlPlayerLine[], timeMs: number): LyricInterludeWindow | null {
  if (lines.length === 0) return null;

  let startedIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.startTime <= timeMs) startedIndex = i;
    else break;
  }

  if (startedIndex < 0) {
    const first = lines[0]!;
    if (first.startTime <= timeMs + 20) return null;
    const endMs = Math.max(timeMs, first.startTime - 250);
    return { startMs: timeMs, endMs, anchorIndex: -1, durationMs: endMs - timeMs };
  }

  const current = lines[startedIndex]!;
  const next = lines[startedIndex + 1];
  if (!next || next.startTime <= timeMs || current.endTime > timeMs) return null;
  const startMs = Math.max(current.endTime, timeMs);
  return { startMs, endMs: next.startTime, anchorIndex: startedIndex, durationMs: next.startTime - startMs };
}

export interface SpringState {
  position: number;
  velocity: number;
}

/** 半隐式欧拉弹簧积分；单帧时长截断到 64ms，避免切后台回来后爆散。 */
export function stepSpring(
  state: SpringState,
  target: number,
  deltaMs: number,
  stiffness: number,
  damping: number,
): void {
  const dt = Math.min(Math.max(deltaMs, 0), 64) / 1000;
  if (dt <= 0) return;
  const acceleration = -stiffness * (state.position - target) - damping * state.velocity;
  state.velocity += acceleration * dt;
  state.position += state.velocity * dt;
}

/* ==================== 渲染核心 ==================== */

interface WordEntry {
  wrapper: HTMLSpanElement;
  word: AmlPlayerWord;
  /** 遮罩横扫用的盒宽，仅重排后测量。 */
  width: number;
  progress: number;
}

type LineVisualState = 'past' | 'active' | 'future';

interface LineEntry {
  el: HTMLDivElement;
  line: AmlPlayerLine;
  lineIndex: number;
  words: WordEntry[];
  /** 实测内容高度（含副行），重排后刷新。 */
  layoutHeight: number;
  /** 参与流式排布的高度（已乘行距）。 */
  positionedHeight: number;
  /** 在整段歌词流内的累计 Y 偏移。 */
  flowOffset: number;
  spring: SpringState;
  /** 级联延迟到期后生效的目标位置。 */
  pendingY: number;
  delayMs: number;
  scale: number;
  blur: number;
  opacity: number;
  targetScale: number;
  targetBlur: number;
  targetOpacity: number;
  visualState: LineVisualState;
}

/** 活动行内未唱词的遮罩暗度（对齐移动端 dim α0.28）。 */
const DIM_TEXT_ALPHA = 0.28;
const INTERLUDE_MIN_MS = 4000;
/** 滚轮停手后回中的等待时长（对齐移动端 1.8s）。 */
const SCROLL_RESET_DELAY_MS = 1800;
const STAGGER_STEP_MS = 50;
/** 弹簧对齐移动端 550ms Cubic(0.40,0.10,0,1) 的无过冲落位：19 ≈ 2√90，恰为临界阻尼。 */
const FLOW_STIFFNESS = 90;
const FLOW_DAMPING = 19;
const MIN_LAYOUT_HEIGHT = 36;
/** 非活动行模糊上限（CSS px）；移动端 σ≤8，按 σ→CSS 2σ 换算。 */
const MAX_BLUR_PX = 16;
/** 邻行向活动行聚拢的步长（主字号倍数）与最大步数。 */
const FAN_STEP_EM = 0.07;
const FAN_MAX_STEPS = 4;
/** 子行扫光进度变量：写在行元素上，由子行文本遮罩消费。 */
const SUB_LINE_PROGRESS_VAR = '--xy-sub-line-progress';

function sameIndexSet(left: number[], right: Set<number>): boolean {
  if (left.length !== right.size) return false;
  return left.every((value) => right.has(value));
}

function clampValue(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function easeOutCubic(value: number): number {
  const t = clampValue(0, value, 1);
  return 1 - (1 - t) ** 3;
}

export class WordLyricPlayerCore {
  private root: HTMLDivElement;
  private dotsEl: HTMLDivElement | null = null;
  private lineEntries: LineEntry[] = [];
  private lines: AmlPlayerLine[] = [];

  private currentTimeMs = 0;
  private playing = true;
  private layoutDirty = true;

  private alignAnchor: WordLyricAlignAnchor = 'center';
  private alignPosition = 0.5;
  private enableSpring = true;
  private enableBlur = true;
  private enableScale = true;
  private hidePassedLines = false;
  private wordFadeWidth = 0.5;
  private lineGap = 1;
  private disableBlurFilter = false;

  private activeIndices = new Set<number>();
  private interlude: LyricInterludeWindow | null = null;
  private dotsVisible = false;
  private dotsSpring: SpringState = { position: 0, velocity: 0 };
  private dotsPendingY = 0;
  private dotsScale = 0;
  private dotsOpacity = 0;
  private dotsFlowHeight = 0;

  private fontPx = 16;
  private playerHeight = 0;
  private flowTotal = 0;
  private anchorAdjust = 0;
  private scrollMinUserY = 0;
  private scrollMaxUserY = 0;

  private userScrollY = 0;
  private scrollResetTimer = 0;
  private allowScroll = true;
  private suspendFrameHandle = 0;

  private lineClickHandlers = new Set<(event: WordLyricLineClickEvent) => void>();
  private disposed = false;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'wlp-lyric-player';
    this.buildDotsEl();
    host.appendChild(this.root);
    this.root.addEventListener('wheel', this.handleWheel, { passive: true });
  }

  /* ---------- 装配与销毁 ---------- */

  getElement(): HTMLDivElement {
    return this.root;
  }

  onLineClick(handler: (event: WordLyricLineClickEvent) => void): () => void {
    this.lineClickHandlers.add(handler);
    return () => this.lineClickHandlers.delete(handler);
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeEventListener('wheel', this.handleWheel);
    if (this.scrollResetTimer !== 0) {
      clearTimeout(this.scrollResetTimer);
      this.scrollResetTimer = 0;
    }
    if (this.suspendFrameHandle !== 0) {
      cancelAnimationFrame(this.suspendFrameHandle);
      this.suspendFrameHandle = 0;
    }
    this.lineClickHandlers.clear();
    for (const entry of this.lineEntries) entry.el.remove();
    this.lineEntries = [];
    this.dotsEl?.remove();
    this.dotsEl = null;
    this.root.remove();
  }

  /* ---------- 数据与状态写入 ---------- */

  setLyricLines(lines: AmlPlayerLine[], timeMs: number) {
    this.lines = lines;
    this.currentTimeMs = Math.max(0, Math.trunc(timeMs));
    this.rebuildDom();
    this.layoutDirty = true;
    this.refreshActiveAndLayout(true);
  }

  /** 写入播放时间；isSeek 时同步重算布局并直接落位。 */
  setCurrentTime(timeMs: number, isSeek = false) {
    this.currentTimeMs = Math.max(0, Math.trunc(timeMs));
    this.refreshActiveAndLayout(isSeek);
  }

  setPlaying(value: boolean) {
    if (this.playing === value) return;
    this.playing = value;
    // BG 行折叠状态依赖播放态，需要重排目标
    this.calcLayout(false);
  }

  setAlignAnchor(value: WordLyricAlignAnchor) {
    this.alignAnchor = value;
  }

  setAlignPosition(value: number) {
    this.alignPosition = Number.isFinite(value) ? clampValue(0, value, 1) : 0.5;
  }

  setEnableSpring(value: boolean) {
    this.enableSpring = value;
  }

  setEnableBlur(value: boolean) {
    this.enableBlur = value;
  }

  setEnableScale(value: boolean) {
    this.enableScale = value;
  }

  setHidePassedLines(value: boolean) {
    this.hidePassedLines = value;
  }

  /** 渐变宽度以主字号倍数为单位，允许极小值但不允许 0。 */
  setWordFadeWidth(value: number) {
    this.wordFadeWidth = Number.isFinite(value) ? Math.max(0.0001, value) : 0.5;
  }

  setLineGap(value: number) {
    this.lineGap = Number.isFinite(value) ? clampValue(0.6, value, 2) : 1;
    this.layoutDirty = true;
  }

  setDisableBlurFilter(value: boolean) {
    this.disableBlurFilter = value;
  }

  /* ---------- 手动滚动控制 ---------- */

  resetScroll() {
    this.userScrollY = 0;
    if (this.scrollResetTimer !== 0) {
      clearTimeout(this.scrollResetTimer);
      this.scrollResetTimer = 0;
    }
  }

  /** seek 期间冻结滚轮两帧，防止输入事件与布局重算互相踩踏。 */
  suspendScrollForSeek() {
    this.allowScroll = false;
    if (this.suspendFrameHandle !== 0) cancelAnimationFrame(this.suspendFrameHandle);
    this.suspendFrameHandle = requestAnimationFrame(() => {
      this.suspendFrameHandle = requestAnimationFrame(() => {
        this.suspendFrameHandle = 0;
        this.allowScroll = true;
      });
    });
  }

  /**
   * seek 对齐：显式指定非 BG 目标行时，直接以该行（连同 BG 伴随行）
   * 作为活动集合；未指定则保留按时间推断的结果。
   * 只改状态不重排，重排由调用方随后的 calcLayout(sync) 完成。
   */
  alignScrollToSeekTarget(lineIndex?: number) {
    const total = this.lineEntries.length;
    const valid = lineIndex !== undefined
      && Number.isInteger(lineIndex)
      && lineIndex >= 0
      && lineIndex < total
      && !this.lines[lineIndex]?.isBG;

    if (!valid) return;

    const next = new Set<number>([lineIndex!]);
    if (this.lines[lineIndex! + 1]?.isBG) next.add(lineIndex! + 1);
    this.activeIndices = next;
    this.interlude = null;
    this.dotsVisible = false;
  }

  /* ---------- 布局 ---------- */

  /**
   * 重排列目标：对齐行、BG 折叠、间奏点占位、行间级联延迟、
   * 每行的透明度 / 缩放 / 模糊目标值。sync = true 时跳过动画直接落位。
   */
  calcLayout(sync = false) {
    if (this.disposed || this.lineEntries.length === 0) return;

    this.measure();
    this.layoutDirty = false;

    const interlude = this.interlude;
    const dotsUsable = interlude !== null && interlude.durationMs >= INTERLUDE_MIN_MS;
    this.dotsVisible = dotsUsable;

    let target: number;
    if (dotsUsable && interlude) {
      target = interlude.anchorIndex + 1;
    } else if (this.activeIndices.size > 0) {
      target = Math.min(...this.activeIndices);
    } else {
      target = this.lines.findIndex((line) => line.startTime >= this.currentTimeMs);
      if (target < 0) target = this.lines.length - 1;
    }
    if (this.lines[target]?.isBG) target = Math.max(0, target - 1);

    // 流内累计：BG 行播放中且非活动 → 折叠为 0；间奏点按锚点插入流
    const prerollDots = dotsUsable && interlude !== null && interlude.anchorIndex < 0;
    const dotsAfterIndex = dotsUsable && interlude !== null ? interlude.anchorIndex : -2;
    let cursor = 0;
    let scrollBase = 0;
    let dotsFlowOffset = 0;

    for (let i = 0; i < this.lineEntries.length; i += 1) {
      const entry = this.lineEntries[i]!;
      if (prerollDots && i === 0) {
        dotsFlowOffset = cursor;
        cursor += this.dotsFlowHeight;
        scrollBase += this.dotsFlowHeight;
      }
      entry.flowOffset = cursor;
      const collapse = entry.line.isBG && this.playing && !this.activeIndices.has(i);
      const height = collapse ? 0 : entry.positionedHeight;
      if (i < target) scrollBase += height;
      cursor += height;
      if (dotsAfterIndex === i) {
        dotsFlowOffset = cursor;
        cursor += this.dotsFlowHeight;
        if (i < target) scrollBase += this.dotsFlowHeight;
      }
    }
    this.flowTotal = cursor;

    const anchorEntry = this.lineEntries[target];
    const anchorHeight = anchorEntry?.layoutHeight ?? this.fontPx * 1.9;
    this.anchorAdjust = this.alignAnchor === 'bottom'
      ? anchorHeight
      : this.alignAnchor === 'center' ? anchorHeight / 2 : 0;

    // 手动滚动边界：内容顶部不超过对齐点，尾部不超过半屏
    const alignTerm = this.playerHeight * this.alignPosition - this.anchorAdjust;
    this.scrollMaxUserY = scrollBase;
    this.scrollMinUserY = -(Math.max(0, this.flowTotal - scrollBase + alignTerm - this.playerHeight / 2));
    this.userScrollY = clampValue(this.scrollMinUserY, this.userScrollY, this.scrollMaxUserY);

    const flowY = -scrollBase + alignTerm + this.userScrollY;

    if (dotsUsable) {
      this.dotsPendingY = flowY + dotsFlowOffset;
      if (sync) {
        this.dotsSpring.position = this.dotsPendingY;
        this.dotsSpring.velocity = 0;
      }
    }

    const latestActive = this.activeIndices.size > 0 ? Math.max(...this.activeIndices) : target;
    const blurScale = window.innerWidth <= 1024 ? 0.8 : 1;
    const cutoffIndex = dotsUsable && interlude ? interlude.anchorIndex + 1 : target;
    let cascadeDelay = 0;

    for (let i = 0; i < this.lineEntries.length; i += 1) {
      const entry = this.lineEntries[i]!;
      const isActive = this.activeIndices.has(i);
      const line = entry.line;

      let targetOpacity: number;
      if (this.hidePassedLines && this.playing && i < cutoffIndex) {
        targetOpacity = 0.0001;
      } else if (isActive) {
        targetOpacity = 1;
      } else if (line.isBG && !this.playing) {
        targetOpacity = 0.4;
      } else {
        // 层次对齐移动端：按与锚点行的距离分档压暗
        const dist = Math.abs(i - target);
        targetOpacity = dist <= 1 ? 0.42 : dist === 2 ? 0.28 : 0.16;
      }

      let targetBlur = 0;
      if (this.enableBlur && !isActive) {
        // 对齐移动端 σ = 1 + dist(+1 已唱行)，σ→CSS 按 2σ 换算
        targetBlur = (1 + (i < target
          ? Math.abs(target - i) + 1
          : Math.abs(i - Math.max(target, latestActive)))) * 2;
        targetBlur *= blurScale;
      }

      const targetScale = this.enableScale && !isActive && this.playing
        ? (line.isBG ? 0.75 : 0.92)
        : 1;

      entry.targetOpacity = targetOpacity;
      entry.targetBlur = targetBlur;
      entry.targetScale = targetScale;
      // 邻行向活动行聚拢（对齐移动端 ±2px/步 的层叠感）
      const fan = clampValue(-FAN_MAX_STEPS, i - target, FAN_MAX_STEPS) * -FAN_STEP_EM * this.fontPx;
      entry.pendingY = flowY + entry.flowOffset + fan;

      if (sync) {
        entry.spring.position = entry.pendingY;
        entry.spring.velocity = 0;
        entry.delayMs = 0;
        entry.scale = targetScale;
        entry.blur = targetBlur;
        entry.opacity = targetOpacity;
      } else {
        entry.delayMs = i > target ? cascadeDelay : 0;
        if (!line.isBG && i >= target) cascadeDelay += STAGGER_STEP_MS;
      }
    }
  }

  /** 尺寸与行高测量；行高 / 词宽仅在脏标记时重测，避免每帧强制重排。 */
  private measure() {
    this.fontPx = Number.parseFloat(getComputedStyle(this.root).fontSize) || 16;
    this.playerHeight = this.root.clientHeight > 0
      ? this.root.clientHeight
      : Math.max(180, window.innerHeight * 0.42);

    if (!this.layoutDirty) return;

    for (const entry of this.lineEntries) {
      entry.el.style.minHeight = `${Math.max(32, this.fontPx * 1.8)}px`;
      const measured = entry.el.offsetHeight;
      entry.layoutHeight = measured > 0
        ? measured
        : this.estimateLineHeight(entry.line);
      entry.positionedHeight = Math.max(MIN_LAYOUT_HEIGHT, entry.layoutHeight) * this.lineGap;
      for (const word of entry.words) {
        word.width = word.wrapper.offsetWidth;
      }
    }
    if (this.dotsEl) this.dotsFlowHeight = this.dotsEl.offsetHeight;
  }

  /** 测量失败时的行高估算（按字号、副行数量与 BG 缩比推算）。 */
  private estimateLineHeight(line: AmlPlayerLine): number {
    const font = this.fontPx;
    const subCount = Number(line.translatedLyric.trim().length > 0)
      + Number(line.romanLyric.trim().length > 0);
    const verticalPadding = font;
    const mainHeight = font * 1.35;
    const subHeight = subCount * Math.max(font * 0.85, 14) * 1.35;
    const bgScale = line.isBG ? 0.78 : 1;
    return Math.max(font * 1.9, (verticalPadding + mainHeight + subHeight) * bgScale);
  }

  /* ---------- 逐帧更新 ---------- */

  /** 推进一帧；播放中按帧间时长平滑推进内部时间，暂停时仅演算动画。 */
  update(delta = 0) {
    if (this.disposed || this.lineEntries.length === 0) return;
    const deltaMs = clampValue(0, delta, 64);
    if (this.playing) {
      this.currentTimeMs += deltaMs;
      // 帧内推进可能跨越行边界，这里只在活动行 / 间奏变化时才触发重排
      this.refreshActiveAndLayout(false);
    }

    for (const entry of this.lineEntries) {
      if (entry.delayMs > 0) {
        entry.delayMs = Math.max(0, entry.delayMs - deltaMs);
      } else if (this.enableSpring) {
        stepSpring(entry.spring, entry.pendingY, deltaMs, FLOW_STIFFNESS, FLOW_DAMPING);
      } else {
        entry.spring.position = entry.pendingY;
        entry.spring.velocity = 0;
      }

      const settle = 1 - Math.exp(-deltaMs / 120);
      entry.scale += (entry.targetScale - entry.scale) * settle;
      entry.blur += (entry.targetBlur - entry.blur) * settle;
      entry.opacity += (entry.targetOpacity - entry.opacity) * settle;

      entry.el.style.transform = `translate3d(0, ${entry.spring.position.toFixed(2)}px, 0) scale(${entry.scale.toFixed(4)})`;
      entry.el.style.opacity = entry.opacity.toFixed(3);
      if (!this.disableBlurFilter && entry.blur > 0.05) {
        entry.el.style.filter = `blur(${Math.min(MAX_BLUR_PX, entry.blur).toFixed(2)}px)`;
      } else {
        entry.el.style.filter = '';
      }
    }

    this.updateWordMasks();
    this.updateDots(deltaMs);
  }

  /** 词级遮罩刷新：活动行逐帧横扫；状态切换行一次性归位（清遮罩与词内 pop，明暗交给行透明度）。 */
  private updateWordMasks() {
    // 羽化按词宽比例（对齐移动端 ShaderMask 的 10% 词宽）：wordFadeWidth 0.5 = 标准羽化、≈0 = 硬边扫光
    const fadeScale = Math.max(0.0001, this.wordFadeWidth) * 0.2;

    for (const entry of this.lineEntries) {
      const state = this.resolveVisualState(entry);
      if (state !== entry.visualState) {
        entry.visualState = state;
        this.applyStaticWordMasks(entry, state);
        this.applyStaticSubLineProgress(entry, state);
        continue;
      }
      if (state !== 'active') continue;

      // 子行扫光跟着主行词级节奏推进；暂停时的突发帧也会走到这里，进度保持一致
      entry.el.style.setProperty(SUB_LINE_PROGRESS_VAR, resolveSubLineProgressValue(this.currentTimeMs, entry.line));

      for (const word of entry.words) {
        const progress = wordProgress(word.word, this.currentTimeMs);
        if (Math.abs(progress - word.progress) < 0.0005) continue;
        word.progress = progress;
        this.applyWordMask(word, progress, fadeScale);
        // 唱毕词保留余晖辉光（对齐移动端 Shadow α0.35）；唱中词按 sin 相位上浮放大
        word.wrapper.classList.toggle('wlp-word--glow', progress >= 1);
        const pop = Math.sin(progress * Math.PI);
        word.wrapper.style.transform = pop > 0.001
          ? `translate3d(0, ${(-0.09 * pop).toFixed(3)}em, 0) scale(${(1 + 0.05 * pop).toFixed(4)})`
          : '';
      }
    }
  }

  private resolveVisualState(entry: LineEntry): LineVisualState {
    if (this.activeIndices.has(entry.lineIndex)) return 'active';
    return entry.line.startTime <= this.currentTimeMs ? 'past' : 'future';
  }

  /**
   * 活动行收敛：行时间窗口重叠时只保留最新起唱的一组
   * （对齐移动端「最后一条已起唱行」的单活动模型）。
   * 数据源会把长句拆成时间窗重叠的两条行（视觉上像折行），对唱标记也可能误标；
   * 任何多行同扫都会呈现「两行一起逐字」，因此一律收敛为单活动组。
   * BG 伴随行始终跟随其主行。
   */
  private resolveActiveIndices(): number[] {
    const hits = findActiveLineIndices(this.lines, this.currentTimeMs);
    if (hits.length <= 1) return hits;
    const last = hits[hits.length - 1]!;
    const lastLine = this.lines[last]!;
    if (!lastLine.isBG) return [last];
    const prev = hits[hits.length - 2]!;
    return [prev, last];
  }

  private applyStaticWordMasks(entry: LineEntry, state: LineVisualState) {
    // 非活动行不再叠字级暗遮罩：行透明度按距离分档统一控制明暗（对齐移动端）
    for (const word of entry.words) {
      word.wrapper.classList.remove('wlp-word--glow');
      word.wrapper.style.transform = '';
      if (state === 'past') {
        word.progress = 1;
        this.clearWordMask(word);
      } else if (state === 'future') {
        word.progress = 0;
        this.clearWordMask(word);
      }
    }
  }

  /** 非活动行的子行进度一次性归位：唱毕全亮、未唱全暗。 */
  private applyStaticSubLineProgress(entry: LineEntry, state: LineVisualState) {
    entry.el.style.setProperty(SUB_LINE_PROGRESS_VAR, state === 'past' ? '100%' : '0%');
  }

  private applyWordMask(word: WordEntry, progress: number, fadeScale: number) {
    if (word.width <= 0) {
      this.clearWordMask(word);
      return;
    }
    // 已唱区域全亮，未唱区域保留 28% 亮度，交界按词宽 10% 羽化（fadeScale=0.1 时）
    const fadePx = fadeScale * word.width;
    const edge = progress * (word.width + fadePx) - fadePx;
    const image = `linear-gradient(90deg, rgba(255,255,255,1) ${edge.toFixed(2)}px, rgba(255,255,255,${DIM_TEXT_ALPHA}) ${(edge + fadePx).toFixed(2)}px)`;
    this.setWordMaskImage(word.wrapper, image);
  }

  private clearWordMask(word: WordEntry) {
    this.setWordMaskImage(word.wrapper, '');
  }

  /** 同时写入标准与 -webkit 前缀的遮罩，兼容旧版 WebView。 */
  private setWordMaskImage(element: HTMLElement, image: string) {
    element.style.maskImage = image;
    if (image) {
      element.style.setProperty('-webkit-mask-image', image);
    } else {
      element.style.removeProperty('-webkit-mask-image');
    }
  }

  private updateDots(deltaMs: number) {
    const dots = this.dotsEl;
    if (!dots) return;

    let targetScale = 0;
    if (this.dotsVisible && this.interlude) {
      const { startMs, endMs } = this.interlude;
      const duration = Math.max(1, endMs - startMs);
      const elapsed = clampValue(0, this.currentTimeMs - startMs, duration);
      // 呼吸周期按整数等分，保证起止相位衔接；入场淡入、离场收敛
      const breathe = duration / Math.ceil(duration / 1500);
      targetScale = 1 + Math.sin((elapsed / breathe) * Math.PI * 2 - Math.PI / 2) / 14;
      targetScale *= easeOutCubic(elapsed / 500);
      targetScale *= clampValue(0, (duration - elapsed) / 350, 1);
      targetScale = clampValue(0, targetScale, 1) * 0.9;
    }

    if (this.enableSpring) {
      stepSpring(this.dotsSpring, this.dotsPendingY, deltaMs, FLOW_STIFFNESS, FLOW_DAMPING);
    } else {
      this.dotsSpring.position = this.dotsPendingY;
      this.dotsSpring.velocity = 0;
    }
    this.dotsScale += (targetScale - this.dotsScale) * (1 - Math.exp(-deltaMs / 220));
    this.dotsOpacity += ((targetScale > 0 ? 1 : 0) - this.dotsOpacity) * (1 - Math.exp(-deltaMs / 220));

    dots.style.transform = `translate3d(0, ${this.dotsSpring.position.toFixed(2)}px, 0) scale(${this.dotsScale.toFixed(4)})`;
    dots.style.opacity = this.dotsOpacity.toFixed(3);
  }

  /* ---------- DOM 构建 ---------- */

  private rebuildDom() {
    for (const entry of this.lineEntries) entry.el.remove();
    this.lineEntries = [];

    let hasDuet = false;
    this.lines.forEach((line, index) => {
      hasDuet = hasDuet || line.isDuet;
      this.lineEntries.push(this.buildLine(line, index));
    });
    this.root.classList.toggle('wlp-has-duet', hasDuet);
    if (this.dotsEl) this.root.appendChild(this.dotsEl);
  }

  private buildLine(line: AmlPlayerLine, lineIndex: number): LineEntry {
    const el = document.createElement('div');
    el.className = 'wlp-line';
    if (line.isBG) el.classList.add('wlp-line--bg');
    if (line.isDuet) el.classList.add('wlp-line--duet');
    el.style.transformOrigin = 'var(--lyrics-line-transform-origin, 0%) center';

    const words: WordEntry[] = [];
    const main = document.createElement('div');
    main.className = 'wlp-line__main';

    for (const word of line.words) {
      const wrapper = document.createElement('span');
      wrapper.className = 'wlp-word';

      const roman = (word.romanWord || '').trim();
      if (roman) {
        const romanEl = document.createElement('span');
        romanEl.className = 'wlp-word__roman';
        romanEl.textContent = roman;
        wrapper.appendChild(romanEl);
      }

      const textEl = document.createElement('span');
      textEl.className = 'wlp-word__text';
      textEl.textContent = word.word;
      wrapper.appendChild(textEl);

      main.appendChild(wrapper);
      words.push({
        wrapper,
        word,
        width: 0,
        progress: -1,
      });
    }

    el.appendChild(main);

    // 副行顺序对齐旧观感：罗马音在上、翻译在下
    if (line.romanLyric.trim()) {
      const romanLine = document.createElement('div');
      romanLine.className = 'wlp-line__sub wlp-line__sub--roman';
      romanLine.appendChild(this.buildSubText(line.romanLyric));
      el.appendChild(romanLine);
    }
    if (line.translatedLyric.trim()) {
      const translation = document.createElement('div');
      translation.className = 'wlp-line__sub wlp-line__sub--translation';
      translation.appendChild(this.buildSubText(line.translatedLyric));
      el.appendChild(translation);
    }

    el.addEventListener('click', () => {
      if (this.disposed) return;
      const event: WordLyricLineClickEvent = { line, lineIndex };
      this.lineClickHandlers.forEach((handler) => handler(event));
    });

    this.root.appendChild(el);

    return {
      el,
      line,
      lineIndex,
      words,
      layoutHeight: 0,
      positionedHeight: 0,
      flowOffset: 0,
      spring: { position: 0, velocity: 0 },
      pendingY: 0,
      delayMs: 0,
      scale: 1,
      blur: 0,
      opacity: 1,
      targetScale: 1,
      targetBlur: 0,
      targetOpacity: 1,
      visualState: 'future',
    };
  }

  private buildDotsEl() {
    const dots = document.createElement('div');
    dots.className = 'wlp-interlude-dots';
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'wlp-interlude-dots__dot';
      dots.appendChild(dot);
    }
    this.dotsEl = dots;
  }

  /** 子行文本包裹层：遮罩挂在它上面，宽度恰好等于文本宽度。 */
  private buildSubText(text: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'wlp-line__sub-text';
    span.textContent = text;
    return span;
  }

  /* ---------- 滚轮 ---------- */

  private handleWheel = (event: WheelEvent) => {
    if (!this.allowScroll || this.disposed) return;
    const unit = event.deltaMode === 0 ? 1 : 50;
    this.userScrollY = clampValue(
      this.scrollMinUserY,
      this.userScrollY + event.deltaY * unit,
      this.scrollMaxUserY,
    );
    if (this.scrollResetTimer !== 0) clearTimeout(this.scrollResetTimer);
    this.scrollResetTimer = window.setTimeout(() => {
      this.scrollResetTimer = 0;
      this.userScrollY = 0;
      this.calcLayout(false);
    }, SCROLL_RESET_DELAY_MS);
    this.calcLayout(false);
  };

  /** 布局修复入口：强制重测 + 同步重排 + 落位一帧（挂载、换行、字号、尺寸变化时调用）。 */
  recoverLayout() {
    if (this.disposed) return;
    this.layoutDirty = true;
    this.refreshActiveAndLayout(true);
    this.update(0);
  }

  private refreshActiveAndLayout(isSeek: boolean) {
    if (this.disposed) return;
    const actives = this.resolveActiveIndices();
    const changed = !sameIndexSet(actives, this.activeIndices);
    this.activeIndices = new Set(actives);
    this.interlude = actives.length === 0
      ? findInterludeWindow(this.lines, this.currentTimeMs)
      : null;

    if (isSeek || changed || this.layoutDirty) {
      this.calcLayout(isSeek);
    }
  }
}
