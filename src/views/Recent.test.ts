import { describe, it } from "vitest";

import recentHeaderSource from "../components/headers/RecentHeader.vue?raw";
import recentSource from "./Recent.vue?raw";
import { expectSourceContains, expectSourceNotContains } from "../testing/sourceText";

describe("recent view", () => {
    it("renders songs only without collection tabs", () => {
        expectSourceContains(recentSource, "<SongTable");
        expectSourceNotContains(recentSource, "recentTab");
        expectSourceNotContains(recentSource, "<RecentCollectionGrid");
    });

    it("keeps only song-level actions in the header", () => {
        expectSourceNotContains(recentHeaderSource, "recentTab");
        expectSourceContains(recentHeaderSource, "playAll");
        expectSourceContains(recentHeaderSource, "clearHistory");
        expectSourceContains(recentHeaderSource, "addAllToQueue");
    });
});
