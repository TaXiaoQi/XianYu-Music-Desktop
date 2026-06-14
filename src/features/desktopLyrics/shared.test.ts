import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
  DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
  DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
  getDesktopLyricsWindowSizeLimits,
  normalizeDesktopLyricsBounds,
  restoreDesktopLyricsBounds,
  resolveDesktopLyricsWorkArea,
  snapDesktopLyricsBounds,
  type DesktopLyricsWindowBounds,
  type DesktopLyricsWorkArea,
} from './shared';

const WORK_AREAS: DesktopLyricsWorkArea[] = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: 0, width: 1280, height: 1024 },
];

describe('desktop lyrics shared helpers', () => {
  it('resolves the work area with the largest overlap', () => {
    const bounds: DesktopLyricsWindowBounds = {
      x: 1980,
      y: 40,
      width: 820,
      height: 220,
    };

    expect(resolveDesktopLyricsWorkArea(WORK_AREAS, bounds)).toEqual(WORK_AREAS[1]);
  });

  it('normalizes bounds into the active monitor limits', () => {
    const bounds: DesktopLyricsWindowBounds = {
      x: -120,
      y: -80,
      width: 2200,
      height: 60,
    };

    expect(normalizeDesktopLyricsBounds(bounds, WORK_AREAS)).toEqual({
      x: 0,
      y: 0,
      width: DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
      height: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
    });
  });

  it('restores persisted bounds without pulling partially visible windows back on screen', () => {
    const bounds: DesktopLyricsWindowBounds = {
      x: 40,
      y: 930,
      width: 900,
      height: 280,
    };

    expect(restoreDesktopLyricsBounds(bounds, WORK_AREAS)).toEqual(bounds);
  });

  it('falls back to a safe visible position when persisted bounds are fully off screen', () => {
    const bounds: DesktopLyricsWindowBounds = {
      x: -1400,
      y: 1200,
      width: 900,
      height: 280,
    };

    expect(restoreDesktopLyricsBounds(bounds, WORK_AREAS)).toEqual({
      x: 0,
      y: 800,
      width: 900,
      height: 280,
    });
  });

  it('snaps bounds to nearby screen edges', () => {
    const bounds: DesktopLyricsWindowBounds = {
      x: 14,
      y: 18,
      width: 800,
      height: 200,
    };

    expect(snapDesktopLyricsBounds(bounds, WORK_AREAS)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 200,
    });
  });

  it('creates min and max size limits from the work area', () => {
    expect(getDesktopLyricsWindowSizeLimits({ x: 0, y: 0, width: 600, height: 260 })).toEqual({
      minWidth: DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
      minHeight: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
      maxWidth: 576,
      maxHeight: 236,
    });
  });
});
