import { invoke, isTauri } from '@tauri-apps/api/core';

const ANNOUNCEMENT_URLS = [
  'https://raw.githubusercontent.com/TaXiaoQi/XY-Music-Desktop/main/announcement.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/TaXiaoQi/XY-Music-Desktop/main/announcement.json',
  'https://cdn.jsdelivr.net/gh/TaXiaoQi/XY-Music-Desktop@main/announcement.json',
];

const DISMISSED_KEY = 'announcement_dismissed_id';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type?: 'info' | 'warning' | 'update';
  date?: string;
  actionUrl?: string;
  actionText?: string;
}

export async function fetchAnnouncement(): Promise<Announcement | null> {
  try {
    let raw: string;

    if (isTauri()) {
      raw = await invoke<string>('fetch_announcement');
    } else {
      raw = '';
      for (const url of ANNOUNCEMENT_URLS) {
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) {
            raw = await response.text();
            break;
          }
        } catch {
          continue;
        }
      }
      if (!raw) return null;
    }

    const data = JSON.parse(raw);

    if (!data || !data.id || !data.title || !data.content) {
      return null;
    }

    // 支持 enabled 字段控制是否显示
    if (data.enabled === false) {
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
    };
  } catch (error) {
    console.error('[Announcement] 获取公告失败:', error);
    return null;
  }
}

export function isAnnouncementDismissed(id: string): boolean {
  try {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    return dismissed === id;
  } catch {
    return false;
  }
}

export function dismissAnnouncement(id: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    // ignore storage errors
  }
}
