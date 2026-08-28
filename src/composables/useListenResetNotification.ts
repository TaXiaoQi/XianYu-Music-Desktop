import { ref } from 'vue';
import type { Announcement } from '../utils/announcement';

// 模块级单例状态，全局共享同一份清零通知状态
const listenResetVisible = ref(false);
const currentListenResetNotification = ref<Announcement | null>(null);
const isCheckingListenReset = ref(false);

/** 本地待展示清零通知的持久化键（由 listenStatsSync Rule 4 写入） */
const PENDING_AT_KEY = 'xianyumusic.pendingListenResetAt';
const PENDING_REASON_KEY = 'xianyumusic.pendingListenResetReason';

function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 仅测试用：重置模块级单例状态，保证用例间隔离 */
export function resetListenResetNotificationState(): void {
  listenResetVisible.value = false;
  currentListenResetNotification.value = null;
  isCheckingListenReset.value = false;
}

/**
 * 听歌时长清零通知（回执）：后台管理员在用户管理页重置时长的同时填写清除原因，
 * 服务端将「清零时间点 + 原因」随快照下发；客户端同步检测到清零后落本地待展示记录，
 * 此处读取该记录，通过公告弹窗告知用户已被清理及原因，关闭后清除本地记录（幂等，
 * 无需调用确认接口）。
 */
export function useListenResetNotification() {
  /**
   * 检查并展示清零通知（应用启动 / 定时轮询时调用）。
   * 仅当没有公告/反馈/昵称通知在展示时才弹出，避免多个弹窗叠加。
   * @param announcementVisible 当前是否有其它通知在展示
   */
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

  /** 关闭清零通知：清除本地待展示记录，避免重复弹出 */
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