import { describe, expect, it } from "vitest";

import mainShellSource from "../components/layout/MainShell.vue?raw";
import sidebarSource from "../components/layout/Sidebar.vue?raw";
import routerSource from "../router/index.ts?raw";
import searchSource from "./Search.vue?raw";
import searchQuerySource from "../composables/search/useSearchQuery.ts?raw";
import { expectSourceContains, expectSourceNotContains } from "../testing/sourceText";

describe("Search page lifecycle", () => {
    it("destroys routed main pages after navigation instead of keeping them alive", () => {
        expectSourceNotContains(mainShellSource, "<KeepAlive");
        expectSourceContains(
            routerSource,
            "{ path: '/', name: 'Home', component: Home }",
        );
        expectSourceContains(
            routerSource,
            "{ path: '/search', name: 'Search', component: Search }",
        );
    });

    it("cleans up pending search work when the page is destroyed", () => {
        expectSourceContains(searchSource, "onBeforeUnmount(() => {");
        expectSourceContains(searchSource, "playbackStore.tempQueue = [];");
        expectSourceNotContains(searchSource, "onDeactivated(() => {");
        expectSourceContains(searchQuerySource, "onBeforeUnmount(() => {");
        expectSourceContains(searchQuerySource, "searchAbortController?.abort();");
        expectSourceContains(searchQuerySource, "clearTimeout(searchDebounceTimer);");
    });

    it("clears the shared main search query when navigating from the sidebar", () => {
        expectSourceContains(sidebarSource, "const handleOpenHomeView = () => {");
        expectSourceContains(
            sidebarSource,
            "const handleSidebarSelect = (key: SidebarItemKey) => {",
        );
        expectSourceContains(
            sidebarSource,
            "const handleSidebarPlaylistClick = (event: MouseEvent, id: string) => {",
        );
        expect(
            sidebarSource.match(/setSearch\(''\);/g)?.length,
        ).toBeGreaterThanOrEqual(3);
        expectSourceContains(
            sidebarSource,
            '@playlistClick="handleSidebarPlaylistClick"',
        );
    });
});
