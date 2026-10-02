import { describe, it, expect, vi } from 'vitest';

import type { LyricWord } from './lyrics';

// 歌词模块链上的 state 会在导入期读取 localStorage，先垫空桩再加载。
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });

const lyrics = await import('./lyrics') as typeof import('./lyrics');

/* ==================== 造数工具 ==================== */

/** 造一个秒制词（缺省无罗马音）。 */
function wordAt(text: string, start: number, end: number, romaji = ''): LyricWord {
  return { text, start, end, romaji };
}

/** mergePreparedLines 入参行的形状。 */
interface MergeRowInput {
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
  romaji?: string;
  words?: LyricWord[];
  sourceIndex: number;
}

/** 未提供 words 时，用整行文本造一个覆盖行区间的词。 */
function mergeRow(input: MergeRowInput) {
  const coveringWord = wordAt(input.text, input.startMs / 1000, input.endMs / 1000);
  return { translation: '', romaji: '', words: [coveringWord], ...input };
}

/* ==================== 歌词样例常量（行为规格，字面值不可改） ==================== */

const ESLRC_VALID = '[00:07.310]A[00:07.520]B[00:07.780]C[00:07.890]D[00:08.450]E[00:08.650]';
const ESLRC_WITH_GAPS = '[00:07.545]A[00:07.721][00:07.722]B[00:07.852][00:07.853]C[00:08.022]';
const ESLRC_GAPS_PADDED = '[00:07.545]A[00:07.721]\u2063[00:07.722]B[00:07.852]\u2063[00:07.853]C[00:08.022]';
const ENHANCED_STANDARD = '[00:36.111]<00:36.111>A<00:36.551>B<00:36.991>C<00:37.421>';
const ENHANCED_LEAD_OFFSET = '[00:36.000]<00:36.111>Lead<00:36.551>In<00:36.991>';
const ENHANCED_RELATIVE_WORDS = '[00:23.59]<00:00.16>塞<00:00.21>纳<00:00.32>畔';
const ENHANCED_NO_TRAILING_END = '[00:23.59]<00:23.75>塞<00:23.80>纳<00:24.61>啡';
const ENHANCED_PUNCTUATED =
  `[00:19.960]<00:19.960>Composer:<00:21.292> Yang<00:22.624>${'\uFF1A'}<00:23.956> OK<00:25.288>!<00:26.620>`;
const ENHANCED_ZERO_LENGTH = '[00:00.000]<00:00.000>ma<00:00.100><00:00.101>ga<00:00.200><00:00.201>shi<00:00.300>';
const ENHANCED_BACKWARD_TS =
  '[01:20.847]<01:20.847>「<01:21.063>sha shi <01:21.255>n <01:21.439>wa <01:21.615>ni ga <01:21.964>te <01:22.143>na <01:22.239>n <01:22.335><01:22.336>da <01:22.783><01:22.782>」<01:22.783>';
const ENHANCED_GOOD_LINE = '[00:36.111]<00:36.111>A<00:36.551>B<00:36.991>';
const ENHANCED_BROKEN_LINE = '[00:40.000]<00:40.000>Broken<00:40.500>Line';
const ENHANCED_DOC = [ENHANCED_GOOD_LINE, ENHANCED_BROKEN_LINE, '[00:41.000]plain line'].join('\n');
const ENHANCED_MERGE_SOURCE = '[00:10.000]<00:10.000>A<00:10.500>B<00:11.000>';

const XUSONG_INLINE_TS = [
  '[00:00.000]如[00:00.375]果[00:00.750]当[00:01.125]时[00:01.500] [00:01.875]-[00:02.250] [00:02.625]许[00:03.000]嵩[00:03.375]',
  '[00:03.380]词[00:04.227]：[00:05.074]许[00:05.921]嵩[00:06.768]',
].join('\n');

const XUSONG_PLAIN = [
  '[00:00.000]如果当时 - 许嵩',
  '[00:03.380]词：许嵩',
  '[00:06.770]曲：许嵩',
  '[00:10.150]编曲：许嵩',
].join('\n');

const XUSONG_ENHANCED =
  '[00:00.000]<00:00.000>如<00:00.375>果<00:00.750>当<00:01.125>时<00:01.500> <00:01.875>-<00:02.250> <00:02.625>许<00:03.000>嵩<00:03.375>';

const BILINGUAL_EN_FIRST = [
  "[00:14.727]You know you love me I know you care",
  '[00:14.727]你知道你爱我 我知道你在意',
  "[00:18.389]Just shout whenever and I'll be there",
  '[00:18.389]你只要呼唤我 我就会马上出现',
].join('\n');

const BILINGUAL_CN_FIRST = [
  '[00:21.680]你是我的爱',
  '[00:21.680]You are my love',
].join('\n');

const ENHANCED_WITH_CN_TRANSLATION = [
  '[00:14.727]<00:14.727>You <00:14.896>know <00:15.071>you <00:15.248>love <00:15.576>me <00:16.016><00:16.592>I <00:16.784>know <00:16.992>you <00:17.159>care<00:18.014>',
  '[00:14.727]<00:14.727>你知道你爱我 我知道你在意<00:18.380>',
].join('\n');

const JAPANESE_RAW_GROUP = [
  '[00:43.792]mo u hi to tsu fu ya shi ma sho u ',
  '[00:43.792]もう一つ増やしましょう',
  '[00:43.792]但让我们再多加一个吧',
  '[00:52.399]wa su re ta ku na i ko to ',
  '[00:52.399]忘れたくないこと',
  '[00:52.399]我不愿遗忘',
].join('\n');

