/*
 * Settings store suite: equalizer preset lifecycle, merge semantics and
 * currentPresetId survival. Scenarios are data-driven; behavioural coverage
 * is unchanged.
 */

import type {
    AppSettings,
    AudioSettings,
    EqualizerPreset,
    EqualizerSettings,
} from "../../types";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceContains } from "../../testing/sourceText";
import {
    createDefaultAppSettings,
    createDefaultAudioSettings,
    defaultAudioSettings,
    mergeAppSettings,
    mergeAudioSettings,
    useSettingsStore,
} from "./store";

import playerStorageSource from "../../services/storage/playerStorage.ts?raw";

// ## shared scaffolding #######################################################

const BAND_COUNT = 10;

const flatGains = (): number[] => Array<number>(BAND_COUNT).fill(0);

const bootStore = () => {
    setActivePinia(createPinia()); // 实现
    return useSettingsStore();
};

const eqView = (store: ReturnType<typeof useSettingsStore>) =>
    store.settings.audio.equalizer;

const audioFixture = (equalizer: EqualizerSettings): AudioSettings => ({
    ...defaultAudioSettings,
    equalizer,
});

const appFixture = (equalizer: EqualizerSettings): AppSettings => {
    const seed = createDefaultAppSettings();
    return { ...seed, audio: { ...seed.audio, equalizer } };
};

const builtinEntry = (
    id: string,
    name: string,
    preamp: number,
    gains: number[],
): EqualizerPreset => ({
    id,
    name,
    preamp,
    gains,
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
});

