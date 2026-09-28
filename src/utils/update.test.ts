import { afterEach, describe, expect, it, vi } from "vitest";

import { compareVersions, extractVersion, fetchLatestRelease } from "./update";

// —— 替身：拦截 @tauri-apps/api/core，观察 Rust 后端调用与 Tauri 环境判定 ——
const backendInvoke = vi.hoisted(() => vi.fn());
const inTauriEnv = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: backendInvoke, isTauri: inTauriEnv }));

// —— 冻结的 GitHub Release 桩数据 ——
const GITHUB_RELEASE_PAYLOAD = {
  tag_name: "v1.4.0",
  html_url: "https://github.com//XianYuMusic/releases/tag/v1.4.0",
  published_at: "2026-05-08T00:00:00Z",
  body: "新增 GitHub 更新通道"
};

// —— 冻结的期望解析结果 ——
const EXPECTED_RELEASE_INFO = {
  version: "1.4.0",
  url: "https://github.com//XianYuMusic/releases/tag/v1.4.0",
  publishedAt: "2026-05-08T00:00:00Z",
  notes: "新增 GitHub 更新通道",
  source: "github"
};

describe("extractVersion：从发布标签中抽取版本", () => {
  it("能从各类发布标签中截取语义化版本号", () => {
    expect(extractVersion("v1.2.3")).toBe("1.2.3");
    expect(extractVersion("release-2.0.1")).toBe("2.0.1");
  });

  it("输入不含版本模式时回退为去除首尾空白后的原文", () => {
    expect(extractVersion("  beta  ")).toBe("beta");
  });
});

describe("compareVersions：版本号新旧比较", () => {
  it("对点分版本号逐段做数值比较", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("缺失的尾部版本段按 0 参与", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  it("能区分预发布后缀的新旧（beta7 > beta6）", () => {
    expect(compareVersions("2.0.0-beta5", "2.0.0-beta4")).toBe(1);
    expect(compareVersions("2.0.0-beta4", "2.0.0-beta5")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0-beta5")).toBe(1);
    expect(compareVersions("2.0.0-beta9", "2.0.0-beta10")).toBe(-1);
  });
});

describe("fetchLatestRelease：GitHub 发布信息获取", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backendInvoke.mockReset();
    inTauriEnv.mockReset().mockReturnValue(false);
  });

  it("Tauri 环境下走 Rust 后端获取 GitHub 发布信息", async () => {
    inTauriEnv.mockReturnValue(true);
    backendInvoke.mockResolvedValue(JSON.stringify(GITHUB_RELEASE_PAYLOAD));

    await expect(fetchLatestRelease("", "XianYuMusic")).resolves.toEqual(EXPECTED_RELEASE_INFO);
    expect(backendInvoke).toHaveBeenCalledWith('check_update_by_rust', { owner: '', repo: 'XianYuMusic' });
  });

  it("Tauri 环境下 invoke 失败时不允许退化为浏览器 fetch", async () => {
    inTauriEnv.mockReturnValue(true);
    backendInvoke.mockRejectedValue(new Error("GitHub API error inside Rust"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(fetchLatestRelease("", "XianYuMusic")).rejects.toThrow("[Rust Backend] GitHub API error inside Rust");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("非 Tauri 环境下改用浏览器 fetch 获取 GitHub 发布信息", async () => {
    inTauriEnv.mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(GITHUB_RELEASE_PAYLOAD))
    );

    await expect(fetchLatestRelease("", "XianYuMusic")).resolves.toEqual(EXPECTED_RELEASE_INFO);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.github.com/repos//XianYuMusic/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    expect(backendInvoke).not.toHaveBeenCalled();
  });
});