const JAPANESE_ENHANCED_GROUP = [
  '[01:01.072]<01:01.072>wa <01:01.336>su <01:01.633>re <01:01.863>ta <01:02.103>ku <01:02.352>na <01:02.577>i <01:02.823>ko <01:03.159>to <01:03.553>',
  '[01:01.072]<01:01.072>忘<01:01.633>れ<01:01.863>た<01:02.103>く<01:02.352>な<01:02.577>い<01:02.823>こ<01:03.159>と<01:03.553>',
  '[01:01.072]<01:01.072>我不愿遗忘<01:03.790>',
].join('\n');

const KANA_KANJI_GROUP = [
  '[00:00.624]<00:00.624>ki mi  <00:01.040>ga  <00:01.347>bo ku  <00:02.384>ni  <00:02.945>mi  <00:03.336>se  <00:03.656>te  <00:04.024>ku  <00:04.560>re  <00:05.042>ta <00:05.905>',
  '[00:00.624]<00:00.624>君<00:01.040>が<00:01.347>僕<00:02.384>に<00:02.945>見<00:03.336>せ<00:03.656>て<00:04.024>く<00:04.560>れ<00:05.042>た<00:05.905>',
  '[00:00.624]<00:00.624>是你让我看到了<00:05.905>',
  '[00:05.905]<00:05.905>se ka  <00:06.122>i  <00:06.505>wa  <00:07.000>to  <00:07.272>te  <00:07.600>mo  <00:07.943>ki re  <00:08.559>i  <00:09.311>da  <00:09.587>tsu  <00:09.863>ta  <00:10.367>na <00:11.371>',
  '[00:05.905]<00:05.905>世<00:06.122>界<00:06.505>は<00:07.000>と<00:07.272>て<00:07.600>も<00:07.943>綺<00:08.559>麗<00:09.311>だ<00:09.587>っ<00:09.863>た<00:10.367>な<00:11.371>',
  '[00:05.905]<00:05.905>世界有多么美丽<00:11.371>',
].join('\n');

const ENGLISH_PREFIXED_JP = [
  '[00:18.924]<00:18.924>Silent <00:19.467><00:19.468>haze <00:19.679>ka <00:20.231>su <00:20.269><00:20.270>mi <00:20.606>ga <00:20.989>chi <00:21.041><00:21.042>ni <00:21.411><00:21.412>to <00:21.923>ra <00:22.117><00:22.118>e <00:22.638>ru <00:23.149>ka <00:23.596><00:23.597>ge <00:24.213>',
  '[00:18.924]<00:18.924>Silent <00:19.468>haze <00:19.679>霞<00:20.270>み<00:20.606>が<00:20.990>ち<00:21.043>に<00:21.412>捉<00:22.118>え<00:22.638>る<00:23.150>影<00:24.214>',
  '[00:18.924]<00:18.924>静谧薄雾中捕捉到那朦胧的身影<00:25.010>',
].join('\n');

const NUMERIC_PREFIXED_JP = [
  '[00:25.014]<00:25.014>ha <00:25.260><00:25.653>chi <00:25.653>ro <00:25.725><00:25.726>ku <00:26.055>no <00:26.457><00:26.458>ri <00:26.470><00:26.471>zu <00:26.798>mu <00:27.197><00:27.198><00:27.198>ka <00:27.550><00:27.551>ki <00:27.571><00:27.572>mi <00:28.073>da <00:29.185><00:29.186>sa <00:29.449><00:29.450>re <00:29.920>ru <00:30.426>',
  '[00:25.014]<00:25.014>6<00:25.654>/<00:25.654>8<00:26.056>の<00:26.459>リ<00:26.471>ズ<00:26.799>ム<00:27.199> <00:27.199>掻<00:27.551>き<00:27.572>乱<00:29.186>さ<00:29.450>れ<00:29.921>る<00:30.428>',
  '[00:25.014]<00:25.014>八六原本平和的旋律开始被打乱<00:30.710>',
].join('\n');

const MULTI_SYLLABLE_ROMAJI = [
  '[01:06.435]<01:06.435>a <01:06.534><01:06.535>o <01:06.718><01:06.719>i <01:06.934>da <01:07.206><01:07.207>so <01:07.535>ra <01:08.127>ga <01:09.118><01:09.119>i <01:09.582><01:09.583>ro <01:10.166>wo <01:10.765><01:10.766>ka <01:11.039><01:11.040>e <01:11.247>ru <01:11.446>ka <01:11.852><01:11.853>ra <01:12.159>',
  '[01:06.435]<01:06.435>仰<01:06.719>い<01:06.935>だ<01:07.207>空<01:08.128>が<01:09.119>色<01:10.167>を<01:10.767>変<01:11.040>え<01:11.247>る<01:11.447>か<01:11.854>ら<01:12.160>',
  '[01:06.435]<01:06.435>仰望的天空终将不复昔日色彩<01:12.570>',
].join('\n');

const PARTIAL_ROMAJI_JP = [
  '[00:12.651]<00:12.651>ka <00:12.884>yo <00:13.267>wa <00:13.476>i <00:13.678>hi <00:14.126>ka <00:14.543>ri <00:18.056>',
  '[00:12.651]<00:12.651>か<00:12.884>弱<00:13.476>い<00:13.678>光<00:14.553>が<00:14.897>指<00:15.616>差<00:16.936>す<00:17.007>先<00:18.056>',
  '[00:12.651]<00:12.651>追寻着那道微弱光线所指的方向<00:18.920>',
].join('\n');

const ACCENTED_LATIN = [
  '[01:06.009]On ira à la foire',
  '[01:06.009]我们将一起前往那欢乐的圣地',
].join('\n');

const SLASH_NOISY_SOURCE = `
[00:01.00] //
[00:02.00] // 独坐在茫茫人海中
[00:04.00] 听着耳边的风吹过 //
[00:06.00] //
[00:08.00] 悄悄地下起了小雨
`;

