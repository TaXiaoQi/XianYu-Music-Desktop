import { describe, expect, it } from 'vitest';

import folderTreeItemSource from '../common/FolderTreeItem.vue?raw';
import foldersHeaderSource from '../headers/FoldersHeader.vue?raw';
import masterPanelSource from '../song-list/MasterPanel.vue?raw';

describe('folder navigation layout', () => {
  it('shows user-added root folders in the left tree instead of the top header', () => {
    expect(foldersHeaderSource).not.toContain('v-for="rootNode in folderTree"');
    expect(foldersHeaderSource).toContain('文件夹');
    expect(masterPanelSource).toContain('const visibleTreeNodes = computed(() => folderTree.value);');
    expect(masterPanelSource).toContain('v-for="node in visibleTreeNodes"');
    expect(masterPanelSource).toContain(':isRoot="true"');
  });

  it('renders child folders recursively beneath each root folder', () => {
    expect(folderTreeItemSource).toContain('v-show="node.is_expanded"');
    expect(folderTreeItemSource).toContain('v-for="child in node.children"');
    expect(folderTreeItemSource).toContain(':depth="depth + 1"');
  });
});
