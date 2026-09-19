import { ref } from 'vue';
import { signedRequest, getStoredAuth } from '../services/auth/authService';
import { getDeviceId } from '../services/domain/usageStats';
import type { Announcement } from '../utils/announcement';

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
        device_id: getDeviceId(),
      },
      { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
    );
    return data?.list ?? [];
  } catch (error) {
    console.error('[FeedbackNotification] 获取反馈完成通知失败:', error);
    return [];
  }
}

export function useFeedbackNotification() {
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