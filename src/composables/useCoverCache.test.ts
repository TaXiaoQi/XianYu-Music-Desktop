import { beforeEach, describe, expect, it, vi } from "vitest";

// @tauri-apps/api/core 的桩：fileApi 底层经 tauriInvoke 转发到这里的 invoke。
const coreModuleStubs = vi.hoisted(() => {
    const invoke = vi.fn();
    const convertFileSrc = vi.fn((path: string) => `asset://${path}`);
    return { invoke, convertFileSrc };
});

vi.mock("@tauri-apps/api/core", () => coreModuleStubs);

function makeDeferred<T>() {
    let release!: (value: T) => void;
    let fail!: (error: unknown) => void;
    const promise = new Promise<T>((done, abort) => {
        release = done;
        fail = abort;
    });

    return { promise, resolve: release, reject: fail };
}

// 每个用例前都 resetModules，这里封装“动态加载模块并创建缓存实例”的公共步骤。
const loadCoverCache = async () => {
    const cacheModule = await import("./useCoverCache");
    return cacheModule.useCoverCache();
};

describe("useCoverCache", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        coreModuleStubs.convertFileSrc.mockImplementation(
            (path: string) => `asset://${path}`,
        );
    });

    it("keeps retained in-flight full cover requests valid", async () => {
        const path = "/music/current.flac";
        const coverPath = "C:\\covers\\current.png";
        const pending = makeDeferred<string>();
        coreModuleStubs.invoke.mockReturnValueOnce(pending.promise);

        const coverCache = await loadCoverCache();
        const request = coverCache.loadFullCover(path);

        coverCache.retainFullCoverPaths([path]);
        pending.resolve(coverPath);

        await expect(request).resolves.toBe(`asset://${coverPath}`);
        expect(coverCache.getFullCoverUrl(path)).toBe(`asset://${coverPath}`);
    });

    it("drops in-flight full cover requests whose paths fall outside the retained set", async () => {
        const stalePath = "/music/old.flac";
        const keptPath = "/music/current.flac";
        const pending = makeDeferred<string>();
        coreModuleStubs.invoke.mockReturnValueOnce(pending.promise);

        const coverCache = await loadCoverCache();
        const request = coverCache.loadFullCover(stalePath);

        coverCache.retainFullCoverPaths([keptPath]);
        pending.resolve("C:\\covers\\old.png");

        await expect(request).resolves.toBe("");
        expect(coverCache.getFullCoverUrl(stalePath)).toBe("");
    });

    it("runs queued full cover preloads strictly one at a time", async () => {
        const first = makeDeferred<string>();
        const second = makeDeferred<string>();
        coreModuleStubs.invoke
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const coverCache = await loadCoverCache();

        coverCache.preloadFullCovers([
            "/music/first.flac",
            "/music/second.flac",
        ]);

        expect(coreModuleStubs.invoke).toHaveBeenCalledTimes(1);
        expect(coreModuleStubs.invoke).toHaveBeenLastCalledWith(
            "get_song_cover",
            { path: "/music/first.flac" },
        );

        first.resolve("C:\\covers\\first.png");
        await first.promise;
        await Promise.resolve();

        expect(coreModuleStubs.invoke).toHaveBeenCalledTimes(2);
        expect(coreModuleStubs.invoke).toHaveBeenLastCalledWith(
            "get_song_cover",
            { path: "/music/second.flac" },
        );

        second.resolve("C:\\covers\\second.png");
        await second.promise;
    });

    it("serves a primed thumbnail path without hitting the backend", async () => {
        const path = "/music/current.flac";
        const coverPath = "C:\\covers\\current-thumb.jpg";

        const coverCache = await loadCoverCache();

        expect(coverCache.primeCoverPath(path, coverPath)).toBe(
            `asset://${coverPath}`,
        );
        await expect(coverCache.loadCover(path)).resolves.toBe(
            `asset://${coverPath}`,
        );
        expect(coreModuleStubs.invoke).not.toHaveBeenCalled();
    });
});
