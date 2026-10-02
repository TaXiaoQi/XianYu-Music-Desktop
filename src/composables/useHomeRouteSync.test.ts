import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    effectScope,
    nextTick,
    reactive,
    ref,
    type EffectScope,
    type Ref,
} from "vue";
import type {
    LocationQuery,
    RouteLocationNormalizedLoaded,
    Router,
} from "vue-router";

import type { FolderNode } from "../types";
import { useHomeRouteSync } from "./useHomeRouteSync";
import { useHomeViewState } from "./useHomeViewState";

/** 构造目录树节点，文件名截取自路径末段 */
const makeFolderNode = (
    path: string,
    overrides: Partial<FolderNode> = {},
): FolderNode => ({
    name: path.split("/").pop() || path,
    path,
    children: [],
    child_count: 0,
    children_loaded: true,
    song_count: 0,
    cover_song_path: null,
    is_expanded: false,
    ...overrides,
});

const createRoute = (
    path: string,
    query: LocationQuery = {},
): RouteLocationNormalizedLoaded =>
    reactive({ path, query }) as RouteLocationNormalizedLoaded;

const makeRouterStub = (): Router =>
    ({
        replace: vi.fn().mockResolvedValue(undefined),
    }) as unknown as Router;

interface HomeSyncSeed {
    routePath: string;
    routeQuery?: LocationQuery;
    viewMode: string;
    filter: string;
    folderFilter: string;
    rootPath: string | null;
    folders: FolderNode[];
    query: string;
}

interface HomeSyncHarness {
    route: RouteLocationNormalizedLoaded;
    router: Router;
    scope: EffectScope;
    state: {
        currentViewMode: Ref<string>;
        filterCondition: Ref<string>;
        currentFolderFilter: Ref<string>;
        activeRootPath: Ref<string | null>;
        folderTree: Ref<FolderNode[]>;
        searchQuery: Ref<string>;
    };
}

/** 在独立 effectScope 中挂载 useHomeRouteSync，并暴露各共享状态的 ref */
const mountHomeSync = (seed: HomeSyncSeed): HomeSyncHarness => {
    const route = createRoute(seed.routePath, seed.routeQuery);
    const router = makeRouterStub();
    const state = {
        currentViewMode: ref(seed.viewMode),
        filterCondition: ref(seed.filter),
        currentFolderFilter: ref(seed.folderFilter),
        activeRootPath: ref<string | null>(seed.rootPath),
        folderTree: ref(seed.folders),
        searchQuery: ref(seed.query),
    };
    const scope = effectScope();
    scope.run(() => {
        useHomeRouteSync({ route, router, ...state });
    });
    return { route, router, scope, state };
};

/** 模拟路由跳转：直接就地替换 route 的 path 与 query */
const setRoute = (
    route: RouteLocationNormalizedLoaded,
    path: string,
    query: LocationQuery = {},
) => {
    Object.assign(route, { path, query });
};

describe("useHomeRouteSync 首页路由同步", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keep-alive 场景：暂停的首页恢复后能正确接管 folder 视图", async () => {
        const harness = mountHomeSync({
            routePath: "/artists",
            viewMode: "artist",
            filter: "Existing Artist",
            folderFilter: "",
            rootPath: null,
            folders: [makeFolderNode("/music/library")],
            query: "persistent query",
        });

        let homeView!: ReturnType<typeof useHomeViewState>;
        const homeScope = effectScope();
        homeScope.run(() => {
            homeView = useHomeViewState({
                currentViewMode: harness.state.currentViewMode,
                filterCondition: harness.state.filterCondition,
                isManagementMode: ref(false),
            });
        });

        expect(homeView.localViewMode.value).toBe("artist");

        // 首页组件被 keep-alive 暂停期间，路由切到了 folder 视图
        homeScope.pause();
        setRoute(harness.route, "/", {
            view: "folder",
            folder: "/music/library/live",
        });

        await nextTick();

        expect(harness.state.currentViewMode.value).toBe("folder");
        expect(harness.state.filterCondition.value).toBe("");
        expect(harness.state.currentFolderFilter.value).toBe(
            "/music/library/live",
        );
        expect(harness.state.activeRootPath.value).toBe("/music/library");
        expect(harness.state.searchQuery.value).toBe("persistent query");
        expect(homeView.localViewMode.value).toBe("artist");
        expect(harness.router.replace).not.toHaveBeenCalled();

        homeScope.resume();
        await nextTick();

        expect(homeView.localViewMode.value).toBe("folder");

        homeScope.stop();
        harness.scope.stop();
    });

    it("folder 视图缺省 folder 参数时，自动补全第一个根目录并回写路由", async () => {
        const harness = mountHomeSync({
            routePath: "/",
            routeQuery: { view: "folder" },
            viewMode: "all",
            filter: "",
            folderFilter: "",
            rootPath: null,
            folders: [
                makeFolderNode("/music/root-a"),
                makeFolderNode("/music/root-b"),
            ],
            query: "persistent query",
        });

        await nextTick();

        expect(harness.state.currentViewMode.value).toBe("folder");
        expect(harness.state.currentFolderFilter.value).toBe("/music/root-a");
        expect(harness.state.activeRootPath.value).toBe("/music/root-a");
        expect(harness.state.searchQuery.value).toBe("persistent query");
        expect(harness.router.replace).toHaveBeenCalledWith({
            path: "/",
            query: { view: "folder", folder: "/music/root-a" },
        });

        harness.scope.stop();
    });

    it("从非首页回到纯首页时重置陈旧状态，但不清掉进行中的搜索词", async () => {
        const harness = mountHomeSync({
            routePath: "/artists",
            viewMode: "folder",
            filter: "",
            folderFilter: "/music/root-a/live",
            rootPath: "/music/root-a",
            folders: [makeFolderNode("/music/root-a")],
            query: "persistent query",
        });

        setRoute(harness.route, "/", {});

        await nextTick();

        expect(harness.state.currentViewMode.value).toBe("statistics");
        expect(harness.state.filterCondition.value).toBe("");
        expect(harness.state.currentFolderFilter.value).toBe(
            "/music/root-a/live",
        );
        expect(harness.state.activeRootPath.value).toBe("/music/root-a");
        expect(harness.state.searchQuery.value).toBe("persistent query");
        expect(harness.router.replace).not.toHaveBeenCalled();

        harness.scope.stop();
    });

    it("收藏页与最近播放页映射到共享的导航状态", async () => {
        const harness = mountHomeSync({
            routePath: "/favorites",
            viewMode: "folder",
            filter: "playlist-id",
            folderFilter: "/music/root-a/live",
            rootPath: "/music/root-a",
            folders: [makeFolderNode("/music/root-a")],
            query: "persistent query",
        });

        await nextTick();

        expect(harness.state.currentViewMode.value).toBe("favorites");
        expect(harness.state.filterCondition.value).toBe("");
        expect(harness.state.searchQuery.value).toBe("persistent query");
        expect(harness.router.replace).not.toHaveBeenCalled();

        setRoute(harness.route, "/recent", {});

        await nextTick();

        expect(harness.state.currentViewMode.value).toBe("recent");
        expect(harness.state.filterCondition.value).toBe("");
        expect(harness.state.searchQuery.value).toBe("persistent query");
        expect(harness.router.replace).not.toHaveBeenCalled();

        harness.scope.stop();
    });
});
