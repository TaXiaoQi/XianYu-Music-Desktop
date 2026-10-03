import { describe, it } from "vitest";

import folderTreeItemSource from "../common/FolderTreeItem.vue?raw";
import foldersHeaderSource from "../headers/FoldersHeader.vue?raw";
import masterPanelSource from "../song-list/MasterPanel.vue?raw";
import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";

describe("folder navigation layout", () => {
    it("shows user-added root folders in the left tree instead of the top header", () => {
        expectSourceNotContains(
            foldersHeaderSource,
            'v-for="rootNode in folderTree"',
        );
        expectSourceContains(foldersHeaderSource, "文件夹");
        expectSourceContains(
            masterPanelSource,
            "const shownNodes = computed(() => folderTree.value);",
        );
        expectSourceContains(masterPanelSource, 'v-for="node in shownNodes"');
        expectSourceContains(masterPanelSource, ':isRoot="true"');
    });

    it("renders child folders recursively beneath each root folder", () => {
        expectSourceContains(folderTreeItemSource, 'v-show="node.is_expanded"');
        expectSourceContains(
            folderTreeItemSource,
            'v-for="child in node.children"',
        );
        expectSourceContains(folderTreeItemSource, ':depth="depth + 1"');
    });
});
