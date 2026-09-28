/**
 * 文件夹右键菜单的操作门槛。
 *
 * 规则：浏览态下菜单仅提供导航类入口；进入「整理模式」后，
 * 「移出媒体库」等管理操作才同时满足可见与可点两个条件。
 * 两个门槛始终同进同退，避免出现「看得见却点不动」的中间态。
 */

function gatedByManagementMode(isManagementMode: boolean): boolean {
  return Boolean(isManagementMode);
}

export function shouldShowFolderManagementActions(
  isManagementMode: boolean,
): boolean {
  return gatedByManagementMode(isManagementMode);
}

export function canUseFolderManagementAction(
  isManagementMode: boolean,
): boolean {
  return gatedByManagementMode(isManagementMode);
}
