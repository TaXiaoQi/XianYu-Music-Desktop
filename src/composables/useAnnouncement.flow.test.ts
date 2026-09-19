import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../services/domain/usageStats', () => ({
  getDeviceId: () => 'test-device-001',
}));

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
vi.stubGlobal('localStorage', new MemoryStorage());

import { invoke } from '@tauri-apps/api/core';

import { useAnnouncement } from './useAnnouncement';

const mockInvoke = vi.mocked(invoke);

async function resetAnnouncementState() {
  const { announcementVisible, currentAnnouncement, closeAnnouncement } = useAnnouncement();
  (announcementVisible as { value: boolean }).value = false;
  (currentAnnouncement as { value: unknown }).value = null;
  localStorage.removeItem('announcement_dismissed_id');
}

describe('useAnnouncement 公告检查流程', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  it('fetchAnnouncement 返回有效公告时，checkAnnouncement 应设置 announcementVisible=true', async () => {
    await resetAnnouncementState();
    const { checkAnnouncement, announcementVisible, currentAnnouncement } = useAnnouncement();

    mockInvoke.mockResolvedValue({
      code: 200,
      msg: 'ok',
      data: {
        id: 'ann-1',
        title: '测试公告',
        content: '这是一条测试公告内容',
        type: 'info',
        date: '2026-08-24',
        updatedAt: '2026-08-24T10:00:00Z',
      },
    });

    await checkAnnouncement();

    expect(announcementVisible.value).toBe(true);
    expect(currentAnnouncement.value?.id).toBe('ann-1');
  });

  it('fetchAnnouncement 返回空数据（无公告）时，announcementVisible 保持 false', async () => {
    await resetAnnouncementState();
    const { checkAnnouncement, announcementVisible } = useAnnouncement();

    mockInvoke.mockResolvedValue({
      code: 200,
      msg: 'ok',
      data: null,
    });

    await checkAnnouncement();

    expect(announcementVisible.value).toBe(false);
  });

  it('fetchAnnouncement 请求失败时，announcementVisible 保持 false 且不抛异常', async () => {
    await resetAnnouncementState();
    const { checkAnnouncement, announcementVisible } = useAnnouncement();

    mockInvoke.mockRejectedValue(new Error('网络错误'));

    await expect(checkAnnouncement()).resolves.toBeUndefined();
    expect(announcementVisible.value).toBe(false);
  });

  it('已读（dismissed）的公告不会再次弹出', async () => {
    await resetAnnouncementState();
    const { checkAnnouncement, announcementVisible } = useAnnouncement();

    localStorage.setItem('announcement_dismissed_id', 'ann-1_2026-08-24T10:00:00Z');

    mockInvoke.mockResolvedValue({
      code: 200,
      msg: 'ok',
      data: {
        id: 'ann-1',
        title: '测试公告',
        content: '这是一条测试公告内容',
        type: 'info',
        updatedAt: '2026-08-24T10:00:00Z',
      },
    });

    await checkAnnouncement();

    expect(announcementVisible.value).toBe(false);
  });
});
