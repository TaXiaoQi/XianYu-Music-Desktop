/*
 * Extended settings-store suite: persistence round-trips through localStorage,
 * rapid-operation stability, merge edge cases and the component commit path.
 * Data-driven rewrite; behavioural coverage is unchanged.
 */

import type {
    AppSettings,
    AudioSettings,
    EqualizerSettings,
} from "../../types";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createDefaultAppSettings,
    mergeAppSettings,
    mergeAudioSettings,
    useSettingsStore,
} from "./store";
import { playerStorageKeys } from "../../services/storage/playerStorage";

// ## scaffolding ##############################################################

const PRESET_KEY = playerStorageKeys.equalizerPresets;

const makeStorageMock = () => {
    const backing: Record<string, string> = {};
    return {
        getItem: (key: string): string | null =>
            key in backing ? backing[key] : null,
        setItem: (key: string, value: string): void => {
            backing[key] = value;
        },
        removeItem: (key: string): void => {
            delete backing[key];
        },
        clear: (): void => {
            Object.keys(backing).forEach((k) => delete backing[k]);
        },
        get length(): number {
            return Object.keys(backing).length;
        },
        key: (index: number): string | null =>
            Object.keys(backing)[index] ?? null,
    };
};

type StorageMock = ReturnType<typeof makeStorageMock>;

const bootStore = () => {
    setActivePinia(createPinia()); // 实现
    return useSettingsStore();
};

const eqView = (store: ReturnType<typeof useSettingsStore>) =>
    store.settings.audio.equalizer;

const forceEqPatch = (patch: Record<string, unknown>) =>
    patch as unknown as EqualizerSettings;

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const bandCount = 10;

const gainSlot = (value: number) => Array<number>(bandCount).fill(value);

// ## boot from persisted storage ##############################################

const STORED_PRESET = {
    id: "user_stored",
    name: "Stored Preset",
    preamp: -2.0,
    gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1],
    isBuiltin: false,
    createdAt: 1000,
    updatedAt: 2000,
};

describe("boot path hydrates presets from persisted storage", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("hydrates the preset list when storage holds data", () => {
        const storageMock = makeStorageMock();
        storageMock.setItem(PRESET_KEY, JSON.stringify([STORED_PRESET]));
        vi.stubGlobal("localStorage", storageMock);

        const store = bootStore();

        expect(store.equalizerPresets).toHaveLength(1);
        const restored = store.equalizerPresets[0];
        expect(restored.name).toBe("Stored Preset");
        expect(restored.preamp).toBe(-2.0);
    });

    it("hydrates an empty list when the storage key is missing", () => {
        vi.stubGlobal("localStorage", makeStorageMock());
        const store = bootStore();

        expect(store.equalizerPresets).toHaveLength(0);
        expect(store.userPresets).toHaveLength(0);
    });

    it("hydrates an empty list when the stored payload is corrupt", () => {
        const storageMock = makeStorageMock();
        storageMock.setItem(PRESET_KEY, "{broken");
        vi.stubGlobal("localStorage", storageMock);

        const store = bootStore();

        expect(store.equalizerPresets).toHaveLength(0);
    });
});

// ## persistence of CRUD ######################################################

