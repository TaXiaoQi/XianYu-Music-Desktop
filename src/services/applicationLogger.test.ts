import { describe, expect, it, beforeEach } from "vitest";

import {
    analyzeApplicationLogs,
    clearApplicationLogs,
    filterLogEntriesForRetention,
    formatApplicationLogExport,
    logApplicationEvent,
    useApplicationLogs,
    type ApplicationLogEntry,
} from "./applicationLogger";

const createEntry = ( // 实现
    level: ApplicationLogEntry["level"],
    timestamp: number,
    category = "player",
): ApplicationLogEntry => ({ // 实现
    id: `${level}-${timestamp}`,
    timestamp,
    level,
    category,
    scope: "main",
    message: `${level} message`,
});

describe("application logger", () => {
    it("keeps entries within the count-based retention limits (last 200 total, last 10 errors)", () => {
        const now = Date.UTC(2026, 7, 2, 12, 0, 0);
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const cutoff = startOfToday.getTime();

        const entries = [
            createEntry("info", cutoff - 2 * 60 * 60 * 1000), // 前一天 22:00
            createEntry("warn", cutoff + 6 * 60 * 60 * 1000),
        ];

        expect(filterLogEntriesForRetention(entries, 1, now)).toEqual([
            entries[0],
            entries[1],
        ]);
    });

    it("classifies errors as critical and identifies their main feature category", () => {
        const analysis = analyzeApplicationLogs([
            createEntry("warn", 1, "network"),
            createEntry("error", 2, "playback"),
            createEntry("error", 3, "playback"),
        ]);

        expect(analysis.status).toBe("critical");
        expect(analysis.counts.error).toBe(2);
        expect(analysis.topErrorCategory).toBe("playback");
    });

    it("exports only error entries for the error-log export", () => {
        const entries = [createEntry("info", 1), createEntry("error", 2)];
        const content = formatApplicationLogExport(entries, "error");

        expect(content).toContain("[ERROR]");
        expect(content).not.toContain("[INFO]");
        expect(content).toContain("导出范围：错误日志");
    });
});

describe("logApplicationEvent", () => {
    beforeEach(() => {
        clearApplicationLogs();
    });

    it("appends an error entry visible through useApplicationLogs", () => {
        logApplicationEvent(
            "error",
            "网络请求",
            "signedRequest",
            "action=get_daily_recommend code=403 签名验证失败",
        );

        const { entries } = useApplicationLogs();
        expect(entries.value).toHaveLength(1);
        expect(entries.value[0]).toMatchObject({
            level: "error",
            category: "网络请求",
            scope: "signedRequest",
            message: "action=get_daily_recommend code=403 签名验证失败",
        });
        expect(entries.value[0].timestamp).toBeGreaterThan(0);
    });

    it("filters entries below the default minimum level (info)", () => {
        logApplicationEvent(
            "debug",
            "网络请求",
            "signedRequest",
            "debug detail",
        );

        const { entries } = useApplicationLogs();
        expect(entries.value).toHaveLength(0);
    });

    it("keeps the total entry count within the retention cap", () => {
        for (let i = 0; i < 305; i += 1) {
            logApplicationEvent("info", "network", "test", `entry ${i}`);
        }

        const { entries } = useApplicationLogs();
        expect(entries.value.length).toBeLessThanOrEqual(300);
        expect(entries.value[entries.value.length - 1].message).toBe(
            "entry 304",
        );
    });
});