/* ==================== 共用断言辅助 ==================== */

/** 原始歌词文本 → 展示行全流程。 */
async function rawToShownLines(raw: string) {
  const parsed = await lyrics.prepareParsedLyrics(raw);
  return lyrics.buildSemanticLines(parsed).map(lyrics.semanticLineToLyricLine);
}

/** 归并连续空白，便于比较罗马音文本。 */
function flattenBlanks(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

describe('ESLRC 源文本预处理（normalizeEslrcSource）', () => {
  it('合法的行内时间戳序列原样通过', () => {
    expect(lyrics.normalizeEslrcSource(ESLRC_VALID)).toBe(ESLRC_VALID);
  });

  it('相邻时间戳之间的空档会垫上不可见占位词', () => {
    expect(lyrics.normalizeEslrcSource(ESLRC_WITH_GAPS)).toBe(ESLRC_GAPS_PADDED);
  });
});

describe('歌词字体预设名归一化（normalizeLyricsFontPreset）', () => {
  it('自定义系统字体名原样保留', () => {
    expect(lyrics.normalizeLyricsFontPreset('Maple Mono NF CN')).toBe('Maple Mono NF CN');
  });

  it('空白值回退到 system 预设', () => {
    expect(lyrics.normalizeLyricsFontPreset('   ')).toBe('system');
  });
});

describe('增强型 LRC 行解析', () => {
  it('把 m:ss.mmm 时间戳换算成毫秒，非法输入返回 null', () => {
    expect(lyrics.parseTimestampToMs('00:36.111')).toBe(36111);
    expect(lyrics.parseTimestampToMs('01:02.3')).toBe(62300);
    expect(lyrics.parseTimestampToMs('bad')).toBeNull();
  });

  it('只有带尖括号词级时间戳的行才算增强 LRC', () => {
    expect(lyrics.isEnhancedLrcLine('[00:36.111]<00:36.111>A<00:36.551>B<00:37.111>')).toBe(true);
    expect(lyrics.isEnhancedLrcLine('[00:36.111]plain line')).toBe(false);
    expect(lyrics.isEnhancedLrcLine('[ar:Artist]')).toBe(false);
  });

  it('标准增强 LRC 行拆出逐词时间轴', () => {
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_STANDARD);

    expect(parsed).not.toBeNull(); // 实现
    expect(parsed?.startTime).toBe(36111); // 实现
    expect(parsed?.endTime).toBe(37421); // 实现
    expect(parsed?.words.map((word) => ({ start: word.startTime, end: word.endTime, text: word.word }))).toEqual([
      { start: 36111, end: 36551, text: 'A' },
      { start: 36551, end: 36991, text: 'B' },
      { start: 36991, end: 37421, text: 'C' },
    ]);
  });

  it('行起点与首词时间允许不一致', () => {
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_LEAD_OFFSET);

    expect(parsed).not.toBeNull(); // 实现
    expect(parsed?.startTime).toBe(36000); // 实现
    expect(parsed?.words[0].startTime).toBe(36111); // 实现
    expect(parsed?.endTime).toBe(36991); // 实现
  });

  it('lrc-a2 的相对逐字时间会加回行起点', () => {
    // 词时间写作行首偏移量，直接使用会导致整行塌缩到 0。
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_RELATIVE_WORDS);

    expect(parsed).not.toBeNull(); // 实现
    expect(parsed?.startTime).toBe(23590);
    expect(parsed?.words.map((word) => ({ start: word.startTime, text: word.word }))).toEqual([
      { start: 23590 + 160, text: '塞' },
      { start: 23590 + 210, text: '纳' },
      { start: 23590 + 320, text: '畔' },
    ]);
  });

  it('末尾没有结束标记时最后一个词不丢失（kw/wy 风格）', () => {
    // 末 marker 之后还有文本时必须收进最后一个词。
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_NO_TRAILING_END);

    expect(parsed).not.toBeNull(); // 实现
    const words = parsed?.words ?? [];
    expect(words[words.length - 1]).toMatchObject({ word: '啡', startTime: 24610 });
  });

  it('词文本内部允许空格与标点', () => {
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_PUNCTUATED);

    expect(parsed).not.toBeNull(); // 实现
    expect(parsed?.words.map((word) => word.word)).toEqual([ // 实现
      'Composer:', // 实现
      ' Yang',
      '\uFF1A',
      ' OK',
      '!',
    ]);
  });

  it('连续词级时间戳产生的零长度片段会被跳过', () => {
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_ZERO_LENGTH);

    expect(parsed).not.toBeNull(); // 实现
    expect(parsed?.words.map((word) => ({ end: word.endTime, start: word.startTime, text: word.word }))).toEqual([
      { end: 100, start: 0, text: 'ma' },
      { end: 200, start: 101, text: 'ga' },
      { end: 300, start: 201, text: 'shi' },
    ]);
  });

  it('跳过的空片段允许出现几毫秒的回退时间戳', () => {
    const parsed = lyrics.parseEnhancedLrcLine(ENHANCED_BACKWARD_TS);

    expect(parsed).not.toBeNull(); // 实现
    expect(parsed?.words.map((word) => word.word)).toEqual([ // 实现
      '「',
      'sha shi ',
      'n ',
      'wa ',
      'ni ga ',
      'te ',
      'na ',
      'n ',
      'da ',
      '」',
    ]);
  });

  it('畸形增强行被丢弃，同文档中的合法行保留', () => {
    const parsed = lyrics.parseEnhancedLrc(ENHANCED_DOC);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].startTime).toBe(36111); // 实现
    expect(parsed[1].startTime).toBe(40000);
    expect(parsed[1].words.map((word) => word.word)).toEqual(['Broken', 'Line']);
  });

  it('增强行按起始时间并入基础行，未解析的占位基础行被替换', () => {
    const enhancedLines = lyrics.parseEnhancedLrc(ENHANCED_MERGE_SOURCE);
    const baseLines = [ // 实现
      {
        words: [{ word: '<00:10.000>A<00:10.500>B<00:11.000>', romanWord: '', startTime: 10000, endTime: 11000 }],
        translatedLyric: '', romanLyric: '', isBG: false, isDuet: false, startTime: 10000, endTime: 11000,
      },
      {
        words: [{ word: 'Plain line', romanWord: '', startTime: 12000, endTime: 13000 }],
        translatedLyric: '', romanLyric: '', isBG: false, isDuet: false, startTime: 12000, endTime: 13000,
      },
    ];

    const merged = lyrics.mergeEnhancedLinesIntoBaseLines(enhancedLines, baseLines);

    expect(merged).toHaveLength(2); // 实现
    expect(merged[0].words.map((word) => word.word)).toEqual(['A', 'B']); // 实现
    expect(merged[1].words[0]?.word).toBe('Plain line'); // 实现
  });
});

