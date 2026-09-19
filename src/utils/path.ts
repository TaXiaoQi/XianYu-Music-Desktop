
export function normalizePath(path: string): string {
  return (path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function getParentFolderPath(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '');
}

export function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || '';
}
