/*
 * playerStorage suite: equalizer preset serialization, malformed-entry
 * filtering and behaviour when localStorage is unavailable.
 * Behavioural coverage is unchanged.
 */

import type { EqualizerPreset } from "../../types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playerStorage, playerStorageKeys } from "./playerStorage";

// ## scaffolding ##############################################################

const PRESET_KEY = playerStorageKeys.equalizerPresets;

const freshStorageMock = () => {
    const backing: Record<string, string> = {};
    return {
        clear: (): void => {
            Object.keys(backing).forEach((k) => delete backing[k]);
        },
        getItem: (key: string): string | null =>
            key in backing ? backing[key] : null,
        removeItem: (key: string): void => {
            delete backing[key];
        },
        setItem: (key: string, value: string): void => {
            backing[key] = value;
        },
        get length(): number {
            return Object.keys(backing).length;
        },
        key: (index: number): string | null =>
            Object.keys(backing)[index] ?? null,
    };
};

const buildPreset = (
    overrides: Partial<EqualizerPreset> = {},
): EqualizerPreset => {
    const randomSuffix = Math.random().toString(36).slice(2);
    return {
        id: `user_test_${randomSuffix}`,
        name: "Test Preset",
        preamp: -2.0,
        gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1],
        isBuiltin: false,
        createdAt: 1000,
        updatedAt: 2000,
        ...overrides,
    };
};

const seedStorage = (payload: unknown) => {
    localStorage.setItem(PRESET_KEY, JSON.stringify(payload));
};

const readBack = () => playerStorage.readEqualizerPresets();

// ## round-trips ##############################################################

describe("playerStorage — equalizer preset persistence contract", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", freshStorageMock());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("round-trips an empty preset list", () => {
        playerStorage.writeEqualizerPresets([]);
        const reloaded = readBack();
        expect(reloaded).toEqual([]);
    });

    it("round-trips a single preset with its fields intact", () => {
        const preset = buildPreset({ name: "Bass Boost" });
        playerStorage.writeEqualizerPresets([preset]);

        const reloaded = readBack();
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0].name).toBe("Bass Boost");
        expect(reloaded[0].preamp).toBe(-2.0);
        expect(reloaded[0].gains).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1]);
    });

    it("round-trips several presets in order", () => {
        playerStorage.writeEqualizerPresets([
            buildPreset({ name: "Rock", id: "user_rock" }),
            buildPreset({ name: "Jazz", id: "user_jazz" }),
            buildPreset({ name: "Pop", id: "user_pop" }),
        ]);

        const reloaded = readBack();
        expect(reloaded).toHaveLength(3);
        expect(reloaded.map((p) => p.name)).toEqual(["Rock", "Jazz", "Pop"]);
    });

    it("a second write replaces everything from the first", () => {
        playerStorage.writeEqualizerPresets([buildPreset({ name: "Old" })]);
        playerStorage.writeEqualizerPresets([buildPreset({ name: "New" })]);

        const reloaded = readBack();
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0].name).toBe("New");
    });

    it("targets the documented storage key", () => {
        const actualKey = playerStorageKeys.equalizerPresets;
        expect(actualKey).toBe("player_equalizer_presets");
    });

    it("lands the payload under the documented key", () => {
        const preset = buildPreset();
        playerStorage.writeEqualizerPresets([preset]);

        const raw = localStorage.getItem(PRESET_KEY);
        expect(raw).toBeTruthy();

        const parsed = JSON.parse(raw as string) as Array<{ id: string }>;
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed[0].id).toBe(preset.id);
    });

    it("reads back an empty list when nothing was stored", () => {
        expect(readBack()).toEqual([]);
    });

    it("reads back an empty list for a literal null payload", () => {
        localStorage.setItem(PRESET_KEY, "null");
        expect(readBack()).toEqual([]);
    });

    it("reads back an empty list for unparseable JSON", () => {
        localStorage.setItem(PRESET_KEY, "{broken json");
        expect(readBack()).toEqual([]);
    });

    it("reads back an empty list when the payload is not an array", () => {
        localStorage.setItem(
            PRESET_KEY,
            JSON.stringify({ name: "not an array" }),
        );
        expect(readBack()).toEqual([]);
    });

    it("drops entries whose id is not a non-empty string", () => {
        seedStorage([
            buildPreset({ id: "valid_1", name: "Valid" }),
            { name: "No ID" },
            { id: 123, name: "Numeric ID" },
            { id: null, name: "Null ID" },
            null,
            undefined,
            "string item",
            buildPreset({ id: "valid_2", name: "Also Valid" }),
        ]);

        const reloaded = readBack();
        expect(reloaded).toHaveLength(2);
        expect(reloaded.map((p) => p.name)).toEqual(["Valid", "Also Valid"]);
    });

    it("drops loose null/undefined/primitive entries", () => {
        seedStorage([
            null,
            undefined,
            buildPreset({ id: "survivor" }),
            0,
            false,
            "",
        ]);

        const reloaded = readBack();
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0].id).toBe("survivor");
    });

    it("keeps every field of a fully populated preset", () => {
        const preset: EqualizerPreset = {
            id: "user_full",
            name: "Full Preset",
            preamp: -6.5,
            gains: [-12, -6, -3, 0, 3, 6, 3, 0, -3, -6],
            isBuiltin: false,
            createdAt: 1700000000000,
            updatedAt: 1700000001000,
        };

        playerStorage.writeEqualizerPresets([preset]);
        const reloaded = readBack();

        expect(reloaded[0]).toEqual(preset);
    });

    it("survives unicode names", () => {
        const preset = buildPreset({ name: "低音增强 🎵 Ñ" });
        playerStorage.writeEqualizerPresets([preset]);

        const reloaded = readBack();
        expect(reloaded[0].name).toBe("低音增强 🎵 Ñ");
    });

    it("survives empty names", () => {
        const preset = buildPreset({ name: "" });
        playerStorage.writeEqualizerPresets([preset]);

        const reloaded = readBack();
        expect(reloaded[0].name).toBe("");
    });

    it("survives extreme gain values", () => {
        const extremeGains = [-12, -12, -12, -12, -12, 12, 12, 12, 12, 12];
        const preset = buildPreset({ gains: extremeGains });
        playerStorage.writeEqualizerPresets([preset]);

        const reloaded = readBack();
        expect(reloaded[0].gains).toEqual(extremeGains);
    });

    it("survives a zero preamp", () => {
        const preset = buildPreset({ preamp: 0 });
        playerStorage.writeEqualizerPresets([preset]);

        const reloaded = readBack();
        expect(reloaded[0].preamp).toBe(0);
    });
});

