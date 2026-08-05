import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn().mockReturnValue(false);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

import {
  compareVersions,
  extractVersion,
  fetchLatestRelease
} from "./update";

describe("extractVersion", () => {
  it("extracts a semantic version from release labels", () => {
    expect(extractVersion("v1.2.3")).toBe("1.2.3");
    expect(extractVersion("release-2.0.1")).toBe("2.0.1");
  });

  it("falls back to the trimmed input when no version pattern exists", () => {
    expect(extractVersion("  beta  ")).toBe("beta");
  });
});

describe("compareVersions", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("treats missing trailing parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("fetchLatestRelease", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invokeMock.mockReset();
    isTauriMock.mockReset().mockReturnValue(false);
  });

  it("uses Rust backend in Tauri environment for GitHub releases", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(JSON.stringify({
      tag_name: "v1.4.0",
      html_url: "https://github.com/Billy636/XianYuMusic/releases/tag/v1.4.0",
      published_at: "2026-05-08T00:00:00Z",
      body: "新增 GitHub 更新通道"
    }));

    await expect(fetchLatestRelease("Billy636", "XianYuMusic")).resolves.toEqual({
      version: "1.4.0",
      url: "https://github.com/Billy636/XianYuMusic/releases/tag/v1.4.0",
      publishedAt: "2026-05-08T00:00:00Z",
      notes: "新增 GitHub 更新通道",
      source: "github"
    });
    expect(invokeMock).toHaveBeenCalledWith('check_update_by_rust', { owner: 'Billy636', repo: 'XianYuMusic' });
  });

  it("does NOT fallback to browser fetch in Tauri when invoke fails for GitHub", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue(new Error("GitHub API error inside Rust"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(fetchLatestRelease("Billy636", "XianYuMusic")).rejects.toThrow("[Rust Backend] GitHub API error inside Rust");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses browser fetch in non-Tauri environment for GitHub releases", async () => {
    isTauriMock.mockReturnValue(false);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        tag_name: "v1.4.0",
        html_url: "https://github.com/Billy636/XianYuMusic/releases/tag/v1.4.0",
        published_at: "2026-05-08T00:00:00Z",
        body: "新增 GitHub 更新通道"
      }))
    );

    await expect(fetchLatestRelease("Billy636", "XianYuMusic")).resolves.toEqual({
      version: "1.4.0",
      url: "https://github.com/Billy636/XianYuMusic/releases/tag/v1.4.0",
      publishedAt: "2026-05-08T00:00:00Z",
      notes: "新增 GitHub 更新通道",
      source: "github"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/repos/Billy636/XianYuMusic/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
