import { it, describe, expect } from 'vitest';
import type { LyricLine, SemanticLine } from './types'; // 实现
import { semanticLineToLyricLine, convertLyricsToAmlLines, getCurrentLyricDisplayLines } from './converters';

/** 播放器会在相邻 ruby 片段之间插入不可见分隔符，比对前先去掉。 */
function stripRubyGlue(text: string): string {
  return text.replace(/\u00a0/g, ''); // 实现
}

/** 造一条最小展示行：未给字段与真实解析产物保持一致。 */
function displayRow(
  overrides: Partial<LyricLine> & Pick<LyricLine, 'time' | 'endTime' | 'text'>,
): LyricLine {
  return {
    translation: '',
    romaji: '',
    isBG: false,
    isDuet: false,
    isDuetPartner: false,
    ...overrides,
  };
}

/** 造一条最小语义行：只填测试关心的字段。 */
function semanticRow(
  overrides: Partial<SemanticLine> & Pick<SemanticLine, 'startMs' | 'endMs' | 'mainText'>,
): SemanticLine {
  return {
    confidence: 'explicit',
    isBG: false,
    isDuet: false,
    isDuetPartner: false,
    ...overrides,
  };
}

describe('展示行 → 播放器行（convertLyricsToAmlLines）', () => {
  it('密集双语行之间，纯文本行的行首导入时长被压到比例上限内', () => {
    const rows = [
      displayRow({ time: 18.11, endTime: 19.83, text: 'You show me', translation: '你告诉我' }),
      displayRow({ time: 19.83, endTime: 24.7, text: 'what is deep as sea', translation: '什么如海般深沉' }),
    ];

    const result = convertLyricsToAmlLines(rows, true, false);

    expect(result[0]?.startTime).toBe(18110);
    expect(result[0]?.endTime).toBe(19530);
    expect(result[1]?.startTime).toBe(19830);
  });

  it('无词级时间轴的行退化为单个伪词承载整行文本，并打上 isWordless 标记', () => {
    const result = convertLyricsToAmlLines([
      displayRow({ time: 103.04, endTime: 106.68, text: "And no one's asked me how I'm doing I'm doing" }),
    ], false, false);

    expect(result[0]!.isWordless).toBe(true);
    expect(result[0]!.words).toHaveLength(1);
    expect(result[0]!.words[0]!.word).toBe("And no one's asked me how I'm doing I'm doing");
    expect(result[0]!.words[0]!.startTime).toBe(103040);
    expect(result[0]!.words[0]!.endTime).toBe(106680);
  });

  it('有词级时间轴的行不打 isWordless 标记，词级时间轴照常透传', () => {
    const result = convertLyricsToAmlLines([
      displayRow({
        time: 10,
        endTime: 14,
        text: '拙い祈り',
        words: [
          { start: 10, end: 12, text: '拙い', romaji: '' },
          { start: 12, end: 14, text: '祈り', romaji: '' },
        ],
      }),
    ], false, false);

    expect(result[0]!.isWordless).toBeFalsy();
    expect(result[0]!.words.map((word) => word.word)).toEqual(['拙い', '祈り']);
    expect(result[0]!.words[0]!.startTime).toBe(10000);
    expect(result[0]!.words[1]!.endTime).toBe(14000);
  });

  it('无词级的空白兜底行同样打 isWordless 标记', () => {
    const result = convertLyricsToAmlLines([
      displayRow({ time: 10, endTime: 14, text: '   ', translation: '间奏' }),
    ], false, false);

    expect(result[0]!.isWordless).toBe(true);
    expect(result[0]!.words).toHaveLength(1);
    expect(result[0]!.words[0]!.startTime).toBe(10000);
    expect(result[0]!.words[0]!.endTime).toBe(14000);
  });

  it('独立词级罗马音时间轴原样透传，供播放器渲染 ruby 卡拉OK', () => {
    const rows = [
      displayRow({
        time: 98.981, // 实现
        endTime: 104.179, // 实现
        text: '拙い祈りが織りなす波', // 实现
        translation: '笨拙的祈愿交织而成汹涌的巨浪', // 实现
        romaji: 'tsu ta na i i no ri ga o ri na su na mi', // 实现
        words: [
          { start: 98.981, end: 99.565, text: '拙', romaji: '' },
          { start: 99.565, end: 99.837, text: 'い', romaji: '' },
        ],
        romajiWords: [ // 实现
          { text: 'tsu ', start: 98.981, end: 99.033 }, // 实现
          { text: 'ta ', start: 99.033, end: 99.521 }, // 实现
        ],
      }),
    ];

    const result = convertLyricsToAmlLines(rows, true, true);

    expect(result[0]?.romanLyric).toBe('tsu ta na i i no ri ga o ri na su na mi');
    expect(result[0]?.romajiWords).toEqual([
      { text: 'tsu ', startTime: 98981, endTime: 99033 }, // 实现
      { text: 'ta ', startTime: 99033, endTime: 99521 }, // 实现
    ]);
  });

  it('每个主词都带罗马音时优先词级 ruby，行级 romajiWords 在场也不影响', () => {
    const rows = [
      displayRow({
        time: 54.353, // 实现
        endTime: 59.487, // 实现
        text: '本当の世界で笑えるか?', // 实现
        translation: '在现实世界里还能够展颜欢笑吗', // 实现
        romaji: 'ho n to u no se ka i de wa ra e ru ka', // 实现
        words: [
          { start: 54.664, end: 54.944, text: '本', romaji: 'ho n ' },
          { start: 54.944, end: 54.981, text: '当', romaji: 'to u ' },
          { start: 54.981, end: 55.597, text: 'の', romaji: 'no ' },
        ],
        romajiWords: [ // 实现
          { text: 'ho ', start: 54.353, end: 54.508 }, // 实现
          { text: 'n ', start: 54.508, end: 54.663 }, // 实现
          { text: 'to ', start: 54.664, end: 54.803 }, // 实现
        ],
      }),
    ];

    const result = convertLyricsToAmlLines(rows, true, true);

    expect(result[0]?.romanLyric).toBe('');
    expect(result[0]?.words.map((word) => word.romanWord)).toEqual(['ho n ', 'to u ', 'no ']);
  });

  it('相邻 ruby 罗马音片段之间会插入不可见分隔符', () => {
    const glue = '\u00a0';
    const rows = [
      displayRow({
        time: 54.353, // 实现
        endTime: 59.487, // 实现
        text: '本当の世界で笑えるか?', // 实现
        translation: '在现实世界里还能够展颜欢笑吗', // 实现
        romaji: 'ho n to u no se ka i de wa ra e ru ka', // 实现
        words: [
          { start: 54.664, end: 54.944, text: '本', romaji: 'ho n' },
          { start: 54.944, end: 54.981, text: '当', romaji: 'to u' },
          { start: 54.981, end: 55.597, text: 'の', romaji: 'no' },
          { start: 55.597, end: 56.024, text: '世', romaji: 'se' },
          { start: 56.024, end: 56.514, text: '界', romaji: 'ka i' },
          { start: 56.514, end: 56.932, text: 'で', romaji: 'de' },
          { start: 56.932, end: 57.538, text: '笑', romaji: 'wa ra' },
          { start: 57.538, end: 58.094, text: 'え', romaji: 'e' },
          { start: 58.094, end: 58.703, text: 'る', romaji: 'ru' },
          { start: 58.703, end: 59.104, text: 'か', romaji: 'ka' },
          { start: 59.104, end: 59.487, text: '?', romaji: '?' },
        ],
      }),
    ];

    const result = convertLyricsToAmlLines(rows, true, true);

    expect(result[0]?.romanLyric).toBe('');
    expect(result[0]?.words.map((word) => word.romanWord)).toEqual([
      `ho n${glue}`,
      `to u${glue}`,
      `no${glue}`,
      `se${glue}`,
      `ka i${glue}`,
      `de${glue}`,
      `wa ra${glue}`,
      `e${glue}`,
      `ru${glue}`,
      `ka${glue}`,
      '?',
    ]);
  });

  it('任一主词缺罗马音时，整体退回行级罗马音文本', () => {
    const rows = [
      displayRow({
        time: 12.651, // 实现
        endTime: 18.056, // 实现
        text: 'か弱い光が指差す先', // 实现
        translation: '追寻着那道微弱光线所指的方向', // 实现
        romaji: 'ka yo wa i hi ka ri ga yu bi sa su sa ki', // 实现
        words: [
          { start: 12.651, end: 12.884, text: 'か', romaji: 'ka' },
          { start: 12.884, end: 13.476, text: '弱', romaji: 'yo wa' },
          { start: 13.476, end: 13.678, text: 'い', romaji: '' },
        ],
      }),
    ];

    const result = convertLyricsToAmlLines(rows, true, true);

    expect(result[0]?.romanLyric).toBe('ka yo wa i hi ka ri ga yu bi sa su sa ki');
    expect(result[0]?.words.map((word) => word.romanWord || '')).toEqual(['', '', '']);
  });

  it('标记为罗马化音译的行无视「显示罗马音」开关，强制渲染罗马音子行', () => {
    const shown = semanticRow({
      startMs: 43802, endMs: 46596,
      mainText: '闻说你时常在下午', romanText: 'man sv nei si soeng zoi',
      isRomanized: true,
      confidence: 'heuristic',
    });

    const romanized = semanticLineToLyricLine(shown);
    expect(romanized.isRomanized).toBe(true);

    // 未开启「显示罗马音」也应渲染 romanLyric（中文大字 + 粤拼小字）
    const amlLines = convertLyricsToAmlLines([romanized], true, false);
    expect(amlLines[0]?.romanLyric).toBe('man sv nei si soeng zoi');

    const displayLines = getCurrentLyricDisplayLines(romanized, true, false);
    expect(displayLines.map((line) => line.kind)).toEqual(['main', 'romaji']);
    expect(displayLines[1]?.text).toBe('man sv nei si soeng zoi');
  });

  it('普通行在开关关闭时仍隐藏罗马音子行', () => {
    const shown = semanticRow({
      startMs: 1000, endMs: 3000,
      mainText: '普通歌词', romanText: 'pu tong ge ci',
      confidence: 'heuristic',
    });

    const ordinary = semanticLineToLyricLine(shown);
    const amlLines = convertLyricsToAmlLines([ordinary], true, false);
    expect(amlLines[0]?.romanLyric).toBe('');

    const displayLines = getCurrentLyricDisplayLines(ordinary, true, false);
    expect(displayLines.map((line) => line.kind)).toEqual(['main']);
  });

  it('数字主词同样参与词级罗马音模式，纯符号词留空', () => {
    const glue = '\u00a0';
    const rows = [
      displayRow({
        time: 25.014, // 实现
        endTime: 30.71,
        text: '6/8のリズム 掻き乱される', // 实现
        translation: '八六原本平和的旋律开始被打乱', // 实现
        romaji: 'ha chi ro ku no ri zu mu ka ki mi da sa re ru', // 实现
        words: [
          { start: 25.014, end: 25.654, text: '6', romaji: 'ha chi' },
          { start: 25.654, end: 25.654, text: '/', romaji: '' },
          { start: 25.654, end: 26.056, text: '8', romaji: 'ro ku' },
          { start: 26.056, end: 26.459, text: 'の', romaji: 'no' },
          { start: 26.459, end: 26.471, text: 'リ', romaji: 'ri' },
          { start: 26.471, end: 26.799, text: 'ズ', romaji: 'zu' },
          { start: 26.799, end: 27.199, text: 'ム', romaji: 'mu' },
          { start: 27.199, end: 27.199, text: ' ', romaji: '' },
          { start: 27.199, end: 27.551, text: '掻', romaji: 'ka' },
          { start: 27.551, end: 27.572, text: 'き', romaji: 'ki' },
          { start: 27.572, end: 29.186, text: '乱', romaji: 'mi da' },
          { start: 29.186, end: 29.45, text: 'さ', romaji: 'sa' },
          { start: 29.45, end: 29.921, text: 'れ', romaji: 're' },
          { start: 29.921, end: 30.428, text: 'る', romaji: 'ru' },
        ],
      }),
    ];

    const result = convertLyricsToAmlLines(rows, true, true);

    expect(result[0]?.romanLyric).toBe('');
    expect(result[0]?.words.map((word) => word.romanWord || '')).toEqual([
      `ha chi${glue}`,
      '',
      `ro ku${glue}`,
      `no${glue}`,
      `ri${glue}`,
      `zu${glue}`,
      `mu${glue}`,
      '',
      `ka${glue}`,
      `ki${glue}`,
      `mi da${glue}`,
      `sa${glue}`,
      `re${glue}`,
      'ru',
    ]);
  });

  it('语义行 → 展示行 → 播放器行全程保留词级罗马音（Avid LRC 样例）', () => {
    const row = semanticRow({
      startMs: 44915, endMs: 51121,
      mainText: 'あの日なくした Avidity', romanText: 'a no hi na ku shi ta Avidity',
      translationText: '还有那一日我所遗失的热忱',
      mainWords: [ // 实现
        { startMs: 44915, endMs: 45077, text: 'あ', romanText: 'a' },
        { startMs: 45077, endMs: 45349, text: 'の', romanText: 'no' },
        { startMs: 45349, endMs: 45379, text: '日', romanText: 'hi' },
        { startMs: 45379, endMs: 45672, text: 'な', romanText: 'na' },
        { startMs: 45672, endMs: 45993, text: 'く', romanText: 'ku' },
        { startMs: 45993, endMs: 46601, text: 'し', romanText: 'shi' },
        { startMs: 46601, endMs: 47769, text: 'た', romanText: 'ta' },
        { startMs: 47769, endMs: 47769, text: ' ', romanText: '' },
        { startMs: 47769, endMs: 51121, text: 'Avidity', romanText: 'Avidity' },
      ],
      romanWords: [ // 实现
        { text: 'a', startMs: 44915, endMs: 45076 }, // 实现
        { text: 'no', startMs: 45076, endMs: 45348 }, // 实现
        { text: 'hi', startMs: 45348, endMs: 45378 }, // 实现
        { text: 'na', startMs: 45378, endMs: 45671 }, // 实现
        { text: 'ku', startMs: 45671, endMs: 45992 }, // 实现
        { text: 'shi', startMs: 45992, endMs: 46600 }, // 实现
        { text: 'ta', startMs: 46600, endMs: 47767 }, // 实现
        { text: 'Avidity', startMs: 47768, endMs: 51120 }, // 实现
      ],
    });

    const shown = semanticLineToLyricLine(row);

    expect(shown.words).toHaveLength(9);
    expect(shown.words!.map((word) => ({ romaji: word.romaji, text: word.text }))).toEqual([
      { romaji: 'a', text: 'あ' },
      { romaji: 'no', text: 'の' },
      { romaji: 'hi', text: '日' },
      { romaji: 'na', text: 'な' },
      { romaji: 'ku', text: 'く' },
      { romaji: 'shi', text: 'し' },
      { romaji: 'ta', text: 'た' },
      { romaji: '', text: ' ' },
      { romaji: 'Avidity', text: 'Avidity' },
    ]);

    const result = convertLyricsToAmlLines([shown], true, true);
    expect(result).toHaveLength(1);

    const amlRow = result[0]!;
    expect(amlRow.romanLyric).toBe('');
    expect(amlRow.words.map((word) => ({
      romanWord: stripRubyGlue(word.romanWord),
      word: word.word,
    }))).toEqual([
      { romanWord: 'a', word: 'あ' },
      { romanWord: 'no', word: 'の' },
      { romanWord: 'hi', word: '日' },
      { romanWord: 'na', word: 'な' },
      { romanWord: 'ku', word: 'く' },
      { romanWord: 'shi', word: 'し' },
      { romanWord: 'ta', word: 'た' },
      { romanWord: '', word: ' ' },
      { romanWord: 'Avidity', word: 'Avidity' },
    ]);
  });

  it('主词 romanText 为空时，通过时间重叠对齐回填罗马音', () => {
    const row = semanticRow({
      startMs: 44915, endMs: 51121,
      mainText: 'あの日なくした Avidity', romanText: 'a no hi na ku shi ta Avidity',
      translationText: '还有那一日我所遗失的热忱',
      mainWords: [ // 实现
        { startMs: 44915, endMs: 45077, text: 'あ', romanText: 'a' },
        { startMs: 45077, endMs: 45349, text: 'の', romanText: 'no' },
        { startMs: 45349, endMs: 45379, text: '日', romanText: 'hi' },
        { startMs: 45379, endMs: 45672, text: 'な', romanText: 'na' },
        { startMs: 45672, endMs: 45993, text: 'く', romanText: 'ku' },
        { startMs: 45993, endMs: 46601, text: 'し', romanText: 'shi' },
        { startMs: 46601, endMs: 47769, text: 'た', romanText: 'ta' },
        { startMs: 47769, endMs: 47769, text: ' ' },
        { startMs: 47769, endMs: 51121, text: 'Avidity' },
      ],
      romanWords: [ // 实现
        { text: 'a', startMs: 44915, endMs: 45076 }, // 实现
        { text: 'no', startMs: 45076, endMs: 45348 }, // 实现
        { text: 'hi', startMs: 45348, endMs: 45378 }, // 实现
        { text: 'na', startMs: 45378, endMs: 45671 }, // 实现
        { text: 'ku', startMs: 45671, endMs: 45992 }, // 实现
        { text: 'shi', startMs: 45992, endMs: 46600 }, // 实现
        { text: 'ta', startMs: 46600, endMs: 47767 }, // 实现
        { text: 'Avidity', startMs: 47768, endMs: 51120 }, // 实现
      ],
    });

    const shown = semanticLineToLyricLine(row);
    expect(shown.words![8]!.romaji).toBe('Avidity');
    expect(shown.words![7]!.romaji).toBe('');

    const result = convertLyricsToAmlLines([shown], true, true);
    expect(result[0]!.romanLyric).toBe('');
    expect(result[0]!.words[8]!.romanWord).toBe('Avidity');
    expect(result[0]!.words[7]!.word).toBe(' ');
  });

  it('当前行展示时，罗马音副行使用独立的逐词时间轴', () => {
    const shown = getCurrentLyricDisplayLines(displayRow({
      time: 98.981, // 实现
      endTime: 104.179, // 实现
      text: '拙い祈りが織りなす波', // 实现
      translation: '笨拙的祈愿交织而成汹涌的巨浪', // 实现
      romaji: 'tsu ta na i', // 实现
      words: [
        { start: 98.981, end: 99.565, text: '拙', romaji: '' },
      ],
      romajiWords: [ // 实现
        { text: 'tsu ', start: 98.981, end: 99.033 }, // 实现
        { text: 'ta ', start: 99.033, end: 99.521 }, // 实现
      ],
    }), true, true);

    expect(shown[1]?.kind).toBe('romaji');
    expect(shown[1]?.words).toEqual([
      { text: 'tsu ', start: 98.981, end: 99.033 }, // 实现
      { text: 'ta ', start: 99.033, end: 99.521 }, // 实现
    ]);
  });
});
