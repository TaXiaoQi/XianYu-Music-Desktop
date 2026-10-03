// 汽水音乐来源/关键词判定（pluginCatalogSearch 消费）。
// 歌单导入内置实现已下沉 Rust（src-tauri music/playlist_fetcher/qishui.rs）。

// ==================== 关键词/来源判定 ====================

export function isQishuiKeyword(keyword: string): boolean {
  const t = (keyword || '').trim().toLowerCase();
  return t.includes('qishui') || (keyword || '').includes('汽水') || t.includes('douyin.com');
}

export function isQishuiSource(name: string, sources: string[]): boolean {
  const n = (name || '').toLowerCase();
  if (n.includes('汽水') || n.includes('qishui')) return true;
  for (const s of sources || []) {
    const t = (s || '').trim().toLowerCase();
    if (t === 'qishui' || t.includes('汽水') || t.includes('qishui')) return true;
  }
  return false;
}
