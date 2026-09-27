import { describe, expect, it } from 'vitest';

import type { AmlPlayerLine, AmlPlayerWord } from '../../composables/lyrics';
import {
  findActiveLineIndices,
  findInterludeWindow,
  isEmphasizedWord,
  stepSpring,
  wordProgress,
} from './WordLyricPlayer';

function makeWord(text: string, startTime: number, endTime: number, romanWord = ''): AmlPlayerWord {
  return { word: text, startTime, endTime, romanWord, obscene: false };
}

function makeLine(overrides: Partial<AmlPlayerLine> = {}): AmlPlayerLine {
  return {
    words: [makeWord('啦啦', 0, 1000)],
    translatedLyric: '',
    romanLyric: '',
    startTime: 0,
    endTime: 1000,
    isBG: false,
    isDuet: false,
    ...overrides,
  };
}

describe('isEmphasizedWord（强调辉光判定）', () => {
  it('东亚词唱满 200ms 即可强调', () => {
    expect(isEmphasizedWord(makeWord('你好', 0, 300))).toBe(true);
    expect(isEmphasizedWord(makeWord('你好', 0, 200))).toBe(true);
    expect(isEmphasizedWord(makeWord('你好', 0, 150))).toBe(false);
  });

  it('假名词汇按东亚词处理', () => {
    expect(isEmphasizedWord(makeWord('ハロー', 0, 400))).toBe(true);
  });

  it('拉丁词需要 ≥1s 且长度在 2~7 字符', () => {
    expect(isEmphasizedWord(makeWord('dream', 0, 1200))).toBe(true);
    expect(isEmphasizedWord(makeWord('dream', 0, 900))).toBe(false);
    expect(isEmphasizedWord(makeWord('extraordinary', 0, 2000))).toBe(false);
    expect(isEmphasizedWord(makeWord('a', 0, 2000))).toBe(false);
    expect(isEmphasizedWord(makeWord('  ', 0, 2000))).toBe(false);
  });
});

describe('wordProgress（单词进度）', () => {
  it('按词时间窗钳制到 [0,1]', () => {
    const word = makeWord('la', 1000, 2000);
    expect(wordProgress(word, 500)).toBe(0);
    expect(wordProgress(word, 1500)).toBe(0.5);
    expect(wordProgress(word, 2500)).toBe(1);
  });

  it('零时长词按时间前后给 0/1', () => {
    const word = makeWord('la', 1000, 1000);
    expect(wordProgress(word, 999)).toBe(0);
    expect(wordProgress(word, 1000)).toBe(1);
  });
});

describe('findActiveLineIndices（活动行判定）', () => {
  const lines = [
    makeLine({ startTime: 0, endTime: 1000 }),
    makeLine({ startTime: 1000, endTime: 2000, isBG: true }),
    makeLine({ startTime: 2000, endTime: 3000 }),
  ];

  it('命中主行时连带其后紧邻的 BG 行', () => {
    expect(findActiveLineIndices(lines, 500)).toEqual([0, 1]);
  });

  it('时间落在行首即激活，行尾即失活', () => {
    expect(findActiveLineIndices(lines, 2000)).toEqual([2]);
    expect(findActiveLineIndices(lines, 1000)).toEqual([]);
  });

  it('空档期没有活动行，单独的 BG 行不会自行激活', () => {
    expect(findActiveLineIndices(lines, 1500)).toEqual([]);
  });
});

describe('findInterludeWindow（间奏窗口）', () => {
  it('行间空隙给出锚定行与时长', () => {
    const lines = [
      makeLine({ startTime: 0, endTime: 1000 }),
      makeLine({ startTime: 6000, endTime: 7000 }),
    ];
    const window = findInterludeWindow(lines, 3000);
    expect(window).toEqual({ startMs: 3000, endMs: 6000, anchorIndex: 0, durationMs: 3000 });
  });

  it('有活动行或下一行已起唱时不产生间奏', () => {
    const lines = [
      makeLine({ startTime: 0, endTime: 1000 }),
      makeLine({ startTime: 6000, endTime: 7000 }),
    ];
    expect(findInterludeWindow(lines, 500)).toBeNull();
    expect(findInterludeWindow(lines, 6000)).toBeNull();
  });

  it('首行未起唱时给出预滚窗口，锚定行为 -1', () => {
    const lines = [makeLine({ startTime: 5000, endTime: 6000 })];
    const window = findInterludeWindow(lines, 0);
    expect(window?.anchorIndex).toBe(-1);
    expect(window?.endMs).toBe(4750);
  });
});

describe('stepSpring（弹簧积分）', () => {
  it('向目标收敛且不发散', () => {
    const state = { position: 0, velocity: 0 };
    for (let i = 0; i < 200; i += 1) {
      stepSpring(state, 100, 16, 120, 19);
    }
    expect(state.position).toBeGreaterThan(99);
    expect(state.position).toBeLessThan(101);
    expect(Number.isFinite(state.velocity)).toBe(true);
  });

  it('零或超大帧时长不会产生异常值', () => {
    const state = { position: 10, velocity: 0 };
    stepSpring(state, 0, 0, 120, 19);
    expect(state.position).toBe(10);
    stepSpring(state, 0, 10_000, 120, 19);
    expect(Number.isFinite(state.position)).toBe(true);
  });
});
