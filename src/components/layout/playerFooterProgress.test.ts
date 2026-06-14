import { describe, expect, it } from "vitest";

import {
  FOOTER_PROGRESS_HIDDEN_KEY,
  getProgressVisualState,
  readStoredProgressHidden
} from "./playerFooterProgress";

describe("readStoredProgressHidden", () => {
  it("treats only the stored true string as hidden", () => {
    expect(readStoredProgressHidden({ getItem: () => "true" })).toBe(true);
    expect(readStoredProgressHidden({ getItem: () => "false" })).toBe(false);
    expect(readStoredProgressHidden({ getItem: () => null })).toBe(false);
  });

  it("uses the footer progress hidden storage key", () => {
    const storage = {
      getItem: (key: string) => key === FOOTER_PROGRESS_HIDDEN_KEY ? "true" : null
    };

    expect(readStoredProgressHidden(storage)).toBe(true);
  });
});

describe("getProgressVisualState", () => {
  it("keeps the progress visible when not hidden", () => {
    expect(getProgressVisualState(false, false)).toEqual({
      trackClass: "opacity-100",
      thumbClass: "opacity-0 scale-75 group-hover/progress:opacity-100 group-hover/progress:scale-100"
    });
  });

  it("hides the progress visuals while preserving the interaction layer", () => {
    expect(getProgressVisualState(true, false)).toEqual({
      trackClass: "opacity-0 group-hover/progress:opacity-0",
      thumbClass: "opacity-0 scale-75"
    });
  });

  it("fades the progress visuals back in while dragging a hidden progress bar", () => {
    expect(getProgressVisualState(true, true)).toEqual({
      trackClass: "opacity-45",
      thumbClass: "opacity-70 scale-100"
    });
  });
});
