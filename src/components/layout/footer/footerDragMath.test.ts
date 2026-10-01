import { describe, expect, it } from "vitest";

import { progressTimeFromPointer, volumePercentFromPointer } from "./footerDragMath";

describe("progressTimeFromPointer", () => {
  const rect = { left: 100, width: 200, bottom: 0, height: 0 };

  it("scales the pointer offset onto the track duration", () => {
    expect(progressTimeFromPointer(200, rect, 180)).toBe(90);
    expect(progressTimeFromPointer(100, rect, 180)).toBe(0);
    expect(progressTimeFromPointer(300, rect, 180)).toBe(180);
  });

  it("clamps pointers outside the track", () => {
    expect(progressTimeFromPointer(50, rect, 180)).toBe(0);
    expect(progressTimeFromPointer(400, rect, 180)).toBe(180);
  });

  it("preserves the original zero-width behaviour", () => {
    expect(Number.isNaN(progressTimeFromPointer(100, { ...rect, width: 0 }, 180))).toBe(true);
  });
});

describe("volumePercentFromPointer", () => {
  const rect = { left: 0, width: 0, bottom: 200, height: 100 };

  it("maps the full slider height onto 0-100", () => {
    expect(volumePercentFromPointer(200, rect)).toBe(0);
    expect(volumePercentFromPointer(150, rect)).toBe(50);
    expect(volumePercentFromPointer(100, rect)).toBe(100);
  });

  it("clamps pointers outside the slider", () => {
    expect(volumePercentFromPointer(50, rect)).toBe(100);
    expect(volumePercentFromPointer(300, rect)).toBe(0);
  });

  it("returns whole percentages", () => {
    expect(volumePercentFromPointer(133, rect)).toBe(67);
  });
});
