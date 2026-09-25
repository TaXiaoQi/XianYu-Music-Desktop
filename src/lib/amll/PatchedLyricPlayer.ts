import { DomLyricPlayer } from '@applemusic-like-lyrics/core';

import {
  SUB_LINE_CLASS_FRAGMENT,
  SUB_LINE_PROGRESS_VAR,
  SUB_LINE_TEXT_CLASS,
  resolveSubLineProgressValue,
} from './subLineHighlight';

function isCjkWord(word: string): boolean {
  return /^[\p{Unified_Ideograph}\u0800-\u9FFC]+$/u.test(word);
}

function patchShouldEmphasize(lineObj: unknown): void {
  const ctor = (lineObj as { constructor?: unknown }).constructor;
  let cls: any = typeof ctor === 'function' ? ctor : undefined;
  while (cls && !Object.prototype.hasOwnProperty.call(cls, 'shouldEmphasize')) {
    cls = Object.getPrototypeOf(cls);
  }
  if (cls && typeof cls.shouldEmphasize === 'function' && !cls.__xyShouldEmphasizePatched) {
    cls.__xyShouldEmphasizePatched = true;
    cls.shouldEmphasize = (word: { word?: string; startTime: number; endTime: number }) => {
      const text = (word.word ?? '').trim();
      const duration = word.endTime - word.startTime;
      if (isCjkWord(text)) {
        return duration >= 200 && text.length > 0;
      }
      return duration >= 1000 && text.length <= 7 && text.length > 1;
    };
  }
}

export class PatchedLyricPlayer extends DomLyricPlayer {
  private lineGap = 1;
  private restoreScrollFrameId = 0;
  public disableBlurFilter = false;
  private blurCache = new WeakMap<object, number>();
  private layoutSettleFrameId = 0;

  private hasFiniteTime(value: number | undefined): value is number {
    return Number.isFinite(value);
  }

  private clamp(min: number, value: number, max: number) {
    return Math.max(min, Math.min(value, max));
  }

  private easeOutExpo(value: number) {
    return value === 1 ? 1 : 1 - 2 ** (-10 * value);
  }

  private easeInOutBack(value: number) {
    const constant = 2.5949095;
    if (value < 0.5) {
      return (2 * value) ** 2 * ((constant + 1) * 2 * value - constant) / 2;
    }

    return ((2 * value - 2) ** 2 * ((constant + 1) * (value * 2 - 2) + constant) + 2) / 2;
  }

  /**
   * 翻译/音译子行的同步扫光。
   *
   * AMLL 的子行是固定透明度的静态暗行（库 CSS `._lyricSubLine_ { opacity: .3 }`），只有
   * 主行的词级遮罩会扫光，所以翻译看着「没有高光」。这里按行的演唱进度写一个进度变量到行
   * 元素（CSS 变量会被子行继承），并确保子行文本被一个 inline-block 包裹层夹住——遮罩挂在
   * 包裹层上，其宽度就是文本宽度，扫光恰好覆盖文本、与主行逐字高光同时结束，不会因为中文
   * 比整行短就提前扫完。
   */
  private syncSubLineHighlights() {
    const currentTime = this.currentTime;
    if (!this.hasFiniteTime(currentTime)) return;

    for (const lineObj of this.currentLyricLineObjects) {
      const element = this.getLineElement(lineObj);
      if (!element) continue;

      const line = lineObj.getLine();
      // 没有子行就不必动 DOM
      if (!line.translatedLyric.trim() && !line.romanLyric.trim()) continue;

      const value = resolveSubLineProgressValue(currentTime, line);
      if (element.style.getPropertyValue(SUB_LINE_PROGRESS_VAR) !== value) {
        element.style.setProperty(SUB_LINE_PROGRESS_VAR, value);
      }

      for (const subLine of element.querySelectorAll<HTMLElement>(`[class*="${SUB_LINE_CLASS_FRAGMENT}"]`)) {
        this.ensureSubLineTextWrapper(subLine);
      }
    }
  }

