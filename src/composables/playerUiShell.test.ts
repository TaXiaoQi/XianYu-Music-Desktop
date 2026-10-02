import { describe, expect, it } from "vitest";

import { getNextWheelVolume } from "../features/playback/playerUiShell";

// 表格化用例：输入（当前音量, 滚轮增量）与期望输出，数值即行为规格
const wheelCases: Array<{
    title: string;
    volume: number;
    delta: number;
    expected: number;
}> = [
    { title: "每档滚轮调整 1%", volume: 50, delta: -120, expected: 51 },
    { title: "反方向滚轮同样每档 1%", volume: 50, delta: 120, expected: 49 },
    { title: "已达上限时不再增加", volume: 100, delta: -120, expected: 100 },
    { title: "已达下限时不再减少", volume: 0, delta: 120, expected: 0 },
];

describe("getNextWheelVolume：滚轮调节音量", () => {
    it.each(wheelCases)("$title", ({ volume, delta, expected }) => {
        expect(getNextWheelVolume(volume, delta)).toBe(expected);
    });
});