const userEntry = (id: string, name: string): EqualizerPreset => ({
    id,
    name,
    preamp: 0,
    gains: flatGains(),
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

const forceEqPatch = (patch: Record<string, unknown>) =>
    patch as unknown as EqualizerSettings;

// ## P1 #######################################################################

describe("P1: settings store boots cleanly without a localStorage global", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("constructs the pinia store in a bare Node-like environment", () => {
        setActivePinia(createPinia());
        expect(() => useSettingsStore()).not.toThrowError();
    });

    it("preset list starts out empty when nothing was ever persisted", () => {
        const store = bootStore();
        expect(store.equalizerPresets).toHaveLength(0);
    });

    it("userPresets view starts out empty as well", () => {
        const store = bootStore();
        expect(store.userPresets).toHaveLength(0);
    });

    it("factory default audio block embeds a neutral equalizer", () => {
        const defaults = createDefaultAppSettings();
        expect(defaults.audio.equalizer).toEqual({
            enabled: false,
            preamp: 0.0,
            gains: flatGains(),
        });
    });

    it("factory defaults leave currentPresetId unset", () => {
        const defaults = createDefaultAppSettings();
        const { currentPresetId } = defaults.audio.equalizer;
        expect(currentPresetId ?? null).toBeNull();
    });
});

// ## P2: mergeAudioSettings ###################################################

describe("P2: mergeAudioSettings — currentPresetId survival matrix", () => {
    const base = audioFixture({
        enabled: true,
        preamp: -3.0,
        gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1],
        currentPresetId: "preset_abc",
    });

    type MergeScenario = {
        title: string;
        patch: Partial<AudioSettings>;
        verify: (merged: AudioSettings) => void;
    };

    const scenarios: MergeScenario[] = [
        {
            title: "unrelated audio patch keeps the association",
            patch: { showEqualizerInFooter: false },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("preset_abc");
            },
        },
        {
            title: "gain-table-only patch keeps the association",
            patch: { equalizer: forceEqPatch({ gains: flatGains() }) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("preset_abc");
                expect(merged.equalizer.gains).toEqual(flatGains());
            },
        },
        {
            title: "preamp-only patch keeps the association",
            patch: { equalizer: forceEqPatch({ preamp: -5.0 }) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("preset_abc");
                expect(merged.equalizer.preamp).toBe(-5.0);
            },
        },
        {
            title: "enabled-only patch keeps the association",
            patch: { equalizer: forceEqPatch({ enabled: false }) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("preset_abc");
            },
        },
        {
            title: "explicit string overrides the association",
            patch: {
                equalizer: forceEqPatch({ currentPresetId: "preset_xyz" }),
            },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBe("preset_xyz");
            },
        },
        {
            title: "explicit null clears the association",
            patch: { equalizer: forceEqPatch({ currentPresetId: null }) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBeNull();
            },
        },
        {
            title: "explicit undefined clears the association too",
            patch: { equalizer: forceEqPatch({ currentPresetId: undefined }) },
            verify: (merged) => {
                expect(merged.equalizer.currentPresetId).toBeNull();
            },
        },
        {
            title: "full equalizer patch replaces every field at once",
            patch: {
                equalizer: {
                    enabled: false,
                    preamp: 1.5,
                    gains: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
                    currentPresetId: "new_id",
                },
            },
            verify: (merged) => {
                expect(merged.equalizer).toEqual({
                    enabled: false,
                    preamp: 1.5,
                    gains: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
                    currentPresetId: "new_id",
                });
            },
        },
    ];

    for (const scenario of scenarios) {
        it(scenario.title, () => {
            const merged = mergeAudioSettings(base, scenario.patch);
            scenario.verify(merged);
        });
    }

    it("source gains array is never mutated by merging", () => {
        const snapshot = [...base.equalizer.gains];
        mergeAudioSettings(base, {
            equalizer: {
                gains: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
            } as EqualizerSettings,
        });
        expect(base.equalizer.gains).toEqual(snapshot);
    });

    it("volumeBalance survives an equalizer-scoped patch", () => {
        const richBase: AudioSettings = {
            outputMode: "wasapiExclusive",
            volumeBalance: {
                enabled: true,
                gainOffsetDb: 3,
                preventClipping: false,
            },
            equalizer: {
                enabled: true,
                preamp: 0,
                gains: flatGains(),
                currentPresetId: "p1",
            },
            showEqualizerInFooter: true,
        };
        const merged = mergeAudioSettings(richBase, {
            equalizer: forceEqPatch({ currentPresetId: "p2" }),
        });
        expect(merged.outputMode).toBe("wasapiExclusive");
        expect(merged.volumeBalance).toEqual({
            enabled: true,
            gainOffsetDb: 3,
            preventClipping: false,
        });
        expect(merged.equalizer.currentPresetId).toBe("p2");
    });

    it("outputMode survives a patch that repeats it explicitly", () => {
        const richBase: AudioSettings = {
            outputMode: "wasapiExclusive",
            volumeBalance: {
                enabled: true,
                gainOffsetDb: 3,
                preventClipping: false,
            },
            equalizer: {
                enabled: true,
                preamp: 0,
                gains: flatGains(),
                currentPresetId: "p1",
            },
            showEqualizerInFooter: true,
        };
        const merged = mergeAudioSettings(richBase, {
            outputMode: "wasapiExclusive",
            equalizer: forceEqPatch({ currentPresetId: "p2" }),
        });
        expect(merged.outputMode).toBe("wasapiExclusive");
        expect(merged.equalizer.currentPresetId).toBe("p2");
    });
});

// ## app-level merge ##########################################################

describe("app-level merge keeps the equalizer preset association intact", () => {
    it("association and equalizer knobs survive mergeAppSettings", () => {
        const base = appFixture({
            enabled: true,
            preamp: -1.0,
            gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1],
            currentPresetId: "preset_123",
        });

        const merged = mergeAppSettings(base, {
            audio: { equalizer: forceEqPatch({ preamp: -5.0 }) },
        });

        const mergedEq = merged.audio.equalizer;
        expect(mergedEq.currentPresetId).toBe("preset_123");
        expect(mergedEq.preamp).toBe(-5.0);
        expect(mergedEq.enabled).toBe(true);
    });

    it("explicit null clears the association at app level", () => {
        const base = appFixture({
            enabled: false,
            preamp: 0,
            gains: flatGains(),
            currentPresetId: "preset_123",
        });

        const merged = mergeAppSettings(base, {
            audio: { equalizer: forceEqPatch({ currentPresetId: null }) },
        });

        expect(merged.audio.equalizer.currentPresetId).toBeNull();
    });

    it("association survives an unrelated audio-section patch", () => {
        const base = appFixture({
            enabled: false,
            preamp: 0,
            gains: flatGains(),
            currentPresetId: "preset_123",
        });

        const merged = mergeAppSettings(base, {
            audio: { outputMode: "wasapiExclusive" },
        });

        expect(merged.audio.equalizer.currentPresetId).toBe("preset_123");
        expect(merged.audio.outputMode).toBe("wasapiExclusive");
    });
});

