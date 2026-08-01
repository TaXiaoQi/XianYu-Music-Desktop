// 公告数据源：自建服务器（xy.zh2026.cn），由后台「公告管理」可视化编辑发布。
// 接口为免签公开读取，返回 {code, msg, data}，data 为最新一条启用公告或 null。
//
// 网络层选择：直接用全局 fetch。
// - 服务器已设置 Access-Control-Allow-Origin: *，无 CORS 问题
// - tauri.conf.json 的 CSP connect-src 已允许 https://*
// - 不使用 @tauri-apps/plugin-http（其内部资源管理会触发 "resource id is invalid" 错误）
// - 不使用 Rust 端 fetch_announcement 命令（reqwest 在服务器 TLS 重协商下会超时）
// - 使用独立的 announcement.php 接口，不依赖 app.php 复杂路由系统
const ANNOUNCEMENT_URL = 'https://xy.zh2026.cn/chaoguan/public/api/announcement.php';

const DISMISSED_KEY = 'announcement_dismissed_id';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type?: 'info' | 'warning' | 'update';
  date?: string;
  actionUrl?: string;
  actionText?: string;
  // 内容版本标识（后端 updated_at）。后台编辑公告会刷新此字段，
  // 使本地「已读」指纹失效，从而让所有用户重新看到更新后的公告。
  updatedAt?: string;
}

export async function fetchAnnouncement(): Promise<Announcement | null> {
  try {
    // 直接用全局 fetch（Tauri webview 和浏览器都支持）
    // 服务器已开启 CORS（Access-Control-Allow-Origin: *），无需走 Rust 侧绕过
    const response = await fetch(ANNOUNCEMENT_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error('[Announcement] HTTP 状态异常:', response.status);
      return null;
    }

    const payload = await response.json();
    if (!payload || payload.code !== 200 || !payload.data) {
      // code != 200 或 data 为 null（无启用公告）
      return null;
    }

    const data = payload.data;
    if (!data || !data.id || !data.title || !data.content) {
      return null;
    }

    return {
      id: data.id,
      title: data.title,
      content: data.content,
      type: data.type ?? 'info',
      date: data.date,
      actionUrl: data.actionUrl,
      actionText: data.actionText,
      updatedAt: data.updatedAt,
    };
  } catch (error) {
    console.error('[Announcement] 获取公告失败:', error);
    return null;
  }
}

/**
 * 生成公告的「已读指纹」：id + updated_at。
 * 后台编辑公告后 updated_at 改变 → 指纹改变 → 视为新公告重新弹出。
 */
function announcementFingerprint(ann: Announcement): string {
  return `${ann.id}_${ann.updatedAt ?? ''}`;
}

export function isAnnouncementDismissed(ann: Announcement): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === announcementFingerprint(ann);
  } catch {
    return false;
  }
}

export function dismissAnnouncement(ann: Announcement): void {
  try {
    localStorage.setItem(DISMISSED_KEY, announcementFingerprint(ann));
  } catch {
    // ignore storage errors
  }
}