describe('备用行的合并与角色判定（mergePreparedLines）', () => {
  it('双语同刻行组里更早的源行当主行', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 35308, endMs: 45395, text: 'I sit by myself talking to the moon', sourceIndex: 0 }),
      mergeRow({ startMs: 35308, endMs: 45390, text: '我独自坐着 向皎洁的月亮倾诉心声', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('I sit by myself talking to the moon'); // 实现
    expect(merged[0].translation).toBe('我独自坐着 向皎洁的月亮倾诉心声');
  });

  it('显式带翻译的行仍优先作为主行载体', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 1000, endMs: 3000, text: 'Main', translation: '副行', sourceIndex: 1 }),
      mergeRow({ startMs: 1000, endMs: 2990, text: 'Alt', sourceIndex: 0 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('Main'); // 实现
    expect(merged[0].translation).toBe('副行');
  });

  it('过滤纯斜杠行并剥掉首尾的斜杠残留', async () => {
    expect(lyrics.sanitizeLineText('// 汪苏泷:')).toBe('汪苏泷:');
    expect(lyrics.sanitizeLineText('音乐设计：王皓@WONDERWALL //')).toBe('音乐设计：王皓@WONDERWALL');
    expect(lyrics.sanitizeLineText('6/8の')).toBe('6/8の');

    const lines = await lyrics.prepareParsedLyrics(SLASH_NOISY_SOURCE);

    expect(lines.map((line) => line.text)).toEqual([ // 实现
      '独坐在茫茫人海中',
      '听着耳边的风吹过',
      '悄悄地下起了小雨',
    ]);
  });

  it('日文行组按文字内容而非源顺序定角色', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 43802, endMs: 46596, text: 'so no hi ka ra na ni mo ka mo', sourceIndex: 0 }),
      mergeRow({ startMs: 43802, endMs: 46596, text: 'その日から何もかも', sourceIndex: 1 }),
      mergeRow({ startMs: 43802, endMs: 46844, text: '从那天开始似乎', sourceIndex: 2 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('その日から何もかも');
    expect(merged[0].translation).toBe('从那天开始似乎');
    expect(merged[0].romaji).toBe('so no hi ka ra na ni mo ka mo'); // 实现
    expect(merged[0].words?.[0]?.romaji).toBe('so no hi ka ra na ni mo ka mo'); // 实现
  });

  it('英中双语行组保持英文为主行，不误判成罗马音', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 24139, endMs: 26668, text: 'You are all I had', sourceIndex: 0 }),
      mergeRow({ startMs: 24139, endMs: 28900, text: '你是我拥有的一切', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('You are all I had'); // 实现
    expect(merged[0].translation).toBe('你是我拥有的一切');
    expect(merged[0].romaji).toBe(''); // 实现
  });

  it('粤拼音译行让位于中文主行，音译降为罗马音子行', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({
        startMs: 43802, endMs: 46596, text: 'man sv nei si soeng zoi ha en loi zei', sourceIndex: 0,
        words: [
          { text: 'man sv nei si soeng zoi', start: 43.802, end: 45.2, romaji: '' },
          { text: 'ha en loi zei', start: 45.2, end: 46.596, romaji: '' },
        ],
      }),
      mergeRow({
        startMs: 43802, endMs: 46596, text: '听说你时常在下午 来这里寄信件', sourceIndex: 1,
        words: [
          { text: '听说你时常在下午', start: 43.802, end: 45.2, romaji: '' },
          { text: '来这里寄信件', start: 45.2, end: 46.596, romaji: '' },
        ],
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('听说你时常在下午 来这里寄信件');
    expect(merged[0].translation).toBe('');
    expect(merged[0].romaji).toBe('man sv nei si soeng zoi ha en loi zei');
    // 逐词高亮仍对齐：主行汉字词各自拿到对应粤拼片段
    expect(merged[0].words?.map((word) => word.text)).toEqual([
      '听说你时常在下午',
      '来这里寄信件',
    ]);
    expect(merged[0].words?.map((word) => word.romaji)).toEqual([
      'man sv nei si soeng zoi',
      'ha en loi zei',
    ]);
  });

  it('英文行带体量相近的中文翻译时保持英文为主行', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 6000, endMs: 9000, text: 'Missing the feeling', sourceIndex: 0 }),
      mergeRow({ startMs: 6000, endMs: 9000, text: '缺失的感觉', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('Missing the feeling');
    expect(merged[0].translation).toBe('缺失的感觉');
    expect(merged[0].romaji).toBe('');
  });

  it('中文占优的混合行在拉丁主行旁判作翻译', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 74530, endMs: 78000, text: 'A-Z Looser-KrankheitWas IS das?', sourceIndex: 0 }),
      mergeRow({ startMs: 74530, endMs: 78000, text: 'A-Z 失败者-疾病-是什么？', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0]).toMatchObject({ // 实现
      romaji: '',
      text: 'A-Z Looser-KrankheitWas IS das?',
      translation: 'A-Z 失败者-疾病-是什么？',
    });
    expect(merged[0]?.secondary).toBeUndefined(); // 实现
  });

  it('韩文行组判作主行加中文翻译', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 12000, endMs: 15000, text: '그런 날이 있었지', sourceIndex: 0 }),
      mergeRow({ startMs: 12000, endMs: 15000, text: '那样的日子曾经存在', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('그런 날이 있었지');
    expect(merged[0].translation).toBe('那样的日子曾经存在');
    expect(merged[0].romaji).toBe(''); // 实现
  });

  it('中文行配拉丁行时拉丁当主行、中文当翻译', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 5000, endMs: 8000, text: '心里有一个梦', sourceIndex: 0 }),
      mergeRow({ startMs: 5000, endMs: 8000, text: 'xin li you yi ge meng', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('xin li you yi ge meng'); // 实现
    expect(merged[0].translation).toBe('心里有一个梦');
    expect(merged[0].romaji).toBe(''); // 实现
  });

  it('中文行配非拉丁外语行时外语当主行、中文当翻译', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 9000, endMs: 12000, text: '你是我的爱', sourceIndex: 0 }),
      mergeRow({ startMs: 9000, endMs: 12000, text: 'Я люблю тебя', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('Я люблю тебя');
    expect(merged[0].translation).toBe('你是我的爱');
    expect(merged[0].romaji).toBe(''); // 实现
  });

  it('非拉丁外语行先出现时仍保持其主行地位', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 13000, endMs: 16000, text: 'Я люблю тебя', sourceIndex: 0 }),
      mergeRow({ startMs: 13000, endMs: 16000, text: '你是我的爱', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].text).toBe('Я люблю тебя');
    expect(merged[0].translation).toBe('你是我的爱');
    expect(merged[0].romaji).toBe(''); // 实现
  });

  it('挂上翻译行的同时保留增强主词时间轴', () => {
    const merged = lyrics.mergePreparedLines([
      {
        startMs: 1000, // 实现
        endMs: 2400, // 实现
        text: 'Hello', // 实现
        translation: '', // 实现
        romaji: '',
        words: [wordAt('Hel', 1, 1.7), wordAt('lo', 1.7, 2.4)],
        sourceIndex: 0, // 实现
      },
      mergeRow({ startMs: 1000, endMs: 2400, text: '你好', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].translation).toBe('你好');
    expect(merged[0].words).toEqual([ // 实现
      { start: 1, end: 1.7, text: 'Hel', romaji: '' },
      { start: 1.7, end: 2.4, text: 'lo', romaji: '' },
    ]);
  });

  it('几毫秒的时间漂移仍可合并，超过安全上限则不并', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 1000, endMs: 2400, text: 'Main line', sourceIndex: 0 }),
      mergeRow({ startMs: 1004, endMs: 2400, text: '副行', sourceIndex: 1 }),
      mergeRow({ startMs: 5000, endMs: 6400, text: 'Next sentence', sourceIndex: 2 }),
      mergeRow({ startMs: 7000, endMs: 8200, text: 'Standalone', sourceIndex: 3 }),
      mergeRow({ startMs: 7065, endMs: 8200, text: '不应该合并', sourceIndex: 4 }),
      mergeRow({ startMs: 12000, endMs: 13200, text: 'Afterward', sourceIndex: 5 }),
    ]);

    expect(merged[0].translation).toBe('副行');
    expect(merged.map((line) => line.text)).toEqual([ // 实现
      'Main line', // 实现
      'Next sentence', // 实现
      'Standalone', // 实现
      '不应该合并',
      'Afterward', // 实现
    ]);
  });

  it('快速连发的同文字行只按时间戳边界分组', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 0, endMs: 200, text: 'one', sourceIndex: 0 }),
      mergeRow({ startMs: 40, endMs: 240, text: 'two', sourceIndex: 1 }),
      mergeRow({ startMs: 85, endMs: 260, text: 'three', sourceIndex: 2 }),
    ]);

    expect(merged.map((line) => line.text)).toEqual(['one', 'two']); // 实现
    expect(merged[0]?.secondary).toBeUndefined(); // 实现
    expect(merged[1]?.secondary).toEqual(['three']); // 实现
  });

  it('同文字行组歧义时整体退回备用行展示', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 2000, endMs: 4000, text: '我们还在这里', sourceIndex: 0 }),
      mergeRow({ startMs: 2000, endMs: 4000, text: '同步的另一行', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0].translation).toBe(''); // 实现
    expect(merged[0].romaji).toBe(''); // 实现
    expect(merged[0].secondary).toEqual(['同步的另一行']);
  });

  it('时间几乎一致的多行收进同组，溢出角色进备用行', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 10000, endMs: 13000, text: 'kimi no na wa', sourceIndex: 0 }),
      mergeRow({ startMs: 10020, endMs: 13000, text: '君の名は', sourceIndex: 1 }),
      mergeRow({ startMs: 10040, endMs: 13000, text: '你的名字', sourceIndex: 2 }),
      mergeRow({ startMs: 10050, endMs: 13000, text: '同步备用行', sourceIndex: 3 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0]).toMatchObject({ // 实现
      text: '君の名は',
      translation: '你的名字',
      romaji: 'kimi no na wa', // 实现
      secondary: ['同步备用行'],
    });
  });

  it('单独一行中文时它就是主歌词', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 10000, endMs: 13000, text: '我曾经跨过山和大海', sourceIndex: 0 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0]).toMatchObject({ // 实现
      text: '我曾经跨过山和大海',
      translation: '', // 实现
      romaji: '',
    });
  });

  it('全拉丁行组保持首行为主，其余进备用行', () => {
    const merged = lyrics.mergePreparedLines([
      mergeRow({ startMs: 10000, endMs: 13000, text: 'kimi no na wa', sourceIndex: 0 }),
      mergeRow({ startMs: 10000, endMs: 13000, text: 'boku wa mada', sourceIndex: 1 }),
    ]);

    expect(merged).toHaveLength(1); // 实现
    expect(merged[0]).toMatchObject({ // 实现
      text: 'kimi no na wa', // 实现
      translation: '', // 实现
      romaji: '',
      secondary: ['boku wa mada'], // 实现
    });
  });

  it('文字类型统计能识别谚文字符', () => {
    const profile = lyrics.getLineScriptProfile('그런 날이 있었지');

    expect(profile.hangulCount).toBeGreaterThan(0); // 实现
    expect(profile.dominantScript).toBe('hangul'); // 实现
  });

  it('副行展示顺序：罗马音在上、翻译在下', () => {
    const subtitles = lyrics.getDisplaySubtitles({
      translation: '从那天开始似乎',
      romaji: 'so no hi ka ra na ni mo ka mo', // 实现
    }, true, true); // 实现

    expect(subtitles).toEqual({ // 实现
      lower: '从那天开始似乎',
      upper: 'so no hi ka ra na ni mo ka mo', // 实现
    });
  });

  it('默认关闭罗马音时只显示翻译', () => {
    const subtitles = lyrics.getDisplaySubtitles({
      translation: '从那天开始似乎',
      romaji: 'so no hi ka ra na ni mo ka mo', // 实现
    }, true, false); // 实现

    expect(subtitles).toEqual({ // 实现
      lower: '',
      upper: '从那天开始似乎',
    });
  });

  it('副行展示时罗马音行携带逐词时间轴', () => {
    const shown = lyrics.getCurrentLyricDisplayLines({
      time: 43.802, // 实现
      endTime: 46.596, // 实现
      text: 'その日から何もかも',
      translation: '从那天开始似乎',
      romaji: 'so no hi ka ra na ni mo ka mo', // 实现
      words: [
        wordAt('その', 43.802, 44.2, 'so no '),
        wordAt('日から', 44.2, 45, 'hi ka ra '),
        wordAt('何もかも', 45, 46.596, 'na ni mo ka mo'),
      ],
    }, true, true); // 实现

    expect(shown.map((line) => line.kind)).toEqual(['main', 'romaji', 'translation']);
    expect(shown[1]?.words).toEqual([
      { start: 43.802, end: 44.2, text: 'so no ' },
      { start: 44.2, end: 45, text: 'hi ka ra ' },
      { start: 45, end: 46.596, text: 'na ni mo ka mo' },
    ]);
  });
});