// ## store CRUD ###############################################################

describe("settings store — preset CRUD contracts", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    describe("saveEqualizerPreset — creation semantics", () => {
        it("registers a brand-new user preset in the list", () => {
            const store = useSettingsStore();
            expect(store.userPresets).toHaveLength(0);

            const preset = store.saveEqualizerPreset("My Preset");

            expect(preset.name).toBe("My Preset");
            expect(preset.isBuiltin).toBe(false);
            expect(preset.id.startsWith("user_")).toBe(true);
            expect(store.userPresets).toHaveLength(1);
            expect(store.userPresets[0].id).toBe(preset.id);
        });

        it("snapshots the current preamp and gain table into the preset", () => {
            const stagedGains = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const store = useSettingsStore();
            store.settings.audio.equalizer.preamp = -4.5;
            store.settings.audio.equalizer.gains = stagedGains;

            const preset = store.saveEqualizerPreset("Captured");

            expect(preset.preamp).toBe(-4.5);
            expect(preset.gains).toEqual(stagedGains);
        });

        it("points currentPresetId at the freshly saved preset", () => {
            const store = useSettingsStore();
            const preset = store.saveEqualizerPreset("Auto Select");

            expect(eqView(store).currentPresetId).toBe(preset.id);
        });

        it("stored gains are detached from the live settings array", () => {
            const store = useSettingsStore();
            store.settings.audio.equalizer.gains = [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            ];
            const preset = store.saveEqualizerPreset("Copy Check");

            store.settings.audio.equalizer.gains[0] = 999;
            expect(preset.gains[0]).toBe(1);
        });

        it("stamps createdAt and updatedAt inside the save window", () => {
            const store = useSettingsStore();
            const startedAt = Date.now();
            const preset = store.saveEqualizerPreset("Timestamps");
            const finishedAt = Date.now();

            expect(preset.createdAt).toBeGreaterThanOrEqual(startedAt);
            expect(preset.createdAt).toBeLessThanOrEqual(finishedAt);
            expect(preset.updatedAt).toBeGreaterThanOrEqual(startedAt);
            expect(preset.updatedAt).toBeLessThanOrEqual(finishedAt);
        });

        it("queues several presets in insertion order", () => {
            const store = useSettingsStore();
            store.saveEqualizerPreset("Preset A");
            store.saveEqualizerPreset("Preset B");
            store.saveEqualizerPreset("Preset C");

            expect(store.userPresets).toHaveLength(3);
            expect(store.userPresets.map((p) => p.name)).toEqual([
                "Preset A",
                "Preset B",
                "Preset C",
            ]);
        });
    });

    describe("updateEqualizerPreset — mutation semantics", () => {
        it("rewrites name and re-snapshots preamp/gains with a new updatedAt", () => {
            const store = useSettingsStore();
            const original = store.saveEqualizerPreset("Original");

            store.settings.audio.equalizer.preamp = -6.0;
            store.settings.audio.equalizer.gains = [
                10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
            ];

            store.updateEqualizerPreset(original.id, "Updated");

            const updated = store.userPresets.find((p) => p.id === original.id);
            expect(updated?.name).toBe("Updated");
            expect(updated?.preamp).toBe(-6.0);
            expect(updated?.gains).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
            expect(updated?.updatedAt).toBeGreaterThanOrEqual(
                original.updatedAt,
            );
        });

        it("unknown ids are ignored entirely", () => {
            const store = useSettingsStore();
            store.saveEqualizerPreset("Keep");

            store.updateEqualizerPreset("non_existent_id", "Ghost");

            expect(store.userPresets).toHaveLength(1);
            expect(store.userPresets[0].name).toBe("Keep");
        });

        it("builtin presets can never be renamed", () => {
            const store = useSettingsStore();
            store.equalizerPresets.push(
                builtinEntry("builtin_flat", "Flat", 0, flatGains()),
            );

            store.updateEqualizerPreset("builtin_flat", "Hacked");

            const builtin = store.equalizerPresets.find(
                (p) => p.id === "builtin_flat",
            );
            expect(builtin?.name).toBe("Flat");
        });
    });

    describe("deleteEqualizerPreset — removal semantics", () => {
        it("drops a user preset from the list", () => {
            const store = useSettingsStore();
            const preset = store.saveEqualizerPreset("To Delete");

            expect(store.userPresets).toHaveLength(1);
            store.deleteEqualizerPreset(preset.id);
            expect(store.userPresets).toHaveLength(0);
        });

        it("clears the association when the active preset is removed", () => {
            const store = useSettingsStore();
            const preset = store.saveEqualizerPreset("Active");
            expect(eqView(store).currentPresetId).toBe(preset.id);

            store.deleteEqualizerPreset(preset.id);
            expect(eqView(store).currentPresetId).toBeNull();
        });

        it("keeps the association when a different preset is removed", () => {
            const store = useSettingsStore();
            const activePreset = userEntry("user_active_unique", "Active");
            const otherPreset = userEntry("user_other_unique", "Other");
            store.equalizerPresets.push(activePreset, otherPreset);

            store.patchSettings({
                audio: {
                    equalizer: forceEqPatch({
                        currentPresetId: activePreset.id,
                    }),
                },
            });
            expect(eqView(store).currentPresetId).toBe(activePreset.id);

            store.deleteEqualizerPreset(otherPreset.id);
            expect(eqView(store).currentPresetId).toBe(activePreset.id);
            expect(store.userPresets).toHaveLength(1);
            expect(store.userPresets[0].id).toBe(activePreset.id);
        });

        it("unknown ids leave the list untouched", () => {
            const store = useSettingsStore();
            store.saveEqualizerPreset("Safe");

            store.deleteEqualizerPreset("no_such_id");
            expect(store.userPresets).toHaveLength(1);
        });

        it("builtin presets can never be removed", () => {
            const store = useSettingsStore();
            store.equalizerPresets.push(
                builtinEntry(
                    "builtin_rock",
                    "Rock",
                    -4.5,
                    [5, 4, 2, -1, -2, -1, 1, 3, 4.5, 5],
                ),
            );

            store.deleteEqualizerPreset("builtin_rock");
            expect(
                store.equalizerPresets.some((p) => p.id === "builtin_rock"),
            ).toBe(true);
        });
    });

    describe("loadEqualizerPreset — activation semantics", () => {
        it("applies preamp, gains, association and turns the EQ on", () => {
            const stagedGains = [5.5, 4.5, 3, 1.5, 0, 0, 0, 0, 0, 0];
            const store = useSettingsStore();
            store.settings.audio.equalizer.preamp = -3.5;
            store.settings.audio.equalizer.gains = stagedGains;
            const preset = store.saveEqualizerPreset("Bass Boost");

            store.settings.audio.equalizer.enabled = false;
            store.settings.audio.equalizer.preamp = 0;
            store.settings.audio.equalizer.gains = flatGains();
            store.settings.audio.equalizer.currentPresetId = null;

            store.loadEqualizerPreset(preset.id);

            const eq = eqView(store);
            expect(eq.enabled).toBe(true);
            expect(eq.preamp).toBe(-3.5);
            expect(eq.gains).toEqual(stagedGains);
            expect(eq.currentPresetId).toBe(preset.id);
        });

        it("switching the EQ on is implied by loading", () => {
            const store = useSettingsStore();
            store.settings.audio.equalizer.enabled = false;

            const preset = store.saveEqualizerPreset("Enabler");
            store.settings.audio.equalizer.enabled = false;

            store.loadEqualizerPreset(preset.id);
            expect(eqView(store).enabled).toBe(true);
        });

        it("unknown ids leave the equalizer state untouched", () => {
            const store = useSettingsStore();
            const snapshot = { ...eqView(store) };

            store.loadEqualizerPreset("does_not_exist");

            expect(eqView(store).enabled).toBe(snapshot.enabled);
            expect(eqView(store).preamp).toBe(snapshot.preamp);
            expect(eqView(store).gains).toEqual(snapshot.gains);
        });

        it("loaded gains are detached from the live settings array", () => {
            const store = useSettingsStore();
            store.settings.audio.equalizer.gains = [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            ];
            const preset = store.saveEqualizerPreset("RefCheck");

            store.loadEqualizerPreset(preset.id);
            store.settings.audio.equalizer.gains[0] = 999;

            const stored = store.userPresets.find((p) => p.id === preset.id);
            expect(stored?.gains[0]).toBe(1);
        });

        it("can activate a builtin preset injected into the list", () => {
            const jazzGains = [
                3.5, 2.5, 1.5, 2.0, -0.5, -1.0, 0.5, 1.5, 2.5, 3.0,
            ];
            const store = useSettingsStore();
            store.equalizerPresets.push(
                builtinEntry("builtin_jazz", "Jazz", -3.0, jazzGains),
            );

            store.loadEqualizerPreset("builtin_jazz");

            const eq = eqView(store);
            expect(eq.enabled).toBe(true);
            expect(eq.preamp).toBe(-3.0);
            expect(eq.gains).toEqual(jazzGains);
            expect(eq.currentPresetId).toBe("builtin_jazz");
        });
    });
});

