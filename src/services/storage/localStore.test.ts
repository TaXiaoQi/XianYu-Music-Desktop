import { beforeEach, describe, expect, it, vi } from "vitest";

import { localStore } from "./localStore";

type StorageMap = Record<string, string>;

const createLocalStorageMock = () => {
  let storage: StorageMap = {};

  return {
    clear: vi.fn(() => {
      storage = {};
    }),
    getItem: vi.fn((key: string) => (key in storage ? storage[key] : null)),
    removeItem: vi.fn((key: string) => {
      delete storage[key];
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
  };
};

describe("localStore", () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("stores and reads plain strings", () => {
    localStore.setString("theme", "dark");

    expect(localStore.getString("theme")).toBe("dark");
  });

  it("stores and reads JSON payloads", () => {
    localStore.setJson("player", { volume: 80 });

    expect(localStore.getJson<{ volume: number }>("player")).toEqual({ volume: 80 });
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("broken", "{");

    expect(localStore.getJson("broken")).toBeNull();
  });
});
