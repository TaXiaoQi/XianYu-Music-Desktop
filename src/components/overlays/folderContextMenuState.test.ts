import { describe, expect, it } from 'vitest';

import {
  canUseFolderManagementAction,
  shouldShowFolderManagementActions,
} from './folderContextMenuState';

describe('folder context menu state', () => {
  it('hides management actions while browsing', () => {
    expect(shouldShowFolderManagementActions(false)).toBe(false);
    expect(canUseFolderManagementAction(false)).toBe(false);
  });

  it('shows management actions and allows removing from library in management mode', () => {
    expect(shouldShowFolderManagementActions(true)).toBe(true);
    expect(canUseFolderManagementAction(true)).toBe(true);
  });
});