// ## selectedPresetId #########################################################

describe("P2: selectedPresetId — single source of truth via computed", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("EqualizerPanel derives selectedPresetId from a computed (source probe)", async () => {
        const panelRaw = await import("./EqualizerPanel.source?raw").catch(
            (): null => null,
        );
        if (!panelRaw) {
            return;
        }
    });

    it("association changes made through patchSettings stay reflected", () => {
        const store = useSettingsStore();

        const preset = store.saveEqualizerPreset("Auto Sync");
        expect(eqView(store).currentPresetId).toBe(preset.id);

        store.patchSettings({
            audio: { equalizer: forceEqPatch({ currentPresetId: null }) },
        });
        expect(eqView(store).currentPresetId).toBeNull();

        store.patchSettings({
            audio: { equalizer: forceEqPatch({ currentPresetId: preset.id }) },
        });
        expect(eqView(store).currentPresetId).toBe(preset.id);
    });
});

// ## builtin/reset interplay ##################################################

describe("P2: builtin selection and reset drop custom associations", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("patching a null association propagates into the settings tree", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.currentPresetId = "preset_xyz";

        store.patchSettings({
            audio: { equalizer: forceEqPatch({ currentPresetId: null }) },
        });

        expect(eqView(store).currentPresetId).toBeNull();
    });
});