describe('歌词设置归一化', () => {
  it('迁移来的播放器偏移量会被钳制到区间内', () => {
    const normalized = lyrics.normalizeLyricsSettingsPatch({
      playerOffsetX: 999, // 实现
      playerOffsetY: -999, // 实现
    });

    expect(normalized.playerOffsetX).toBe(lyrics.MAX_PLAYER_OFFSET_X);
    expect(normalized.playerOffsetY).toBe(lyrics.MIN_PLAYER_OFFSET_Y);
  });

  it('桌面全屏自动隐藏默认关闭', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenFullscreen).toBe(false); // 实现
  });

  it('桌面暂停自动隐藏默认关闭', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenPaused).toBe(false); // 实现
  });

  it('桌面双行显示默认开启', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.showDoubleLine).toBe(true); // 实现
  });

  it('桌面逐字特效默认开启', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.enableWordEffect).toBe(true); // 实现
  });

  it('从迁移值恢复桌面对角布局', () => {
    expect(lyrics.normalizeDesktopLyricsSettingsPatch({
      playerAlignment: 'split-corners', // 实现
    }).playerAlignment).toBe('split-corners'); // 实现
  });

  it('非桌面歌词的对齐只接受水平取值', () => {
    const normalized = lyrics.normalizeLyricsSettingsPatch({
      playerAlignment: 'split-corners' as any, // 实现
    });

    expect(normalized.playerAlignment).toBe('left'); // 实现
  });

  it('从迁移值恢复桌面全屏自动隐藏', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      autoHideWhenFullscreen: false, // 实现
    });

    expect(normalized.autoHideWhenFullscreen).toBe(false); // 实现
  });

  it('从持久化值恢复桌面暂停自动隐藏', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      autoHideWhenPaused: true, // 实现
    });

    expect(normalized.autoHideWhenPaused).toBe(true); // 实现
  });

  it('从迁移值恢复桌面双行显示', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      showDoubleLine: true, // 实现
    });

    expect(normalized.showDoubleLine).toBe(true); // 实现
  });

  it('从迁移值恢复桌面逐字特效', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      enableWordEffect: false, // 实现
    });

    expect(normalized.enableWordEffect).toBe(false); // 实现
  });

  it('桌面可读性默认：描边开启、两行阴影彼此独立且为 0', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.enableTextOutline).toBe(true);
    expect(normalized.textOpacity).toBe(1); // 实现
    expect(normalized.textShadowColor).toBe('#000000'); // 实现
    expect(normalized.firstLineTextShadowStrength).toBe(0); // 实现
    expect(normalized.secondLineTextShadowStrength).toBe(0); // 实现
  });

  it('从持久化值恢复桌面描边开关', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      enableTextOutline: true,
    });

    expect(normalized.enableTextOutline).toBe(true);
  });

  it('桌面可读性异常值会被清洗（透明度/颜色/阴影强度）', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      textOpacity: 2, // 实现
      textShadowColor: 'not-a-color', // 实现
      firstLineTextShadowStrength: 180, // 实现
      secondLineTextShadowStrength: -20, // 实现
    } as any);

    expect(normalized.textOpacity).toBe(1); // 实现
    expect(normalized.textShadowColor).toBe('#000000'); // 实现
    expect(normalized.firstLineTextShadowStrength).toBe(100); // 实现
    expect(normalized.secondLineTextShadowStrength).toBe(0); // 实现
  });

  it('旧版单一阴影强度字段映射到两行歌词', () => {
    const normalized = lyrics.normalizeDesktopLyricsSettingsPatch({
      textShadowStrength: 45, // 实现
    } as any);

    expect(normalized.firstLineTextShadowStrength).toBe(45); // 实现
    expect(normalized.secondLineTextShadowStrength).toBe(45); // 实现
  });
});

