import { describe, expect, it } from "vitest";

import { FOOTER_PROGRESS_HIDDEN_KEY, getProgressVisualState, readStoredProgressHidden } from "./playerFooterProgress";

describe("readStoredProgressHidden", () => {
  it("maps only the literal stored true string to hidden", () => {
    const storageStub = (stored: string | null) => ({ getItem: () => stored });
    expect(readStoredProgressHidden(storageStub("true"))).toBe(true);
    expect(readStoredProgressHidden(storageStub("false"))).toBe(false);
    expect(readStoredProgressHidden(storageStub(null))).toBe(false);
  });

  it("reads the dedicated footer progress storage key", () => {
    const storage = { getItem: (storageKey: string) => (storageKey === FOOTER_PROGRESS_HIDDEN_KEY ? "true" : null) };
    expect(readStoredProgressHidden(storage)).toBe(true);
  });
});

describe("getProgressVisualState", () => {
  it.each([
    { hidden: false, dragging: false, expected: { trackClass: "opacity-100", thumbClass: "opacity-0 scale-75 group-hover/progress:opacity-100 group-hover/progress:scale-100" } },
    { hidden: true, dragging: false, expected: { trackClass: "opacity-0 group-hover/progress:opacity-0", thumbClass: "opacity-0 scale-75" } },
    { hidden: true, dragging: true, expected: { trackClass: "opacity-45", thumbClass: "opacity-70 scale-100" } },
  ])("styles a hidden=$hidden dragging=$dragging progress bar with the expected classes", ({ hidden, dragging, expected }) => {
    expect(getProgressVisualState(hidden, dragging)).toEqual(expected);
  });
});