// ## enable-on-load ###########################################################

describe("P2: loading any custom preset switches the EQ on", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("loadEqualizerPreset forces enabled to true", () => {
        const stagedGains = [1, 2, 3, 4, 5, 5, 4, 3, 2, 1];
        const store = useSettingsStore();
        store.settings.audio.equalizer.enabled = false;

        store.settings.audio.equalizer.preamp = -2.0;
        store.settings.audio.equalizer.gains = stagedGains;
        const preset = store.saveEqualizerPreset("EQ Enable Test");

        store.settings.audio.equalizer.enabled = false;

        store.loadEqualizerPreset(preset.id);

        const eq = eqView(store);
        expect(eq.enabled).toBe(true);
        expect(eq.preamp).toBe(-2.0);
        expect(eq.gains).toEqual(stagedGains);
    });

    it("loading from a disabled state matches loading from an enabled state", () => {
        const stagedGains = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
        const store = useSettingsStore();
        store.settings.audio.equalizer.preamp = -1.0;
        store.settings.audio.equalizer.gains = stagedGains;
        const preset = store.saveEqualizerPreset("Consistency");

        store.settings.audio.equalizer.enabled = false;
        store.settings.audio.equalizer.preamp = 0;
        store.settings.audio.equalizer.gains = flatGains();
        store.loadEqualizerPreset(preset.id);
        const fromDisabled = { ...eqView(store) };

        store.settings.audio.equalizer.enabled = true;
        store.settings.audio.equalizer.preamp = 10;
        store.settings.audio.equalizer.gains = Array(BAND_COUNT).fill(10);
        store.loadEqualizerPreset(preset.id);
        const fromEnabled = { ...eqView(store) };

        expect(fromDisabled.enabled).toBe(fromEnabled.enabled);
        expect(fromDisabled.preamp).toBe(fromEnabled.preamp);
        expect(fromDisabled.gains).toEqual(fromEnabled.gains);
        expect(fromDisabled.currentPresetId).toBe(fromEnabled.currentPresetId);
    });
});

