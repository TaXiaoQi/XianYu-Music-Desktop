import { signedRequest } from '../services/auth/authService';

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
    const data = await signedRequest<Record<string, unknown>>(
      'get_announcement',
      {},
      { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
    );
    if (!data || !data.id || !data.title || !data.content) {
      return null;
    }

    return {
      id: String(data.id),
      title: String(data.title),
      content: String(data.content),
      type: (data.type === 'warning' || data.type === 'update') ? data.type : 'info',
      date: typeof data.date === 'string' ? data.date : undefined,
      actionUrl: typeof data.actionUrl === 'string' ? data.actionUrl : undefined,
      actionText: typeof data.actionText === 'string' ? data.actionText : undefined,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
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
