import { describe, it } from "vitest";

import onlineSongListSource from "./OnlineSongList.vue?raw";
import searchSource from "../../views/Search.vue?raw";
import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";

describe("online song list header", () => {
    it("keeps song numbering but removes the heading row from online detail lists", () => {
        expectSourceContains(onlineSongListSource, "{{ index + 1 }}");
        expectSourceNotContains(onlineSongListSource, "<thead");
    });

    it("uses SongTable as the container for the online track search list", () => {
        expectSourceContains(searchSource, "<SongTable");
        expectSourceContains(searchSource, "onlineTrackSongs");
        expectSourceNotContains(searchSource, "myPlaylistsSongs");
        expectSourceNotContains(searchSource, "<thead");
        expectSourceNotContains(searchSource, '<th v-if="isLocalSource"');
        expectSourceNotContains(searchSource, '<td v-if="isLocalSource"');
    });
});