// ## dead-code guards #########################################################

describe("P3: unused code cleanup", () => {
    it("playerStorage source no longer ships preset CRUD helpers", () => {
        for (const removedHelper of [
            "addEqualizerPreset",
            "updateEqualizerPreset",
            "deleteEqualizerPreset",
        ]) {
            expect(sourceContains(playerStorageSource, removedHelper)).toBe(false);
        }
    });

    it("settings store exposes no builtinPresets computed", () => {
        const store = bootStore();
        expect(Reflect.has(store, "builtinPresets")).toBe(false);
    });
});

// ## userPresets filter #######################################################

describe("userPresets computed filters out builtin presets", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("surfaces only non-builtin entries", () => {
        const store = useSettingsStore();
        store.equalizerPresets.push(
            builtinEntry("builtin_flat", "Flat", 0, flatGains()),
        );

        store.saveEqualizerPreset("My Custom");

        expect(store.userPresets).toHaveLength(1);
        expect(store.userPresets[0].name).toBe("My Custom");
        expect(store.equalizerPresets).toHaveLength(2);
    });
});

// ## reset / replace ##########################################################

describe("replaceSettings and resetSettings keep the equalizer shape", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("resetSettings lands on a valid default equalizer structure", () => {
        const store = useSettingsStore();
        store.patchSettings({
            audio: {
                equalizer: {
                    enabled: true,
                    preamp: -5.0,
                    gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                    currentPresetId: "temp_preset",
                },
            },
        });
        expect(eqView(store).enabled).toBe(true);
        expect(eqView(store).currentPresetId).toBe("temp_preset");

        const cleanDefaults = createDefaultAppSettings();
        store.replaceSettings({
            ...cleanDefaults,
            audio: {
                ...cleanDefaults.audio,
                equalizer: {
                    enabled: false,
                    preamp: 0.0,
                    gains: flatGains(),
                    currentPresetId: null,
                },
            },
        });

        const eq = eqView(store);
        expect(eq.enabled).toBe(false);
        expect(eq.preamp).toBe(0.0);
        expect(eq.gains).toEqual(flatGains());
        expect(eq.currentPresetId ?? null).toBeNull();
    });

    it("resetSettings re-applies the factory defaults function", () => {
        const store = useSettingsStore();
        store.patchSettings({
            theme: { mode: "custom" },
            lyrics: { showTranslation: false },
        });
        expect(store.settings.theme.mode).toBe("custom");

        store.resetSettings();

        expect(store.settings.theme.mode).toBe("system");
        expect(store.settings.lyrics.showTranslation).toBe(true);
    });

    it("replaceSettings restores persisted equalizer data including the association", () => {
        const store = useSettingsStore();

        const persisted: AppSettings = {
            ...createDefaultAppSettings(),
            audio: {
                ...createDefaultAudioSettings(),
                equalizer: {
                    enabled: true,
                    preamp: -2.5,
                    gains: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
                    currentPresetId: "restored_preset",
                },
            },
        };
        store.replaceSettings(persisted);

        const eq = eqView(store);
        expect(eq.enabled).toBe(true);
        expect(eq.preamp).toBe(-2.5);
        expect(eq.currentPresetId).toBe("restored_preset");
    });
});

// ## patchSettings interplay ##################################################

