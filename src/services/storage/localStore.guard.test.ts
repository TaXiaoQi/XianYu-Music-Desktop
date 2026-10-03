/*
 * localStore suite: behaviour without a browser localStorage global plus
 * round-trips when one is available. Behavioural coverage is unchanged.
 */

import localStoreSource from "./localStore.ts?raw";
import { localStore } from "./localStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceCountOf } from "../../testing/sourceText";

// 不绑定引号风格：prettier 可能在单/双引号间重排，守护只关心守卫表达式本身在位。
const GUARD_SNIPPET = "typeof localStorage ===";

const stubLiveStorage = () => {
    const backing: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => (key in backing ? backing[key] : null),
        setItem: (key: string, value: string) => {
            backing[key] = value;
        },
        removeItem: (key: string) => {
            delete backing[key];
        },
        clear: () => {
            Object.keys(backing).forEach((k) => delete backing[k]);
        },
        get length() {
            return Object.keys(backing).length;
        },
        key: (index: number) => Object.keys(backing)[index] ?? null,
    });
};

describe("localStore — behaviour without a localStorage global", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    type GuardScenario = {
        title: string;
        exercise: () => unknown;
        degradesTo: unknown;
    };

    const scenarios: GuardScenario[] = [
        {
            title: "getString degrades to null",
            exercise: () => localStore.getString("key"),
            degradesTo: null,
        },
        {
            title: "setString stays silent",
            exercise: () => localStore.setString("key", "value"),
            degradesTo: undefined,
        },
        {
            title: "remove stays silent",
            exercise: () => localStore.remove("key"),
            degradesTo: undefined,
        },
        {
            title: "clear stays silent",
            exercise: () => localStore.clear(),
            degradesTo: undefined,
        },
        {
            title: "getJson degrades to null",
            exercise: () => localStore.getJson("key"),
            degradesTo: null,
        },
        {
            title: "setJson stays silent",
            exercise: () => localStore.setJson("key", { data: true }),
            degradesTo: undefined,
        },
    ];

    for (const scenario of scenarios) {
        it(scenario.title, () => {
            vi.stubGlobal("localStorage", undefined);
            expect(scenario.exercise()).toBe(scenario.degradesTo);
        });
    }

    it("source keeps the typeof localStorage guard in place", () => {
        const guardOccurrences = sourceCountOf(localStoreSource, GUARD_SNIPPET);
        expect(guardOccurrences).toBeGreaterThanOrEqual(6);
    });
});

describe("localStore — with a localStorage global available", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("round-trips complex JSON structures", () => {
        stubLiveStorage();

        const complexData = {
            presets: [
                { id: "1", gains: [1.5, 2.5], name: "测试" },
                { id: "2", gains: [-1, -2], name: "test" },
            ],
            meta: { version: 2 },
        };

        localStore.setJson("complex", complexData);
        const restored = localStore.getJson<typeof complexData>("complex");
        expect(restored).toEqual(complexData);
    });

    it("copes with many interleaved writes and reads", () => {
        stubLiveStorage();

        for (let i = 0; i < 100; i++) {
            const storageKey = `key_${i}`;
            localStore.setJson(storageKey, { index: i });
        }

        for (let i = 0; i < 100; i++) {
            const storageKey = `key_${i}`;
            expect(localStore.getJson<{ index: number }>(storageKey)).toEqual({
                index: i,
            });
        }
    });
});