  /** 库会用 innerText 重写子行内容，所以每帧确认包裹层还在（只读类名，不做布局读取）。 */
  private ensureSubLineTextWrapper(subLine: HTMLElement) {
    const first = subLine.firstElementChild;
    if (first && first.classList.contains(SUB_LINE_TEXT_CLASS)) return;

    const text = subLine.textContent ?? '';
    if (!text.trim()) return;

    const wrapper = document.createElement('span');
    wrapper.className = SUB_LINE_TEXT_CLASS;
    wrapper.textContent = text;
    subLine.replaceChildren(wrapper);
  }
  /**
   * 重设行之后收敛布局。
   *
   * 行位置由弹簧推进，而弹簧只在 update() 里前进——组件只在播放中调 update，于是暂停时
   * 重设行（进详情页挂载、切换翻译/罗马音）会让所有行停在初始位置、看起来「歌词没了」，
   * 必须点播放才出现。这里自己跑一小段 update 把位置收敛到位，与是否播放无关。
   */
  private scheduleLayoutSettle(frames = 16) {
    if (this.layoutSettleFrameId !== 0) {
      cancelAnimationFrame(this.layoutSettleFrameId);
      this.layoutSettleFrameId = 0;
    }

    let remaining = frames;
    let lastTime = -1;
    const tick = (time: number) => {
      if (lastTime === -1) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;
      this.update(delta > 0 ? delta : 0);

      remaining -= 1;
      if (remaining > 0) {
        this.layoutSettleFrameId = requestAnimationFrame(tick);
      } else {
        this.layoutSettleFrameId = 0;
      }
    };

    this.layoutSettleFrameId = requestAnimationFrame(tick);
  }
  private syncLineTransformsToDom() {
    for (const lineObj of this.currentLyricLineObjects) {
      const lineElement = this.getLineElement(lineObj);
      if (!lineElement) continue;

      const transformState = (lineObj as unknown as {
        lineTransforms?: {
          posY: { getCurrentPosition: () => number };
          scale: { getCurrentPosition: () => number };
        };
        blur?: number;
      }).lineTransforms;

      if (!transformState) continue;

      const posY = transformState.posY.getCurrentPosition();
      const scale = transformState.scale.getCurrentPosition() / 100;
      const blur = (lineObj as unknown as { blur?: number }).blur ?? 0;

      lineElement.style.transform = `translateY(${posY.toFixed(3)}px) scale(${scale.toFixed(4)})`;
      if (!this.disableBlurFilter) {
        const clampedBlur = Math.min(32, blur);
        const lineKey = lineObj as unknown as object;
        const lastBlur = this.blurCache.get(lineKey);
        if (lastBlur === undefined || Math.abs(lastBlur - clampedBlur) > 0.1) {
          lineElement.style.filter = `blur(${clampedBlur.toFixed(3)}px)`;
          lineElement.style.willChange = 'transform, filter';
          this.blurCache.set(lineKey, clampedBlur);
        }
      } else {
        lineElement.style.filter = '';
        lineElement.style.willChange = 'transform';
      }
      lineElement.style.transformOrigin = lineElement.className.includes('Duet') ? '100%' : '0';
    }
  }

  private syncBottomLineTransformToDom() {
    const bottomLine = this.bottomLine as unknown as {
      getElement?: () => HTMLElement;
      lineTransforms?: {
        posX: { getCurrentPosition: () => number };
        posY: { getCurrentPosition: () => number };
      };
    };
    const element = typeof bottomLine.getElement === 'function'
      ? bottomLine.getElement.call(bottomLine)
      : null;
    const transforms = bottomLine.lineTransforms;

    if (!element || !transforms) return;

    const posX = transforms.posX.getCurrentPosition();
    const posY = transforms.posY.getCurrentPosition();
    element.style.transform = `translate(${posX.toFixed(3)}px, ${posY.toFixed(3)}px)`;
    element.style.willChange = 'transform';
  }

