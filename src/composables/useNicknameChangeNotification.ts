import { ref } from 'vue';
import { signedRequest, getStoredAuth, saveAuth } from '../services/auth/authService';
import { useAuthStore } from '../features/auth/store';
import type { Announcement } from '../utils/announcement';

// 模块级单例状态，全局共享同一份昵称变更通知状态
const nicknameVisible = ref(false);
const currentNicknameNotification = ref<Announcement | null>(null);
const currentNoticeId = ref<number>(0);
const currentNewNickname = ref<string>('');
const isFetchingNickname = ref(false);

interface NicknameNoticeRaw {
  id: number;
  ciyuanxi_id: string;
  old_nickname: string;
  new_nickname: string;
  reason: string;
  changed_by: string;
  created_at: string;
}

function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 仅测试用：重置模块级单例状态，保证用例间隔离 */
export function resetNicknameChangeNotificationState(): void {
  nicknameVisible.value = false;
  currentNicknameNotification.value = null;
  currentNoticeId.value = 0;
  currentNewNickname.value = '';
  isFetchingNickname.value = false;
}

async function fetchNicknameNotices(): Promise<NicknameNoticeRaw[]> {
  const auth = getStoredAuth();
  if (!auth?.user) return [];
  try {
    const data = await signedRequest<{ list: NicknameNoticeRaw[] }>(
      'get_nickname_change_notices',
      {
        ciyuanxi_id: auth.user.ciyuanxi_id ?? auth.user.id ?? '',
      },
      { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
    );
    return data?.list ?? [];
  } catch (error) {
    console.error('[NicknameChange] 获取昵称变更通知失败:', error);
    return [];
  }
}

/**
 * 昵称变更通知（回执）：后台管理员在用户管理页修改用户昵称并填写原因后，
 * 用户端拉取到未确认的变更通知，通过公告弹窗展示新昵称与修改原因；
 * 用户确认后调用确认接口，并同步本地显示的昵称。
 */
export function useNicknameChangeNotification() {
  /**
   * 检查并展示昵称变更通知（应用启动 / 定时轮询时调用）。
   * 仅当没有公告/反馈通知在展示时才弹出，避免多个弹窗叠加。
   * @param announcementVisible 当前是否有公告/反馈通知在展示
   */
  const checkNicknameChangeNotification = async (announcementVisible = false) => {
    if (isFetchingNickname.value || nicknameVisible.value) return;
    if (announcementVisible) return;
    isFetchingNickname.value = true;
    try {
      const list = await fetchNicknameNotices();
      if (list.length > 0) {
        const item = list[0];
        currentNewNickname.value = item.new_nickname;
        currentNoticeId.value = item.id;
        currentNicknameNotification.value = {
          id: `nickname-${item.id}`,
          title: '昵称已被修改',
          content: `管理员已将您的昵称修改为「${item.new_nickname}」。\n\n原昵称：${item.old_nickname || '-'}\n修改原因：${item.reason || '（未填写）'}`,
          type: 'info',
          date: formatDate(item.created_at),
        };
        nicknameVisible.value = true;
      }
    } finally {
      isFetchingNickname.value = false;
    }
  };

  /** 关闭昵称变更通知：确认已读，避免重复弹出，并同步本地昵称 */
  const closeNicknameChangeNotification = async () => {
    const id = currentNoticeId.value;
    const auth = getStoredAuth();
    if (id > 0) {
      try {
        await signedRequest<Record<string, unknown>>(
          'confirm_nickname_change_notice',
          {
            id,
            ciyuanxi_id: auth?.user?.ciyuanxi_id ?? auth?.user?.id ?? '',
          },
          { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
        );
      } catch (error) {
        console.error('[NicknameChange] 确认昵称变更通知失败:', error);
      }
    }
    // 同步本地显示的昵称（store 未初始化时 saveAuth 已更新持久化缓存）
    const newNickname = currentNewNickname.value;
    if (newNickname && auth) {
      const nextUser = { ...auth.user, nickname: newNickname };
      saveAuth({ token: auth.token, user: nextUser });
      try {
        useAuthStore().setUser(nextUser);
      } catch {
        /* store 未初始化时忽略 */
      }
    }
    nicknameVisible.value = false;
    currentNicknameNotification.value = null;
    currentNoticeId.value = 0;
    currentNewNickname.value = '';
  };

  return {
    nicknameVisible,
    currentNicknameNotification,
    isFetchingNickname,
    checkNicknameChangeNotification,
    closeNicknameChangeNotification,
  };
}