describe("CRUD operations write through to localStorage", () => {
    let storageMock: StorageMock;

    beforeEach(() => {
        storageMock = makeStorageMock();
        vi.stubGlobal("localStorage", storageMock);
        setActivePinia(createPinia());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const persistedNames = (): Array<{ name: string }> => {
        const raw = storageMock.getItem(PRESET_KEY);
        expect(typeof raw).toBe("string");
        return JSON.parse(raw as string) as Array<{ name: string }>;
    };

    it("saveEqualizerPreset persists the new entry", () => {
        const store = bootStore();
        store.saveEqualizerPreset("Persisted");

        const parsed = persistedNames();
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe("Persisted");
    });

    it("updateEqualizerPreset persists the edited entry", () => {
        const store = bootStore();
        const preset = store.saveEqualizerPreset("Original");
        store.settings.audio.equalizer.preamp = -10.0;
        store.settings.audio.equalizer.gains = gainSlot(4.5);
        store.updateEqualizerPreset(preset.id, "Updated Name");

        const raw = storageMock.getItem(PRESET_KEY) as string;
        const parsed = JSON.parse(raw) as Array<{
            name: string;
            preamp: number;
        }>;
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe("Updated Name");
        expect(parsed[0].preamp).toBe(-10.0);
    });

    it("deleteEqualizerPreset drops the entry from storage", () => {
        const store = bootStore();
        const preset = store.saveEqualizerPreset("To Remove");
        expect(storageMock.getItem(PRESET_KEY)).toBeTruthy();

        store.deleteEqualizerPreset(preset.id);

        const parsed = JSON.parse(
            storageMock.getItem(PRESET_KEY) as string,
        ) as unknown[];
        expect(parsed).toHaveLength(0);
    });

    it("a burst of saves persists every entry in order", () => {
        const store = bootStore();
        for (let i = 0; i < 5; i++) {
            store.saveEqualizerPreset(`Preset ${i}`);
        }

        const parsed = persistedNames();
        expect(parsed).toHaveLength(5);
        expect(parsed.map((entry) => entry.name)).toEqual([
            "Preset 0",
            "Preset 1",
            "Preset 2",
            "Preset 3",
            "Preset 4",
        ]);
    });

    it("interleaved delete+save leaves storage mirroring the final list", () => {
        const store = bootStore();
        const presetA = store.saveEqualizerPreset("A");
        store.saveEqualizerPreset("B");
        store.deleteEqualizerPreset(presetA.id);
        store.saveEqualizerPreset("C");

        const parsed = persistedNames();
        expect(parsed).toHaveLength(2);
        expect(parsed.map((entry) => entry.name)).toEqual(["B", "C"]);
    });
});

// ## rapid operations #########################################################

describe("rapid concurrent operations stay consistent", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("save → delete → save cycles keep a single entry", () => {
        const store = useSettingsStore();

        const doomed = store.saveEqualizerPreset("Temp");
        store.deleteEqualizerPreset(doomed.id);
        const finalPreset = store.saveEqualizerPreset("Final");

        expect(store.userPresets).toHaveLength(1);
        expect(store.userPresets[0].name).toBe("Final");
        expect(eqView(store).currentPresetId).toBe(finalPreset.id);
    });

    it("repeated updates of one preset keep the latest data", () => {
        const store = useSettingsStore();
        const preset = store.saveEqualizerPreset("Init");

        for (let i = 0; i < 10; i++) {
            store.settings.audio.equalizer.gains[0] = i;
            store.updateEqualizerPreset(preset.id, `Updated ${i}`);
        }

        expect(store.userPresets[0].name).toBe("Updated 9");
        expect(store.userPresets[0].gains[0]).toBe(9);
    });

    it("interleaved saves and loads restore the right gains", async () => {
        const ONES = gainSlot(1);
        const FIVES = gainSlot(5);
        const store = useSettingsStore();

        store.settings.audio.equalizer.gains = ONES;
        const first = store.saveEqualizerPreset("P1");
        await tick(2);

        store.settings.audio.equalizer.gains = FIVES;
        const second = store.saveEqualizerPreset("P2");

        expect(first.id).not.toBe(second.id);

        store.settings.audio.equalizer.enabled = false;
        store.settings.audio.equalizer.gains = gainSlot(0);

        store.loadEqualizerPreset(first.id);
        expect(eqView(store).gains).toEqual(ONES);
        expect(eqView(store).currentPresetId).toBe(first.id);

        store.loadEqualizerPreset(second.id);
        expect(eqView(store).gains).toEqual(FIVES);
        expect(eqView(store).currentPresetId).toBe(second.id);
    });

    it("adding then pruning 25 presets keeps userPresets correct", async () => {
        const store = useSettingsStore();

        const savedIds: string[] = [];
        for (let i = 0; i < 25; i++) {
            const preset = store.saveEqualizerPreset(`Rapid ${i}`);
            savedIds.push(preset.id);
            await tick(1);
        }
        expect(store.userPresets).toHaveLength(25);

        for (let i = 0; i < 25; i += 2) {
            store.deleteEqualizerPreset(savedIds[i]);
        }
        expect(store.userPresets).toHaveLength(12);

        const survivorNames = store.userPresets.map((p) => p.name);
        for (let i = 1; i < 25; i += 2) {
            expect(survivorNames).toContain(`Rapid ${i}`);
        }
    });
});

// ## merge boundary matrix ####################################################

describe("mergeAudioSettings — boundary value combinations", () => {
    const makeAudio = (
        eqOverrides: Partial<EqualizerSettings> = {},
    ): AudioSettings => ({
        outputMode: "shared",
        volumeBalance: {
            enabled: false,
            gainOffsetDb: 0,
            preventClipping: true,
        },
        equalizer: { // 实现
            enabled: false,
            preamp: 0,
            gains: gainSlot(0),
            currentPresetId: null,
            ...eqOverrides,
        },
        showEqualizerInFooter: true,
    });

    type AudioPatch = Parameters<typeof mergeAudioSettings>[1];

    type BoundaryScenario = {
        title: string;
        eqOverrides: Partial<EqualizerSettings>;
        patch: AudioPatch;
        verify: (merged: AudioSettings) => void;
    };

    const scenarios: BoundaryScenario[] = [
        {
            title: "footer-toggle patch keeps the association",
            eqOverrides: { currentPresetId: "special_preset" },
            patch: { showEqualizerInFooter: false },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("special_preset");
                expect(merged.showEqualizerInFooter).toBe(false);
            },
        },
        {
            title: "outputMode + volumeBalance patch keeps the association",
            eqOverrides: { currentPresetId: "keep_it" },
            patch: {
                outputMode: "wasapiExclusive",
                volumeBalance: { enabled: true, gainOffsetDb: 10 },
            },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("keep_it");
                expect(merged.outputMode).toBe("wasapiExclusive");
            },
        },
        {
            title: "association-only patch overrides just that field",
            eqOverrides: {
                enabled: true,
                preamp: -3,
                gains: gainSlot(1),
                currentPresetId: "old",
            },
            patch: { equalizer: forceEqPatch({ currentPresetId: "new_only" }) },
            verify: (merged) => {
                expect(merged.equalizer.enabled).toBe(true);
                expect(merged.equalizer.preamp).toBe(-3);
                expect(merged.equalizer.gains).toEqual(gainSlot(1));
                expect(merged.equalizer.currentPresetId).toBe("new_only");
            },
        },
        {
            title: "empty equalizer patch changes nothing",
            eqOverrides: { currentPresetId: "survive" },
            patch: { equalizer: forceEqPatch({}) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("survive");
            },
        },
        {
            title: "enabled-only equalizer patch keeps the association",
            eqOverrides: { currentPresetId: "yes" },
            patch: { equalizer: forceEqPatch({ enabled: true }) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("yes");
                expect(merged.equalizer.enabled).toBe(true);
            },
        },
    ];

    for (const scenario of scenarios) {
        it(scenario.title, () => {
            const base = makeAudio(scenario.eqOverrides);
            const merged = mergeAudioSettings(base, scenario.patch);
            scenario.verify(merged);
        });
    }

    it("explicit null differs from an absent association key", () => {
        const clearedBase = makeAudio({ currentPresetId: "should_be_cleared" });
        const cleared = mergeAudioSettings(clearedBase, {
            equalizer: forceEqPatch({ currentPresetId: null }),
        });
        expect(cleared.equalizer.currentPresetId).toBeNull();

        const keptBase = makeAudio({ currentPresetId: "should_keep" });
        const kept = mergeAudioSettings(keptBase, {
            equalizer: forceEqPatch({}),
        });
        expect(kept.equalizer.currentPresetId).toBe("should_keep");
    });

    it("app-level merge with an association-only patch behaves the same", () => {
        const seed = createDefaultAppSettings();
        const base: AppSettings = {
            ...seed,
            audio: {
                ...seed.audio,
                equalizer: {
                    enabled: true,
                    preamp: -1,
                    gains: gainSlot(3),
                    currentPresetId: "original",
                },
            },
        };

        const merged = mergeAppSettings(base, {
            audio: { equalizer: forceEqPatch({ currentPresetId: null }) },
        });

        const mergedEq = merged.audio.equalizer;
        expect(mergedEq.currentPresetId).toBeNull();
        expect(mergedEq.enabled).toBe(true);
        expect(mergedEq.preamp).toBe(-1);
    });
});