  private syncInterludeDotsToDom() {
    const interludeDots = this.interludeDots as unknown as {
      getElement?: () => HTMLElement;
      left?: number;
      top?: number;
      playing?: boolean;
      currentTime?: number;
      currentInterlude?: [number, number] | undefined;
      targetBreatheDuration?: number;
      dot0?: HTMLElement;
      dot1?: HTMLElement;
      dot2?: HTMLElement;
    };
    const element = typeof interludeDots.getElement === 'function'
      ? interludeDots.getElement.call(interludeDots)
      : null;

    if (!element) return;

    const left = interludeDots.left ?? 0;
    const top = interludeDots.top ?? 0;
    let scale = 1;

    if (interludeDots.currentInterlude) {
      const [startTime, endTime] = interludeDots.currentInterlude;
      const currentTime = interludeDots.currentTime ?? startTime;
      const duration = endTime - startTime;
      const elapsed = currentTime - startTime;

      if (duration > 0 && elapsed <= duration) {
        const breatheDuration = duration / Math.ceil(duration / (interludeDots.targetBreatheDuration ?? 1500));
        scale *= Math.sin(1.5 * Math.PI - elapsed / breatheDuration * 2) / 20 + 1;

        if (elapsed < 2000) {
          scale *= this.easeOutExpo(elapsed / 2000);
        }

        if (duration - elapsed < 750) {
          const ratio = (750 - (duration - elapsed)) / 750 / 2;
          scale *= 1 - this.easeInOutBack(ratio);
        }

        scale = Math.max(0, scale) * 0.7;
      } else {
        scale = 0;
      }
    }

    element.style.transform = `translate(${left.toFixed(3)}px, ${top.toFixed(3)}px) scale(${this.clamp(0, scale, 1).toFixed(4)})`;
    element.style.willChange = 'transform';
  }

  private syncAuxiliaryTransformsToDom() {
    this.syncBottomLineTransformToDom();
    this.syncInterludeDotsToDom();
  }

  private getLineElement(
    lineObj: (typeof this.currentLyricLineObjects)[number],
  ): HTMLElement | null {
    const getElement = (lineObj as unknown as { getElement?: () => HTMLElement }).getElement;
    return typeof getElement === 'function' ? getElement.call(lineObj) : null;
  }

  private patchLineElementLayout() {
    for (const lineObj of this.currentLyricLineObjects) {
      const lineElement = this.getLineElement(lineObj);
      if (!lineElement) continue;

      lineElement.style.height = 'auto';
      lineElement.style.minHeight = `${Math.max(32, this.baseFontSize * 1.8)}px`;
      lineElement.style.top = '0';
      lineElement.style.left = '0';
      lineElement.style.contain = 'layout style';
      lineElement.style.overflow = 'visible';
      lineElement.style.contentVisibility = 'visible';
    }
  }

  private syncMeasuredSize() {
    const playerEl = this.getElement();
    const wrapperEl = playerEl.parentElement;
    const playerRect = playerEl.getBoundingClientRect();
    const wrapperRect = wrapperEl?.getBoundingClientRect();

    const safeWidth = Math.max(
      this.size[0],
      playerEl.clientWidth,
      playerRect.width,
      wrapperEl?.clientWidth ?? 0,
      wrapperRect?.width ?? 0,
    );
    const safeHeight = Math.max(
      this.size[1],
      playerEl.clientHeight,
      playerRect.height,
      wrapperEl?.clientHeight ?? 0,
      wrapperRect?.height ?? 0,
    );

    if (safeWidth > 0) this.size[0] = safeWidth;
    if (safeHeight > 0) this.size[1] = safeHeight;
  }

  private getSafePlayerHeight() {
    this.syncMeasuredSize();

    const playerEl = this.getElement();
    const wrapperEl = playerEl.parentElement;
    const playerRect = playerEl.getBoundingClientRect();
    const wrapperRect = wrapperEl?.getBoundingClientRect();
    const viewportFallback = Math.max(180, window.innerHeight * 0.42);

    const safeHeight = Math.max(
      this.size[1],
      playerEl.clientHeight,
      playerRect.height,
      wrapperEl?.clientHeight ?? 0,
      wrapperRect?.height ?? 0,
      viewportFallback,
    );

    if (safeHeight > this.size[1]) {
      this.size[1] = safeHeight;
    }

    return safeHeight;
  }

