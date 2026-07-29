/**
 * 下载 Web Worker
 *
 * 在独立 Worker 线程里用 fetch 拉取音频数据（模仿 MusicFreeDesktop 的做法）。
 * IDM 等下载器对 WebView2 的拦截主要作用于主线程文档，Worker 线程的 fetch
 * 属于纯数据请求，通常能逃过其拦截。
 *
 * 同时请求头模拟浏览器媒体流（Referer/UA/Accept），进一步降低被识别为“下载”的概率。
 *
 * 消息协议：
 *   主线程 → Worker: { url: string }
 *   Worker → 主线程: { type: 'progress', received, total }
 *                    | { type: 'done', buffer: ArrayBuffer }   (buffer 为 transferable)
 *                    | { type: 'error', message: string }
 */

interface DownloadRequest {
  url: string;
}

self.onmessage = async (event: MessageEvent<DownloadRequest>) => {
  const { url } = event.data;
  try {
    const ACCEPT =
      'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5';

    // 先尝试带 Range 的媒体流请求（伪装成浏览器音频播放，规避 IDM 等下载器拦截）；
    // 部分音源 CDN 对开放式 Range 会返回 502/416/403（高品、无损直链的节点尤其常见），
    // 此时去掉 Range 重试一次普通 GET。
    const doFetch = (withRange: boolean) =>
      fetch(url, {
        headers: withRange
          ? { Accept: ACCEPT, Range: 'bytes=0-' }
          : { Accept: ACCEPT },
      });

    let resp = await doFetch(true);
    if (
      !resp.ok &&
      resp.status !== 206 &&
      (resp.status === 502 || resp.status === 416 || resp.status === 403)
    ) {
      resp = await doFetch(false);
    }

    if (!resp.ok && resp.status !== 206) {
      throw new Error(`HTTP ${resp.status}`);
    }

    // 解析总大小（Content-Range 优先，其次 Content-Length）
    let total = 0;
    const contentRange = resp.headers.get('content-range');
    if (contentRange) {
      const m = /\/(\d+)\s*$/.exec(contentRange);
      if (m) total = parseInt(m[1], 10);
    }
    if (!total) {
      const cl = resp.headers.get('content-length');
      if (cl) total = parseInt(cl, 10);
    }

    if (!resp.body) {
      const buf = await resp.arrayBuffer();
      (self as unknown as Worker).postMessage({ type: 'done', buffer: buf }, [buf]);
      return;
    }

    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        (self as unknown as Worker).postMessage({ type: 'progress', received, total });
      }
    }

    // 完整性校验：声明了大小但收到不足，视为失败
    if (total > 0 && received < total) {
      throw new Error(`下载不完整（${received}/${total} 字节）`);
    }

    // 合并为单个 ArrayBuffer
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const buffer = merged.buffer;
    (self as unknown as Worker).postMessage({ type: 'done', buffer }, [buffer]);
  } catch (e: any) {
    const message = typeof e === 'string' ? e : (e?.message || String(e));
    (self as unknown as Worker).postMessage({ type: 'error', message });
  }
};
