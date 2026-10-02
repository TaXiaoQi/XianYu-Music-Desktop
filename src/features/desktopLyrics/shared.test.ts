import { describe, expect, it } from "vitest";

import {
    DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
    DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
    DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
    getDesktopLyricsWindowSizeLimits,
    normalizeDesktopLyricsBounds,
    restoreDesktopLyricsBounds,
    resolveDesktopLyricsWorkArea,
    snapDesktopLyricsBounds,
} from "./shared";
import type {
    DesktopLyricsWindowBounds,
    DesktopLyricsWorkArea,
} from "./shared";

const PRIMARY_WORK_AREA: DesktopLyricsWorkArea = {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
};
const SECONDARY_WORK_AREA: DesktopLyricsWorkArea = {
    x: 1920,
    y: 0,
    width: 1280,
    height: 1024,
};
const WORK_AREAS: DesktopLyricsWorkArea[] = [
    PRIMARY_WORK_AREA,
    SECONDARY_WORK_AREA,
];

describe("desktop lyrics geometry contract", () => {
    it("picks the work area holding the largest visible overlap", () => {
        const floatingBounds: DesktopLyricsWindowBounds = {
            x: 1980,
            y: 40,
            width: 820,
            height: 220,
        };

        expect(
            resolveDesktopLyricsWorkArea(WORK_AREAS, floatingBounds),
        ).toEqual(SECONDARY_WORK_AREA);
    });

    it("clamps drifted bounds back into the owning monitor limits", () => {
        const driftedBounds: DesktopLyricsWindowBounds = {
            x: -120,
            y: -80,
            width: 2200,
            height: 60,
        };

        expect(normalizeDesktopLyricsBounds(driftedBounds, WORK_AREAS)).toEqual(
            {
                x: 0,
                y: 0,
                width: DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
                height: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
            },
        );
    });

    it("accepts persisted bounds that stay partially visible as-is", () => {
        const savedBounds: DesktopLyricsWindowBounds = {
            x: 40,
            y: 930,
            width: 900,
            height: 280,
        };

        expect(restoreDesktopLyricsBounds(savedBounds, WORK_AREAS)).toEqual({
            x: 40,
            y: 930,
            width: 900,
            height: 280,
        });
    });

    it("relocates fully off-screen persisted bounds to a safe visible spot", () => {
        const lostBounds: DesktopLyricsWindowBounds = {
            x: -1400,
            y: 1200,
            width: 900,
            height: 280,
        };

        expect(restoreDesktopLyricsBounds(lostBounds, WORK_AREAS)).toEqual({
            x: 0,
            y: 800,
            width: 900,
            height: 280,
        });
    });

    it("pins windows sitting within the snap threshold onto screen edges", () => {
        const nudgedBounds: DesktopLyricsWindowBounds = {
            x: 14,
            y: 18,
            width: 800,
            height: 200,
        };

        expect(snapDesktopLyricsBounds(nudgedBounds, WORK_AREAS)).toEqual({
            x: 0,
            y: 0,
            width: 800,
            height: 200,
        });
    });

    it("derives min and max size limits from the given work area", () => {
        const compactArea: DesktopLyricsWorkArea = {
            x: 0,
            y: 0,
            width: 600,
            height: 260,
        };

        expect(getDesktopLyricsWindowSizeLimits(compactArea)).toEqual({
            minWidth: DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
            minHeight: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
            maxWidth: 576,
            maxHeight: 236,
        });
    });
});
