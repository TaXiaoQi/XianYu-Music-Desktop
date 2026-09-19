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
  images?: string[];
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
