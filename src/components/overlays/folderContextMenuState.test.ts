import { it, describe, expect } from 'vitest';

import * as menuState from './folderContextMenuState';

describe('文件夹右键菜单状态门槛', () => {
  it('浏览态：管理操作既不可见也不可点', () => {
    expect(menuState.shouldShowFolderManagementActions(false)).toBe(false);
    expect(menuState.canUseFolderManagementAction(false)).toBe(false);
  });

  it('整理态：管理操作可见且允许移出媒体库', () => {
    expect(menuState.shouldShowFolderManagementActions(true)).toBe(true);
    expect(menuState.canUseFolderManagementAction(true)).toBe(true);
  });
});
