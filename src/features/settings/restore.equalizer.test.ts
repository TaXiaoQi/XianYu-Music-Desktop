/*
 * 聚焦均衡器块的持久化恢复行为：currentPresetId 关联的回填与降级语义。
 */

import type { AppSettings } from "../../types";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultAppSettings, useSettingsStore } from "./store";
import { restorePersistedAppSettings } from "./restore";

type EqConfig = AppSettings["audio"]["equalizer"];

// 建库并在其上执行一次恢复，返回 store 供断言
const restoreOntoStore = (readPersisted: () => AppSettings | null) => {
    const settingsStore = useSettingsStore(); // 实现
    restorePersistedAppSettings(
        settingsStore.settings,
        settingsStore.replaceSettings,
        readPersisted,
    );
    return settingsStore;
};

// 以默认设置为底、仅替换均衡器块，构造持久化输入
const persistedAudioWithEq = (equalizer: EqConfig): AppSettings => {
    const seed = createDefaultAppSettings();
    return { ...seed, audio: { ...seed.audio, equalizer } };
};

describe("均衡器 currentPresetId 的恢复往返", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("预设关联与增益曲线一并回填", () => {
        const restoredGains = [5.5, 4.5, 3, 1.5, 0, 0, 0, 0, 0, 0];
        const persisted = persistedAudioWithEq({
            enabled: true,
            preamp: -3.5,
            gains: restoredGains,
            currentPresetId: "restored_preset_id",
        });

        const settingsStore = restoreOntoStore(() => persisted);

        const eq = settingsStore.settings.audio.equalizer;
        expect(eq.currentPresetId).toBe("restored_preset_id");
        expect(eq.enabled).toBe(true);
        expect(eq.preamp).toBe(-3.5);
        expect(eq.gains).toEqual(restoredGains);
    });

    it("旧数据缺少预设关联时降级为 null", () => {
        const persisted = persistedAudioWithEq({
            enabled: false,
            preamp: 0,
            gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        });

        const settingsStore = restoreOntoStore(() => persisted);

        expect(
            settingsStore.settings.audio.equalizer.currentPresetId ?? null,
        ).toBeNull();
    });

    it("读取结果为 null 时 store 原样保留", () => {
        const settingsStore = useSettingsStore();
        const snapshot = { ...settingsStore.settings.audio.equalizer };

        restoreOntoStore(() => null);

        expect(settingsStore.settings.audio.equalizer).toEqual(snapshot);
    });

    it("恢复均衡器的同时不影响相邻音频设置", () => {
        const seed = createDefaultAppSettings();
        const persisted: AppSettings = {
            ...seed,
            audio: {
                ...seed.audio,
                outputMode: "wasapiExclusive",
                volumeBalance: {
                    enabled: true,
                    gainOffsetDb: 5,
                    preventClipping: false,
                },
                equalizer: {
                    enabled: true,
                    preamp: -1.0,
                    gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
                    currentPresetId: "eq_preset",
                },
                showEqualizerInFooter: false,
            },
        };

        const settingsStore = restoreOntoStore(() => persisted);

        const audio = settingsStore.settings.audio;
        expect(audio.outputMode).toBe("wasapiExclusive");
        expect(audio.volumeBalance.enabled).toBe(true);
        expect(audio.equalizer.currentPresetId).toBe("eq_preset");
        expect(audio.showEqualizerInFooter).toBe(false);
    });
});