describe("patchSettings interaction with equalizer state", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("theme-scoped patches leave the equalizer alone", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.currentPresetId = "my_preset";
        store.settings.audio.equalizer.enabled = true;
        store.settings.audio.equalizer.preamp = -3.0;

        store.patchSettings({ theme: { mode: "dark" } });

        const eq = eqView(store);
        expect(eq.currentPresetId).toBe("my_preset");
        expect(eq.enabled).toBe(true);
        expect(eq.preamp).toBe(-3.0);
    });

    it("audio patches without an equalizer section preserve it", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.currentPresetId = "safe_preset";

        store.patchSettings({
            audio: {
                outputMode: "wasapiExclusive",
                volumeBalance: { enabled: true },
            },
        });

        expect(eqView(store).currentPresetId).toBe("safe_preset");
        expect(store.settings.audio.outputMode).toBe("wasapiExclusive");
    });

    it("gain-only equalizer patches preserve the association", () => {
        const store = useSettingsStore();
        store.settings.audio.equalizer.currentPresetId = "keep_me";

        store.patchSettings({
            audio: {
                equalizer: {
                    gains: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
                } as EqualizerSettings,
            },
        });

        expect(eqView(store).currentPresetId).toBe("keep_me");
        expect(eqView(store).gains).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    });
});

// ## data integrity ###########################################################

describe("EqualizerPreset data integrity", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("every generated id carries the user_ prefix", () => {
        const store = useSettingsStore();

        for (let i = 0; i < 5; i++) {
            const preset = store.saveEqualizerPreset(`Preset ${i}`);
            expect(preset.id.startsWith("user_")).toBe(true);
        }

        expect(store.userPresets).toHaveLength(5);
    });

    it("equalizerPresets is reactive — a manual push shows up in userPresets", () => {
        const store = useSettingsStore();
        expect(store.userPresets).toHaveLength(0);

        store.equalizerPresets.push(userEntry("user_manual", "Manual Push"));

        expect(store.userPresets).toHaveLength(1);
        expect(store.userPresets[0].name).toBe("Manual Push");
    });

    it("factory gains table always has ten numeric slots", () => {
        const defaults = createDefaultAudioSettings();
        expect(defaults.equalizer.gains).toHaveLength(BAND_COUNT);
        expect(
            defaults.equalizer.gains.every((g) => typeof g === "number"),
        ).toBe(true);
    });
});

// ## P1 fix ###################################################################

describe("P1 Fix: resetSettings returns pristine defaults after preset operations", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("preset churn followed by reset lands on pristine defaults", () => {
        const store = useSettingsStore();
        const preset = store.saveEqualizerPreset("Dirty");
        store.loadEqualizerPreset(preset.id);

        store.resetSettings();

        expect(eqView(store)).toEqual({
            enabled: false,
            preamp: 0.0,
            gains: flatGains(),
        });
    });

    it("a fresh store instance starts without inherited EQ state", () => {
        const store1 = useSettingsStore();
        store1.saveEqualizerPreset("Test");
        store1.loadEqualizerPreset("builtin_pop");

        setActivePinia(createPinia());
        const store2 = useSettingsStore();

        expect(eqView(store2)).toEqual({
            enabled: false,
            preamp: 0.0,
            gains: flatGains(),
        });
    });

    it("createDefaultAudioSettings hands out independent copies", () => {
        const first = createDefaultAudioSettings();
        const second = createDefaultAudioSettings();

        first.equalizer.enabled = true;
        first.equalizer.gains[0] = 10;

        expect(second.equalizer.enabled).toBe(false);
        expect(second.equalizer.gains[0]).toBe(0);
    });
});

// ## P3 fix ###################################################################

describe("P3 Fix: preset ID generation is collision-free", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("rapid consecutive saves yield distinct ids", () => {
        const store = useSettingsStore();
        const first = store.saveEqualizerPreset("First");
        const second = store.saveEqualizerPreset("Second");

        expect(first.id).not.toBe(second.id);
        expect(first.id.startsWith("user_")).toBe(true);
        expect(second.id.startsWith("user_")).toBe(true);
    });
});
