import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStore } from "./localStore";

// 基于 Map 构造一份 localStorage 替身（行为对齐真实存储语义）。
function buildStorageStub() {
  const backing = new Map<string, string>();

  return {
    clear() {
      backing.clear();
    },
    getItem(key: string) {
      return backing.has(key) ? backing.get(key)! : null;
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    setItem(key: string, value: string) {
      backing.set(key, value);
    },
  };
}

describe("localStore 读写行为", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", buildStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setString 写入的字符串可经 getString 原样取回", () => {
    localStore.setString("theme", "dark");

    expect(localStore.getString("theme")).toBe("dark");
  });

  it("setJson 写入的对象经 getJson 读回后结构不变", () => {
    localStore.setJson("player", { volume: 80 });

    expect(localStore.getJson<{ volume: number }>("player")).toEqual({ volume: 80 });
  });

  it("读到非法 JSON 时静默返回 null 而非抛错", () => {
    localStorage.setItem("broken", "{");

    expect(localStore.getJson("broken")).toBeNull();
  });
});
