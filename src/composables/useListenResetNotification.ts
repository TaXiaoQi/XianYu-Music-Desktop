import { ref } from 'vue';
import type { Announcement } from '../utils/announcement';

const listenResetVisible = ref(false);
const currentListenResetNotification = ref<Announcement | null>(null);
const isCheckingListenReset = ref(false);

const PENDING_AT_KEY = 'xianyumusic.pendingListenResetAt';
const PENDING_REASON_KEY = 'xianyumusic.pendingListenResetReason';

function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function resetListenResetNotificationState(): void {
  listenResetVisible.value = false;
  currentListenResetNotification.value = null;
  isCheckingListenReset.value = false;
}

export function useListenResetNotification() {
  const checkListenResetNotification = async (announcementVisible = false) => {
    if (isCheckingListenReset.value || listenResetVisible.value) return;
    if (announcementVisible) return;
    isCheckingListenReset.value = true;
    try {
      const at = Number(localStorage.getItem(PENDING_AT_KEY) ?? 0);
      const reason = localStorage.getItem(PENDING_REASON_KEY) ?? '';
      if (at > 0 && reason) {
        currentListenResetNotification.value = {
          id: `listen-reset-${at}`,
          title: '听歌时长已被清理',
          content:
            '您的累计听歌时长已被清理，将从零开始重新累计。\n\n清除原因：' +
            (reason || '（未填写）'),
          type: 'warning',
          date: formatDate(new Date(at * 1000).toISOString()),
        };
        listenResetVisible.value = true;
      }
    } finally {
      isCheckingListenReset.value = false;
    }
  };

  const closeListenResetNotification = async () => {
    localStorage.removeItem(PENDING_AT_KEY);
    localStorage.removeItem(PENDING_REASON_KEY);
    listenResetVisible.value = false;
    currentListenResetNotification.value = null;
  };

  return {
    listenResetVisible,
    currentListenResetNotification,
    isCheckingListenReset,
    checkListenResetNotification,
    closeListenResetNotification,
  };
}