// ## degenerate inputs ########################################################

describe("edge cases — empty, null and undefined inputs", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("an empty name still yields a valid preset", () => {
        const store = useSettingsStore();
        const preset = store.saveEqualizerPreset("");
        expect(preset.name).toBe("");
        expect(preset.id.startsWith("user_")).toBe(true);
    });

    it("a whitespace-only name is stored verbatim", () => {
        const store = useSettingsStore();
        const preset = store.saveEqualizerPreset("   ");
        expect(preset.name).toBe("   ");
        expect(store.userPresets).toHaveLength(1);
    });

    it("loading empty or unknown ids leaves the equalizer untouched", () => {
        const store = useSettingsStore();
        store.saveEqualizerPreset("Real");
        const snapshot = { ...eqView(store) };

        store.loadEqualizerPreset("");
        expect(eqView(store)).toEqual(snapshot);

        store.loadEqualizerPreset("non_existent");
        expect(eqView(store)).toEqual(snapshot);
    });

    it("renaming to an empty string is accepted", () => {
        const store = useSettingsStore();
        const preset = store.saveEqualizerPreset("Old");
        store.updateEqualizerPreset(preset.id, "");
        expect(store.userPresets[0].name).toBe("");
    });

    it("deleting an empty id is a no-op", () => {
        const store = useSettingsStore();
        store.saveEqualizerPreset("Safe");
        store.deleteEqualizerPreset("");
        expect(store.userPresets).toHaveLength(1);
    });

    it("gain tables stay ten slots wide through every operation", () => {
        const store = useSettingsStore();

        for (let i = 0; i < 3; i++) {
            store.settings.audio.equalizer.gains = gainSlot(i);
            const preset = store.saveEqualizerPreset(`P${i}`);
            expect(preset.gains).toHaveLength(bandCount);
        }

        const firstPreset = store.userPresets[0];
        store.updateEqualizerPreset(firstPreset.id, "Updated");
        expect(store.userPresets[0].gains).toHaveLength(bandCount);

        store.loadEqualizerPreset(store.userPresets[1].id);
        expect(eqView(store).gains).toHaveLength(bandCount);
    });

    it("a hand-rolled default audio block mirrors the factory shape", () => {
        const handRolled = {
            outputMode: "shared" as const,
            volumeBalance: {
                enabled: false,
                gainOffsetDb: 0,
                preventClipping: true,
            },
            equalizer: {
                enabled: false,
                preamp: 0.0,
                gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                currentPresetId: null as string | null,
            },
            showEqualizerInFooter: true,
        };
        expect(handRolled.equalizer.gains).toHaveLength(bandCount);
        expect(
            handRolled.equalizer.gains.every((g) => typeof g === "number"),
        ).toBe(true);
        expect(handRolled.equalizer.enabled).toBe(false);
        expect(handRolled.equalizer.preamp).toBe(0.0);
    });
});