// ## no localStorage ##########################################################

describe("playerStorage — equalizer presets without a localStorage global", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reading degrades to an empty list", () => {
        vi.stubGlobal("localStorage", undefined);
        const reloaded = readBack();
        expect(reloaded).toEqual([]);
    });

    it("writing stays silent instead of throwing", () => {
        vi.stubGlobal("localStorage", undefined);
        const attempt = () => {
            playerStorage.writeEqualizerPresets([buildPreset()]);
        };
        expect(attempt).not.toThrowError();
    });
});

// ## malformed filtering ######################################################

describe("malformed equalizer presets are rejected during read", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", freshStorageMock());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const flatZeroGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    type MalformedScenario = { title: string; badEntries: unknown[] };

    const scenarios: MalformedScenario[] = [
        {
            title: "entries missing required fields are dropped",
            badEntries: [
                { id: "bad_missing_gains", name: "Bad" },
                { id: "bad_missing_name", preamp: 0, gains: flatZeroGains },
                { name: "Bad", gains: flatZeroGains },
            ],
        },
        {
            title: "entries with an invalid gains array are dropped",
            badEntries: [
                {
                    id: "bad_gains_short",
                    name: "Bad",
                    preamp: 0,
                    gains: [0, 0, 0],
                    isBuiltin: false,
                    createdAt: 1,
                    updatedAt: 1,
                },
                {
                    id: "bad_gains_type",
                    name: "Bad",
                    preamp: 0,
                    gains: ["x", "y", "z", "a", "b", "c", "d", "e", "f", "g"],
                    isBuiltin: false,
                    createdAt: 1,
                    updatedAt: 1,
                },
                {
                    id: "bad_gains_nan",
                    name: "Bad",
                    preamp: 0,
                    gains: [NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    isBuiltin: false,
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        },
        {
            title: "entries with non-finite numeric fields are dropped",
            badEntries: [
                {
                    id: "bad_preamp",
                    name: "Bad",
                    preamp: NaN,
                    gains: flatZeroGains,
                    isBuiltin: false,
                    createdAt: 1,
                    updatedAt: 1,
                },
                {
                    id: "bad_created",
                    name: "Bad",
                    preamp: 0,
                    gains: flatZeroGains,
                    isBuiltin: false,
                    createdAt: NaN,
                    updatedAt: 1,
                },
                {
                    id: "bad_updated",
                    name: "Bad",
                    preamp: 0,
                    gains: flatZeroGains,
                    isBuiltin: false,
                    createdAt: 1,
                    updatedAt: NaN,
                },
            ],
        },
        {
            title: "entries with a non-boolean isBuiltin are dropped",
            badEntries: [
                {
                    id: "bad_builtin",
                    name: "Bad",
                    preamp: 0,
                    gains: flatZeroGains,
                    isBuiltin: "yes",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        },
        {
            title: "entries with an empty id are dropped",
            badEntries: [
                {
                    id: "",
                    name: "Bad",
                    preamp: 0,
                    gains: flatZeroGains,
                    isBuiltin: false,
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        },
    ];

    for (const scenario of scenarios) {
        it(scenario.title, () => {
            const validPreset = buildPreset();
            seedStorage([...scenario.badEntries, validPreset]);

            const reloaded = readBack();
            expect(reloaded).toEqual([validPreset]);
        });
    }
});