  private estimateLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    const line = lineObj.getLine();
    const baseFontSize = Number.isFinite(this.baseFontSize) && this.baseFontSize > 0
      ? this.baseFontSize
      : Math.max(20, playerHeight * 0.075);
    const subLineCount = Number(line.translatedLyric.trim().length > 0) +
      Number(line.romanLyric.trim().length > 0);
    const verticalPadding = baseFontSize;
    const mainLineHeight = baseFontSize * 1.25;
    const subLinesHeight = subLineCount * Math.max(baseFontSize * 0.85, 14) * 1.35;
    const bgScale = line.isBG ? 0.78 : 1;

    return Math.max(
      baseFontSize * 1.9,
      (verticalPadding + mainLineHeight + subLinesHeight) * bgScale,
    );
  }

  private getSafeLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    const measuredHeight = this.lyricLinesSize.get(lineObj)?.[1] ?? 0;
    const minReliableHeight = Math.max(12, this.baseFontSize * 0.35);

    if (measuredHeight >= minReliableHeight) {
      return measuredHeight;
    }

    return this.estimateLineHeight(lineObj, playerHeight);
  }

  private getLayoutLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    return Math.max(36, this.getSafeLineHeight(lineObj, playerHeight));
  }

  private getPositionedLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    return Math.max(36, this.getLayoutLineHeight(lineObj, playerHeight) * this.lineGap);
  }

  setLineGap(value: number) {
    if (!Number.isFinite(value)) {
      this.lineGap = 1;
      return;
    }

    this.lineGap = this.clamp(0.6, value, 2);
  }

  suspendScrollForSeek() {
    this.allowScroll = false;

    if (this.restoreScrollFrameId !== 0) {
      cancelAnimationFrame(this.restoreScrollFrameId);
      this.restoreScrollFrameId = 0;
    }

    this.restoreScrollFrameId = requestAnimationFrame(() => {
      this.restoreScrollFrameId = requestAnimationFrame(() => {
        this.allowScroll = true;
        this.restoreScrollFrameId = 0;
      });
    });
  }

  private enableLineRespectingPlayState(index: number) {
    const lineObj = this.currentLyricLineObjects[index] as unknown as {
      enable?: (time: number) => void | Promise<void>;
      pause?: () => void | Promise<void>;
    } | undefined;

    if (!lineObj?.enable) return;

    const enableResult = lineObj.enable(this.currentTime);

    if (this.isPlaying || typeof lineObj.pause !== 'function') return;

    void Promise.resolve(enableResult).then(() => {
      if (this.isPlaying) return;
      void lineObj.pause?.();
    });
  }

  alignScrollToSeekTarget(lineIndex?: number) {
    let explicitIndex: number | undefined;
    if (
      Number.isInteger(lineIndex) &&
      lineIndex !== undefined &&
      lineIndex >= 0 &&
      lineIndex < this.currentLyricLineObjects.length &&
      !this.currentLyricLineObjects[lineIndex].getLine().isBG
    ) {
      explicitIndex = lineIndex;
    }

    const targetIndex = explicitIndex ?? (this.bufferedLines.size > 0
      ? Math.min(...this.bufferedLines)
      : undefined);

    if (targetIndex !== undefined) {
      this.hotLines.clear();
      this.bufferedLines.clear();

      this.hotLines.add(targetIndex);
      this.bufferedLines.add(targetIndex);
      this.enableLineRespectingPlayState(targetIndex);

      const backgroundIndex = targetIndex + 1;
      if (this.currentLyricLineObjects[backgroundIndex]?.getLine().isBG) {
        this.hotLines.add(backgroundIndex);
        this.bufferedLines.add(backgroundIndex);
        this.enableLineRespectingPlayState(backgroundIndex);
      }

      this.currentLyricLineObjects.forEach((lineObj, index) => {
        if (!this.hotLines.has(index)) {
          lineObj.disable();
        }
      });

      this.scrollToIndex = targetIndex;
    } else {
      const nextIndex = this.currentLyricLineObjects.findIndex((lineObj) => {
        const line = lineObj.getLine();
        return !line.isBG && line.startTime >= this.currentTime;
      });
      this.scrollToIndex = nextIndex === -1
        ? Math.max(0, this.currentLyricLineObjects.length - 1)
        : nextIndex;
    }
  }

  protected override getCurrentInterlude(): [number, number, number, boolean] | undefined {
    if (this.bufferedLines.size > 0) return undefined;

    const currentTime = this.currentTime + 20;
    const index = this.scrollToIndex;
    const currentLine = this.processedLines[index];
    const nextLine = this.processedLines[index + 1];
    const lineAfterNext = this.processedLines[index + 2];

    if (index === 0) {
      const firstLine = this.processedLines[0];
      const secondLine = this.processedLines[1];

      if (
        firstLine &&
        this.hasFiniteTime(firstLine.startTime) &&
        firstLine.startTime > currentTime
      ) {
        return [
          currentTime,
          Math.max(currentTime, firstLine.startTime - 250),
          -2,
          firstLine.isDuet,
        ];
      }

      if (
        firstLine &&
        secondLine &&
        this.hasFiniteTime(firstLine.endTime) &&
        this.hasFiniteTime(secondLine.startTime) &&
        secondLine.startTime > currentTime &&
        firstLine.endTime < currentTime
      ) {
        return [
          Math.max(firstLine.endTime, currentTime),
          secondLine.startTime,
          0,
          secondLine.isDuet,
        ];
      }

      return undefined;
    }

    if (
      !currentLine ||
      !nextLine ||
      !this.hasFiniteTime(currentLine.endTime) ||
      !this.hasFiniteTime(nextLine.startTime)
    ) {
      return undefined;
    }

    if (nextLine.startTime > currentTime && currentLine.endTime < currentTime) {
      return [
        Math.max(currentLine.endTime, currentTime),
        nextLine.startTime,
        index,
        nextLine.isDuet,
      ];
    }

    if (
      lineAfterNext &&
      this.hasFiniteTime(nextLine.endTime) &&
      this.hasFiniteTime(lineAfterNext.startTime) &&
      lineAfterNext.startTime > currentTime &&
      nextLine.endTime < currentTime
    ) {
      return [
        Math.max(nextLine.endTime, currentTime),
        lineAfterNext.startTime,
        index + 1,
        lineAfterNext.isDuet,
      ];
    }

    return undefined;
  }

  override onResize(): void {
    this.syncMeasuredSize();
    super.onResize();
    this.patchLineElementLayout();
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
  }

  override setLyricLines(...args: Parameters<DomLyricPlayer['setLyricLines']>): void {
    super.setLyricLines(...args);
    const firstLine = this.currentLyricLineObjects[0];
    if (firstLine) {
      patchShouldEmphasize(firstLine);
    }
    this.patchLineElementLayout();
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
    this.scheduleLayoutSettle();
  }

  override update(delta = 0): void {
    super.update(delta);
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
    this.syncSubLineHighlights();
  }

  override async calcLayout(sync = false) {
    const playerHeight = this.getSafePlayerHeight();
    const interlude = this.getCurrentInterlude();
    let curPos = -this.scrollOffset;
    let targetAlignIndex = this.scrollToIndex;
    let interludeDuration = 0;

    if (interlude) {
      interludeDuration = interlude[1] - interlude[0];
      if (interludeDuration >= 4000) {
        const nextLine = this.currentLyricLineObjects[interlude[2] + 1];
        if (nextLine) {
          targetAlignIndex = interlude[2] + 1;
        }
      }
    } else {
      this.interludeDots.setInterlude(undefined);
    }

    const scrollOffset = this.currentLyricLineObjects
      .slice(0, targetAlignIndex)
      .reduce((acc, lineObj) => {
        const lineHeight = this.getPositionedLineHeight(lineObj, playerHeight);
        return acc + (lineObj.getLine().isBG && this.isPlaying ? 0 : lineHeight);
      }, 0);

    this.scrollBoundary[0] = -scrollOffset;
    curPos -= scrollOffset;
    curPos += playerHeight * this.alignPosition;

    const currentLine = this.currentLyricLineObjects[targetAlignIndex];
    this.targetAlignIndex = targetAlignIndex;
    if (currentLine) {
      const lineHeight = this.getLayoutLineHeight(currentLine, playerHeight);
      switch (this.alignAnchor) {
        case 'bottom':
          curPos -= lineHeight;
          break;
        case 'center':
          curPos -= lineHeight / 2;
          break;
        case 'top':
          break;
      }
    }

    const latestIndex = Math.max(...this.bufferedLines);
    let delay = 0;
    let baseDelay = sync ? 0 : 0.05;
    let setDots = false;

    this.currentLyricLineObjects.forEach((lineObj, index) => {
      const hasBuffered = this.bufferedLines.has(index);
      const isActive = hasBuffered || (index >= this.scrollToIndex && index < latestIndex);
      const line = lineObj.getLine();

      if (
        !setDots &&
        interludeDuration >= 4000 &&
        ((index === this.scrollToIndex && interlude?.[2] === -2) ||
          index === this.scrollToIndex + 1)
      ) {
        setDots = true;
        this.interludeDots.setTransform(0, curPos);
        if (interlude) {
          this.interludeDots.setInterlude([interlude[0], interlude[1]]);
        }
        curPos += this.interludeDotsSize[1];
      }

      let targetOpacity: number;
      if (this.hidePassedLines) {
        if (
          index < (interlude ? interlude[2] + 1 : this.scrollToIndex) &&
          this.isPlaying
        ) {
          targetOpacity = 0.00001;
        } else if (hasBuffered) {
          targetOpacity = 0.85;
        } else {
          targetOpacity = this.isNonDynamic ? 0.2 : 1;
        }
      } else if (hasBuffered) {
        targetOpacity = 0.85;
      } else {
        targetOpacity = this.isNonDynamic ? 0.2 : 1;
      }

      let blurLevel = 0;
      if (this.enableBlur) {
        if (isActive) {
          blurLevel = 0;
        } else {
          blurLevel = 1;
          if (index < this.scrollToIndex) {
            blurLevel += Math.abs(this.scrollToIndex - index) + 1;
          } else {
            blurLevel += Math.abs(index - Math.max(this.scrollToIndex, latestIndex));
          }
        }
      }

      const scaleAspect = this.enableScale ? 97 : 100;
      let targetScale = 100;
      if (!isActive && this.isPlaying) {
        targetScale = line.isBG ? 75 : scaleAspect;
      }

      lineObj.setTransform(
        curPos,
        targetScale,
        targetOpacity,
        window.innerWidth <= 1024 ? blurLevel * 0.8 : blurLevel,
        false,
        delay,
      );

      const lineHeight = this.getPositionedLineHeight(lineObj, playerHeight);
      if (line.isBG && (isActive || !this.isPlaying)) {
        curPos += lineHeight;
      } else if (!line.isBG) {
        curPos += lineHeight;
      }

      if (curPos >= 0 && !this.isSeeking) {
        if (!line.isBG) delay += baseDelay;
        if (index >= this.scrollToIndex) baseDelay /= 1.05;
      }
    });

    this.scrollBoundary[1] = curPos + this.scrollOffset - playerHeight / 2;
    this.bottomLine.setTransform(0, curPos, false, delay);
  }

  recoverLayout(reason: string) {
    void reason;
    this.patchLineElementLayout();
    this.onResize();
    void this.calcLayout(true);
    this.update(0);
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
  }

  override dispose(): void {
    if (this.restoreScrollFrameId !== 0) {
      cancelAnimationFrame(this.restoreScrollFrameId);
      this.restoreScrollFrameId = 0;
    }

    if (this.layoutSettleFrameId !== 0) {
      cancelAnimationFrame(this.layoutSettleFrameId);
      this.layoutSettleFrameId = 0;
    }
    super.dispose();
  }
}