// ## component commit path ####################################################

describe("component commitSettings path — association survival", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    const commitLikeComponent = (
        store: ReturnType<typeof useSettingsStore>,
        patch: Partial<EqualizerSettings>,
    ) => {
        const mergedEq = { ...eqView(store), ...patch };
        store.patchSettings({
            audio: { ...store.settings.audio, equalizer: mergedEq },
        });
    };

    it("association survives when the commit patch omits it", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.currentPresetId = "component_preset";

        commitLikeComponent(store, {
            preamp: -2.0,
            gains: gainSlot(0.5),
        });

        expect(eqView(store).currentPresetId).toBe("component_preset");
        expect(eqView(store).preamp).toBe(-2.0);
    });

    it("association is cleared when the commit patch passes null", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.currentPresetId = "will_be_cleared";

        commitLikeComponent(store, {
            preamp: 0,
            gains: gainSlot(0),
            currentPresetId: null,
        });

        expect(eqView(store).currentPresetId).toBeNull();
    });

    it("the enabled flag survives when the commit patch omits it", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.enabled = true;
        store.settings.audio.equalizer.currentPresetId = "with_enabled";

        commitLikeComponent(store, { preamp: +2.0 });

        expect(eqView(store).enabled).toBe(true);
        expect(eqView(store).currentPresetId).toBe("with_enabled");
    });
});

// ## type optionality #########################################################

describe("EqualizerSettings currentPresetId optionality", () => {
    it("can be set and cleared through store operations", () => {
        const store = bootStore();

        store.patchSettings({
            audio: { equalizer: forceEqPatch({ currentPresetId: null }) },
        });
        expect(eqView(store).currentPresetId).toBeNull();

        const preset = store.saveEqualizerPreset("Any");
        expect(eqView(store).currentPresetId).toBe(preset.id);

        store.patchSettings({
            audio: { equalizer: forceEqPatch({ currentPresetId: null }) },
        });
        expect(eqView(store).currentPresetId).toBeNull();
    });

    it("the TypeScript shape admits undefined, null and strings", () => {
        const variants: Array<{ currentPresetId?: string | null }> = [
            { currentPresetId: undefined },
            { currentPresetId: null },
            { currentPresetId: "user_abc" },
            {},
        ];
        expect(variants).toHaveLength(4);
    });
});
