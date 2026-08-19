import { ref } from 'vue';
import { signedRequest, getStoredAuth } from '../services/auth/authService';
import type { Announcement } from '../utils/announcement';

// 模块级单例状态，全局共享同一份反馈通知状态
const feedbackVisible = ref(false);
const currentFeedbackNotification = ref<Announcement | null>(null);
const currentNotificationId = ref<number>(0);
const isFetchingFeedback = ref(false);

interface FeedbackNotificationRaw {
  id: number;
  title: string;
  content: string;
  assignee: string;
  replied_by: string;
  status: string;
  resolve_note: string;
  reject_reason: string;
  resolve_images: string[];
  replied_at: string;
  updated_at: string;
}

function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchFeedbackNotifications(): Promise<FeedbackNotificationRaw[]> {
  const auth = getStoredAuth();
  if (!auth?.user) return [];
  try {
    const data = await signedRequest<{ list: FeedbackNotificationRaw[] }>(
      'get_my_feedback_notifications',
      {
        ciyuanxi_id: auth.user.ciyuanxi_id ?? auth.user.id ?? '',
      },
      { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
    );
    return data?.list ?? [];
  } catch (error) {
    console.error('[FeedbackNotification] 获取反馈完成通知失败:', error);
    return [];
  }
}

/**
 * 反馈完成通知：后台将反馈标记为已完成并填写说明后，用户端拉取到
 * 未确认的完成通知，通过公告弹窗展示处理管理员与完成说明。
 */
export function useFeedbackNotification() {
  /**
   * 检查并展示反馈完成通知（应用启动 / 定时轮询时调用）。
   * 仅当没有普通公告在展示时才弹出，避免多个弹窗叠加。
   * @param announcementVisible 当前是否有普通公告在展示
   */
  const checkFeedbackNotification = async (announcementVisible = false) => {
    if (isFetchingFeedback.value || feedbackVisible.value) return;
    if (announcementVisible) return;
    isFetchingFeedback.value = true;
    try {
      const list = await fetchFeedbackNotifications();
      if (list.length > 0) {
        const item = list[0];
        const isRejected = item.status === 'rejected';
        const operator = item.replied_by || item.assignee || '管理员';
        const title = isRejected ? '反馈已被拒绝' : '反馈处理完成';
        const reason = isRejected ? item.reject_reason : item.resolve_note;
        const reasonLabel = isRejected ? '拒绝理由' : '完成说明';
        currentFeedbackNotification.value = {
          id: `feedback-${item.id}`,
          title,
          content: `您提交的反馈「${item.title || '无标题'}」${isRejected ? '已被拒绝' : '已处理完成'}。\n\n处理管理员：${operator}\n${reasonLabel}：${reason || '（无说明）'}`,
          type: isRejected ? 'warning' : 'info',
          date: formatDate(item.replied_at),
          updatedAt: item.updated_at,
          images: isRejected ? [] : (Array.isArray(item.resolve_images) ? item.resolve_images : []),
        };
        currentNotificationId.value = item.id;
        feedbackVisible.value = true;
      }
    } finally {
      isFetchingFeedback.value = false;
    }
  };

  /** 关闭反馈完成通知：确认已读，避免重复弹出 */
  const closeFeedbackNotification = async () => {
    const id = currentNotificationId.value;
    const auth = getStoredAuth();
    if (id > 0) {
      try {
        await signedRequest<Record<string, unknown>>(
          'confirm_feedback_notification',
          {
            id,
            ciyuanxi_id: auth?.user?.ciyuanxi_id ?? auth?.user?.id ?? '',
          },
          { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
        );
      } catch (error) {
        console.error('[FeedbackNotification] 确认反馈通知失败:', error);
      }
    }
    feedbackVisible.value = false;
    currentFeedbackNotification.value = null;
    currentNotificationId.value = 0;
  };

  return {
    feedbackVisible,
    currentFeedbackNotification,
    isFetchingFeedback,
    checkFeedbackNotification,
    closeFeedbackNotification,
  };
}