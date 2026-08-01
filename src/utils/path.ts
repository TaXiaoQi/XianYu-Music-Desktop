/**
 * 路径处理通用工具
 */

/** 将路径中的反斜杠转为正斜杠，去除尾部斜杠，并转为小写 */
export function normalizePath(path: string): string {
  return (path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 获取父目录路径 */
export function getParentFolderPath(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '');
}

/** 从路径中提取文件名 */
export function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || '';
}
