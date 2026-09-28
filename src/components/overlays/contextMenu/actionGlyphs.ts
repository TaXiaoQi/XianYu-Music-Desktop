import type { GlyphShape } from './songMenuPlan';

// Folder / Playlist 菜单共用的描边图形数据（视觉与旧版 svg 一致：
// 24 画布、2 倍描边、圆头折角；播放为 20 画布实心圆内三角）。
export const glyphRoundPlay: GlyphShape = {
  solid: true,
  canvas: '0 0 20 20',
  strokes: [
    {
      d: 'M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z',
      evenOdd: true,
    },
  ],
};

export const glyphPlusCross: GlyphShape = { canvas: '0 0 24 24', edge: '2', strokes: ['M12 4v16m8-8H4'] };

export const glyphFolderCreate: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: ['M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z'],
};

export const glyphPlusCircle: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: ['M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z'],
};

export const glyphFolderOpen: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: ['M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z'],
};

export const glyphRescan: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: ['M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'],
};

export const glyphTrashEject: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: ['M4 7h16M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12'],
};

export const glyphTrashLid: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: ['M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'],
};

export const glyphTrashLidLines: GlyphShape = {
  canvas: '0 0 24 24',
  edge: '2',
  strokes: [
    'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    'M10 11v6m4-6v6',
  ],
};
