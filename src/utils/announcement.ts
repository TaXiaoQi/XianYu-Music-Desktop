import { getStoredAuth, signedRequest } from '../services/auth/authService';
import { getDeviceId } from '../services/domain/usageStats';

const DISMISSED_KEY = 'announcement_dismissed_id';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type?: 'info' | 'warning' | 'update';
  date?: string;
  actionUrl?: string;
  actionText?: string;
  // 可选附加图片（例如反馈处理完成的图片），在内容下方以缩略图展示
  images?: string[];
  // 内容版本标识（后端 updated_at）。后台编辑公告会刷新此字段，
  // 使本地「已读」指纹失效，从而让所有用户重新看到更新后的公告。
  updatedAt?: string;
}

export async function fetchAnnouncement(): Promise<Announcement | null> {
  const auth = getStoredAuth();
  const data = await signedRequest<Record<string, unknown>>(
    'get_announcement',
    {
      ciyuanxi_id: auth?.user?.ciyuanxi_id ?? auth?.user?.id ?? '',
      device_id: getDeviceId(),
      platform: 'desktop',
    },
    { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
  );
  if (!data || !data.id || !data.title || !data.content) {
    // 服务端正常响应但无有效公告（data 为空对象/缺少必要字段）
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
}

export async function confirmAnnouncement(ann: Announcement): Promise<void> {
  const auth = getStoredAuth();
  await signedRequest<Record<string, unknown>>(
    'confirm_announcement',
    {
      announcement_id: ann.id,
      announcement_updated_at: ann.updatedAt ?? '',
      ciyuanxi_id: auth?.user?.ciyuanxi_id ?? auth?.user?.id ?? '',
      device_id: getDeviceId(),
    },
    { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
  );
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