describe('常见格式原始歌词样例', () => {
  it('行内时间戳的中文 LRC 拆出逐词时间轴', async () => {
    const lines = await rawToShownLines(XUSONG_INLINE_TS);

    expect(lines).toHaveLength(2); // 实现
    expect(lines[0]?.text).toBe('如果当时 - 许嵩'); // 实现
    expect(lines[0]?.words?.map((word) => word.text)).toEqual([ // 实现
      '如', '果', '当', '时', ' ', '-', ' ', '许', '嵩',
    ]);
    expect(lines[0]?.translation).toBe(''); // 实现
    expect(lines[0]?.romaji).toBe(''); // 实现
  });

  it('逐行时间戳的普通 LRC 保持原有行序', async () => {
    const lines = await rawToShownLines(XUSONG_PLAIN);

    expect(lines.map((line) => line.text)).toEqual([ // 实现
      '如果当时 - 许嵩', // 实现
      '词：许嵩',
      '曲：许嵩',
      '编曲：许嵩',
    ]);
  });

  it('增强 LRC 保留逐词时间', async () => {
    const lines = await rawToShownLines(XUSONG_ENHANCED);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]?.text).toBe('如果当时 - 许嵩'); // 实现
    expect(lines[0]?.words?.map((word) => ({ end: word.end, start: word.start, text: word.text }))).toEqual([
      { end: 0.375, start: 0, text: '如' },
      { end: 0.75, start: 0.375, text: '果' },
      { end: 1.125, start: 0.75, text: '当' },
      { end: 1.5, start: 1.125, text: '时' },
      { end: 1.875, start: 1.5, text: ' ' },
      { end: 2.25, start: 1.875, text: '-' },
      { end: 2.625, start: 2.25, text: ' ' },
      { end: 3, start: 2.625, text: '许' },
      { end: 3.375, start: 3, text: '嵩' },
    ]);
  });

  it('英中双语的原始 LRC 归成主行加翻译', async () => {
    const lines = await rawToShownLines(BILINGUAL_EN_FIRST);

    expect(lines).toHaveLength(2); // 实现
    expect(lines[0]).toMatchObject({ // 实现
      text: 'You know you love me I know you care', // 实现
      translation: '你知道你爱我 我知道你在意', // 实现
      romaji: '',
    });
    expect(lines[1]).toMatchObject({ // 实现
      text: "Just shout whenever and I'll be there",
      translation: '你只要呼唤我 我就会马上出现', // 实现
      romaji: '',
    });
  });

  it('中英双语的原始 LRC 归成拉丁主行加中文翻译', async () => {
    const lines = await rawToShownLines(BILINGUAL_CN_FIRST);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]).toMatchObject({ // 实现
      text: 'You are my love', // 实现
      translation: '你是我的爱', // 实现
      romaji: '',
    });
  });

  it('显式 tr 标记的翻译行优先于罗马化启发式', async () => {
    const [heuristic] = await rawToShownLines([
      '[00:21.680]man sv nei si soeng zoi ha en loi zei',
      '[00:21.680]闻说你时常在下午 来这里寄信件',
    ].join('\n'));

    // 无显式标记时启发式把中文升为主行、粤拼降为罗马音
    expect(heuristic).toMatchObject({
      text: '闻说你时常在下午 来这里寄信件',
      romaji: 'man sv nei si soeng zoi ha en loi zei',
    });

    const [explicit] = await rawToShownLines([
      '[00:21.680]man sv nei si soeng zoi ha en loi zei',
      '[00:21.680][tr]闻说你时常在下午 来这里寄信件',
    ].join('\n'));

    // 源里显式声明为翻译时以源为准，不做交换
    expect(explicit).toMatchObject({
      text: 'man sv nei si soeng zoi ha en loi zei',
      translation: '闻说你时常在下午 来这里寄信件',
      romaji: '',
    });
  });

  it('英文增强行挂上同刻时间组的中文翻译', async () => {
    const lines = await rawToShownLines(ENHANCED_WITH_CN_TRANSLATION);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]?.text).toBe('You know you love me I know you care'); // 实现
    expect(lines[0]?.translation).toBe('你知道你爱我 我知道你在意'); // 实现
    expect(lines[0]?.words?.length).toBeGreaterThan(3); // 实现
  });

  it('日文原始 LRC 行组归出主行、罗马音与翻译', async () => {
    const lines = await rawToShownLines(JAPANESE_RAW_GROUP);

    expect(lines).toHaveLength(2); // 实现
    expect(lines[0]).toMatchObject({ // 实现
      text: 'もう一つ増やしましょう', // 实现
      romaji: 'mo u hi to tsu fu ya shi ma sho u', // 实现
      translation: '但让我们再多加一个吧', // 实现
    });
    expect(lines[1]).toMatchObject({ // 实现
      text: '忘れたくないこと', // 实现
      romaji: 'wa su re ta ku na i ko to', // 实现
      translation: '我不愿遗忘', // 实现
    });
  });

  it('日文增强行保留词级时间且展示顺序为罗马音再翻译', async () => {
    const lines = await rawToShownLines(JAPANESE_ENHANCED_GROUP);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]?.text).toBe('忘れたくないこと'); // 实现
    expect(lines[0]?.romaji).toBe('wa su re ta ku na i ko to'); // 实现
    expect(lines[0]?.translation).toBe('我不愿遗忘'); // 实现
    expect(lines[0]?.words?.map((word) => word.text)).toEqual([ // 实现
      '忘', 'れ', 'た', 'く', 'な', 'い', 'こ', 'と',
    ]);

    const shown = lyrics.getCurrentLyricDisplayLines(lines[0]!, true, true);
    expect(shown.map((line) => line.kind)).toEqual(['main', 'romaji', 'translation']);
  });

  it('假名汉字混排的日文增强行优先当主行，罗马音在前也不抢位', async () => {
    const lines = await rawToShownLines(KANA_KANJI_GROUP);

    expect(lines).toHaveLength(2); // 实现
    expect(lines[0]).toMatchObject({ // 实现
      text: '君が僕に見せてくれた', // 实现
      translation: '是你让我看到了', // 实现
    });
    expect(flattenBlanks(lines[0]?.romaji || '')).toBe('ki mi ga bo ku ni mi se te ku re ta');
    expect(lines[1]).toMatchObject({ // 实现
      text: '世界はとても綺麗だったな', // 实现
      translation: '世界有多么美丽', // 实现
    });
    expect(flattenBlanks(lines[1]?.romaji || '')).toBe('se ka i wa to te mo ki re i da tsu ta na');
    expect(lines[1]?.words?.map((word) => word.text)).toEqual([ // 实现
      '世', '界', 'は', 'と', 'て', 'も', '綺', '麗', 'だ', 'っ', 'た', 'な',
    ]);
  });

  it('英文开头的日文增强行保持主行地位，不把英文段当罗马音', async () => {
    const lines = await rawToShownLines(ENGLISH_PREFIXED_JP);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]).toMatchObject({ // 实现
      text: 'Silent haze 霞みがちに捉える影', // 实现
      translation: '静谧薄雾中捕捉到那朦胧的身影', // 实现
    });
    expect(flattenBlanks(lines[0]?.romaji || '')).toBe('Silent haze ka su mi ga chi ni to ra e ru ka ge');
    expect(lines[0]?.words?.map((word) => word.text)).toEqual([ // 实现
      'Silent ', 'haze ', '霞', 'み', 'が', 'ち', 'に', '捉', 'え', 'る', '影',
    ]);
  });

  it('数字开头的日文增强行当主行且不重复渲染罗马音', async () => {
    const lines = await rawToShownLines(NUMERIC_PREFIXED_JP);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]?.text).toBe('6/8のリズム 掻き乱される'); // 实现
    expect(flattenBlanks(lines[0]?.romaji || '')).toBe('ha chi ro ku no ri zu mu ka ki mi da sa re ru');
    expect(lines[0]?.translation).toBe('八六原本平和的旋律开始被打乱'); // 实现

    const amlLines = lyrics.convertLyricsToAmlLines(lines, true, true);
    expect(amlLines[0]?.romanLyric).toBe('ha chi ro ku no ri zu mu ka ki mi da sa re ru'); // 实现
    expect(amlLines[0]?.words.map((word) => word.word)).toEqual([ // 实现
      '6', '/', '8', 'の', 'リ', 'ズ', 'ム', ' ', '掻', 'き', '乱', 'さ', 'れ', 'る',
    ]);
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual([ // 实现
      '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    ]);
  });

  it('多个音节的罗马音碎片聚合成逐词卡拉OK时间轴', async () => {
    const lines = await rawToShownLines(MULTI_SYLLABLE_ROMAJI);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]?.words?.map((word) => flattenBlanks(word.romaji || ''))).toEqual([
      'a o', 'i', 'da', 'so ra', 'ga', 'i ro', 'wo', 'ka', 'e', 'ru', 'ka', 'ra',
    ]);

    const amlLines = lyrics.convertLyricsToAmlLines(lines, true, true);
    expect(amlLines).toHaveLength(1); // 实现
    expect(amlLines[0]?.romanLyric).toBe(''); // 实现
    expect(amlLines[0]?.words.map((word) => flattenBlanks(word.romanWord || ''))).toEqual([
      'a o', 'i', 'da', 'so ra', 'ga', 'i ro', 'wo', 'ka', 'e', 'ru', 'ka', 'ra',
    ]);
  });

  it('逐词罗马音盖不满所有日文词时退回整行罗马音', async () => {
    const lines = await rawToShownLines(PARTIAL_ROMAJI_JP);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]?.romaji).toBe('ka yo wa i hi ka ri'); // 实现
    expect(lines[0]?.words?.map((word) => flattenBlanks(word.romaji || ''))).toEqual([
      '', '', '', '', '', '', '', '', '',
    ]);

    const amlLines = lyrics.convertLyricsToAmlLines(lines, true, true);
    expect(amlLines[0]?.romanLyric).toBe('ka yo wa i hi ka ri'); // 实现
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual([ // 实现
      '', '', '', '', '', '', '', '', '',
    ]);
  });

  it('带重音符号的拉丁文当主行、中文当翻译', async () => {
    const lines = await rawToShownLines(ACCENTED_LATIN);

    expect(lines).toHaveLength(1); // 实现
    expect(lines[0]).toMatchObject({ // 实现
      text: 'On ira à la foire', // 实现
      translation: '我们将一起前往那欢乐的圣地', // 实现
      romaji: '',
    });
  });
});
