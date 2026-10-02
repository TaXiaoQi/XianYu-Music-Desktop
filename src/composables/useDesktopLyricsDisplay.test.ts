import { describe, expect, it, vi } from 'vitest'; // 实现
import { ref } from 'vue'; // 实现

import { useDesktopLyricsDisplay } from './useDesktopLyricsDisplay'; // 实现
import type { DesktopLyricsStatePayload } from '../features/desktopLyrics/shared'; // 实现

vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn() }));

// —— 夹具定义 ——

// 基础逐字行：两个英文词，覆盖 1s–5s
const ENGLISH_TIMED_LINE = {
  time: 1, endTime: 5, text: 'hello world', translation: '', romaji: '',
  words: [{ text: 'hello ', start: 1, end: 3, romaji: '' }, { text: 'world', start: 3, end: 5, romaji: '' }],
};

// 全词罗马音齐备的日文行（应启用词级罗马音）
const FULL_ROMAJI_LINE = {
  time: 12.651, endTime: 18.056, text: 'か弱い光が指差す先',
  translation: '追寻着那道微弱光线所指的方向', romaji: 'ka yo wa i hi ka ri ga yu bi sa su sa ki',
  words: [
    { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
    { text: '弱', start: 12.884, end: 13.476, romaji: 'yo wa' },
    { text: 'い', start: 13.476, end: 13.678, romaji: 'i' },
  ],
};

// 词级罗马音缺失的日文行（应回退整行罗马音副行）
const PARTIAL_ROMAJI_LINE = {
  time: 12.651, endTime: 18.056, text: 'か弱い', translation: '微弱', romaji: 'ka yo wa i',
  words: [
    { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
    { text: '弱', start: 12.884, end: 13.476, romaji: '' },
    { text: 'い', start: 13.476, end: 13.678, romaji: 'i' },
  ],
};

// 三行中文歌词，用于双行滑动窗口验证
const THREE_CN_LINES = [
  { time: 1, endTime: 3, text: '第一行', translation: '', romaji: '', words: [] },
  { time: 3, endTime: 5, text: '第二行', translation: '', romaji: '', words: [] },
  { time: 5, endTime: 7, text: '第三行', translation: '', romaji: '', words: [] },
];

// 导入字体夹具
const IMPORTED_FONT_FIXTURE: DesktopLyricsStatePayload['customLyricsFonts'][number] = {
  id: 'font-1',
  name: 'My Lyrics Font',
  family: 'XianYu Imported Lyrics Font font-1',
  filePath: 'C:\\Fonts\\my-lyrics-font.ttf',
  importedAt: 1,
  format: 'truetype',
};

// 构造一份完整状态快照：默认开启逐字特效，可用 overrides 覆盖任意顶层字段
function buildStatePayload(wordEffectOn = true, overrides: Partial<DesktopLyricsStatePayload> = {}): DesktopLyricsStatePayload {
  return {
    song: null,
    parsedLyrics: [ENGLISH_TIMED_LINE],
    lyricsStatus: 'ready', // 实现
    fallbackText: 'Instrumental / No lyrics', // 实现
    playbackTime: 2, // 实现
    syncedAt: Date.now(), // 实现
    isPlaying: false, // 实现
    isFavorite: false,
    audioDelay: 0, // 实现
    themeColors: [], // 实现
    customLyricsFonts: [], // 实现
    settings: {
      showTranslation: true, showRomaji: false, isAlwaysOnTop: false, alwaysShowShadowBackground: false,
      autoHideWhenFullscreen: true, autoHideWhenPaused: false, showDoubleLine: false, enableWordEffect: wordEffectOn,
      enableTextOutline: false, textOutlineWidth: 0.1, textOutlineColor: '#000000',
      isLocked: false, persistLock: false, centerHorizontally: false, colorScheme: 'auto',
      customPlayedColor: '#EC4141', customUnplayedColor: '#FFFFFF',
      customRomajiPlayedColor: '#BFDBFE', customRomajiUnplayedColor: '#FFFFFF',
      customRomajiColor: '#BFDBFE', customTranslationColor: '#FBCFE8',
      textOpacity: 1, textShadowColor: '#000000', firstLineTextShadowStrength: 0, secondLineTextShadowStrength: 0,
      playerFontScale: 1, playerLineGap: 1, playerOffsetX: 0, playerOffsetY: 0,
      playerAlignment: 'center', playerFontPreset: 'system',
    },
    ...overrides,
  };
}

// 在基础快照上叠加设置补丁，避免每个用例手写展开
function patchStateSettings(patch: Partial<DesktopLyricsStatePayload['settings']>, extra: Partial<DesktopLyricsStatePayload> = {}) {
  const base = buildStatePayload();
  return { ...base, ...extra, settings: { ...base.settings, ...patch } };
}

// 新建一个挂起状态干净的显示实例
function freshDisplay() {
  return useDesktopLyricsDisplay(ref(false));
}

describe('useDesktopLyricsDisplay 桌面歌词显示逻辑', () => {
  describe('播放时钟同步', () => {
    it('播放状态切换时直接采用远端投影时间', () => {
      const view = freshDisplay();

      view.playbackTime.value = 10;
      view.isPlaying.value = true;
      view.handlePlaybackPayload({ playbackTime: 9.8, syncedAt: Date.now(), isPlaying: false, audioDelay: 0 });

      expect(view.isPlaying.value).toBe(false);
      expect(view.playbackTime.value).toBe(9.8);
    });
  });

  describe('逐字歌词渲染', () => {
    it('关闭逐字特效时主行作为整块文本渲染', () => {
      const view = freshDisplay();

      view.handlePayload(buildStatePayload(false));

      expect(view.visibleLyricLines.value[0]?.line.text).toBe('hello world');
      expect(view.visibleLyricLines.value[0]?.words).toEqual([]);
    });

    // 表驱动：伪逐字切分的两类典型输入
    const pseudoCases: Array<{
      name: string;
      line: { time: number; endTime: number; text: string; translation: string; romaji: string; words: Array<{ text: string; start: number; end: number; romaji: string }> };
      expectedWords?: Array<{ text: string; start: number; end: number; romaji: string }>;
      expectedTexts?: string[];
    }> = [
      {
        name: '未标注时间戳的 CJK 行按顺序均分为伪逐字段',
        line: { time: 1, endTime: 3, text: '你我', translation: '', romaji: '', words: [] },
        expectedWords: [
          { text: '你', start: 1, end: 2, romaji: '' },
          { text: '我', start: 2, end: 3, romaji: '' },
        ],
      },
      {
        name: '伪逐字切分时保持拉丁单词完整',
        line: { time: 1, endTime: 4, text: 'into the mall', translation: '', romaji: '', words: [] },
        expectedTexts: ['into ', 'the ', 'mall'],
      },
    ];

    for (const testCase of pseudoCases) {
      it(testCase.name, () => {
        const view = freshDisplay();

        view.handlePayload(buildStatePayload(true, { parsedLyrics: [testCase.line] }));

        if (testCase.expectedWords) {
          expect(view.visibleLyricLines.value[0]?.words).toEqual(testCase.expectedWords);
        } else {
          expect(view.visibleLyricLines.value[0]?.words.map((word) => word.text)).toEqual(testCase.expectedTexts);
        }
      });
    }
  });

  describe('样式变量输出', () => {
    it('默认关闭桌面文字描边', () => {
      const view = freshDisplay();

      view.handlePayload(buildStatePayload());

      expect(view.widgetStyle.value['--desktop-text-outline-width']).toBe('0px');
    });

    it('可读性设置以 CSS 变量形式暴露', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings({
        textOpacity: 0.82, // 实现
        textShadowColor: '#112233', // 实现
        enableTextOutline: true,
        firstLineTextShadowStrength: 25, // 实现
        secondLineTextShadowStrength: 75, // 实现
      }));

      expect(view.widgetStyle.value).toMatchObject({
        '--desktop-text-opacity': '0.82',
        '--desktop-text-shadow-color': '17 34 51',
        '--desktop-text-outline-width': '0.3px',
        '--desktop-first-line-text-shadow-alpha': '0.25',
        '--desktop-first-line-text-shadow-blur': '6px',
        '--desktop-second-line-text-shadow-alpha': '0.75',
        '--desktop-second-line-text-shadow-blur': '18px',
      });
    });

    it('状态快照中的导入字体保持可选', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings(
        { playerFontPreset: 'XianYu Imported Lyrics Font font-1' },
        { customLyricsFonts: [IMPORTED_FONT_FIXTURE] },
      ));

      expect(view.availableFontOptions.value[0]).toMatchObject({
        value: 'XianYu Imported Lyrics Font font-1',
        label: 'My Lyrics Font',
        isImported: true,
      });
      expect(view.selectedFontLabel.value).toBe('My Lyrics Font');
    });

    it('自定义配色下罗马音已播/未播颜色相互独立', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings(
        { colorScheme: 'custom', customRomajiPlayedColor: '#123456', customRomajiUnplayedColor: '#ABCDEF' },
        { playbackTime: 2 },
      ));

      expect(view.widgetStyle.value).toMatchObject({
        '--desktop-romaji-played-color': 'color-mix(in srgb, #123456 calc(var(--desktop-text-opacity, 1) * 100%), transparent)',
        '--desktop-romaji-unplayed-color': 'color-mix(in srgb, #ABCDEF calc(var(--desktop-text-opacity, 1) * 100%), transparent)',
      });
    });
  });

  describe('副行与双行布局', () => {
    it('仅当全部词元携带罗马音时才启用词级罗马音', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings(
        { showRomaji: true, showTranslation: true },
        { parsedLyrics: [FULL_ROMAJI_LINE] },
      ));

      expect(view.visibleLyricLines.value[0]?.hasAlignedRomaji).toBe(true);
      expect(view.visibleLyricLines.value[0]?.secondaryLines).toEqual([
        { kind: 'translation', text: '追寻着那道微弱光线所指的方向' },
      ]);
    });

    it('词级罗马音不完整时回退为整行罗马音副行', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings(
        { showRomaji: true, showTranslation: true },
        { parsedLyrics: [PARTIAL_ROMAJI_LINE] },
      ));

      expect(view.visibleLyricLines.value[0]?.hasAlignedRomaji).toBe(false);
      expect(view.visibleLyricLines.value[0]?.secondaryLines).toEqual([
        { kind: 'romaji', text: 'ka yo wa i' },
        { kind: 'translation', text: '微弱' },
      ]);
    });

    it('双行模式按“当前行+下一行”滑动展示', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings(
        { showDoubleLine: true },
        { playbackTime: 1.2, parsedLyrics: THREE_CN_LINES },
      ));

      expect(view.visibleLyricLines.value.map((row) => row.line.text)).toEqual(['第一行', '第二行']);
      expect(view.visibleLyricLines.value.map((row) => row.active)).toEqual([true, false]);

      view.handlePlaybackPayload({ playbackTime: 3.2, syncedAt: Date.now(), isPlaying: false, audioDelay: 0 });

      expect(view.visibleLyricLines.value.map((row) => row.line.text)).toEqual(['第二行', '第三行']);
      expect(view.visibleLyricLines.value.map((row) => row.active)).toEqual([true, false]);
      expect(view.blockTransitionKey.value).toBe('double-line:ready');
    });

    it('split-corners 对齐仅在双行模式下生效', () => {
      const view = freshDisplay();

      view.handlePayload(patchStateSettings({ showDoubleLine: true, playerAlignment: 'split-corners' }));

      expect(view.lyricsAlignmentClass.value).toBe('lyrics-align-split-corners');

      view.handlePayload(patchStateSettings({ showDoubleLine: false, playerAlignment: 'split-corners' }));

      expect(view.lyricsAlignmentClass.value).toBe('lyrics-align-left');
    });
  });
});
