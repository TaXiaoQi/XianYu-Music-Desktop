import { ref } from 'vue';
import {
  fetchAnnouncement,
  isAnnouncementDismissed,
  dismissAnnouncement,
  confirmAnnouncement,
  type Announcement,
} from '../utils/announcement';
import { useToast } from './toast';

// 模块级单例状态，保证全局共享同一份公告状态
const announcementVisible = ref(false);
const currentAnnouncement = ref<Announcement | null>(null);
const isFetchingAnnouncement = ref(false);

export function useAnnouncement() {
  const { showToast } = useToast();

  /**
   * 自动检查公告（应用启动时调用）
   * 已被用户忽略（dismissed）的公告不会再次弹出
   */
  const checkAnnouncement = async () => {
    if (isFetchingAnnouncement.value) {
      console.warn('[Announcement][debug] checkAnnouncement 被 isFetchingAnnouncement 拦截');
      return;
    }
    isFetchingAnnouncement.value = true;
    try {
      console.log('[Announcement][debug] checkAnnouncement 开始请求');
      const announcement = await fetchAnnouncement();
      console.log('[Announcement][debug] fetchAnnouncement 返回:', announcement);
      if (announcement && !isAnnouncementDismissed(announcement)) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
        console.log('[Announcement][debug] 公告已设置，announcementVisible =', announcementVisible.value);
      } else {
        console.log('[Announcement][debug] 公告未展示，announcement =', announcement, 'dismissed =', announcement ? isAnnouncementDismissed(announcement) : 'n/a');
      }
    } catch (error) {
      // 启动时静默失败，仅在控制台记录
      console.error('[Announcement] 启动检查公告失败:', error);
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  /**
   * 手动查看公告（点击标题栏铃铛按钮时调用）
   * 每次点击都重新请求服务器获取最新公告并展示；
   * 不受启动检查的 isFetchingAnnouncement 影响，避免启动拉取期间点击被静默吞掉
   * （fetchAnnouncement 为幂等读取请求，并发调用无副作用）
   */
  const manualCheckAnnouncement = async () => {
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      } else {
        // 服务端正常响应但无有效公告内容
        showToast('暂无公告', 'info');
      }
    } catch (e) {
      console.error('[Announcement] 手动获取公告失败:', e);
      const reason = e instanceof Error && e.message ? e.message : '未知错误';
      showToast(`获取公告失败：${reason}`, 'error');
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  const closeAnnouncement = async () => {
    const announcement = currentAnnouncement.value;
    if (announcement) {
      if (announcement.id.startsWith('debug-')) {
        dismissAnnouncement(announcement);
        announcementVisible.value = false;
        return;
      }
      try {
        await confirmAnnouncement(announcement);
        dismissAnnouncement(announcement);
      } catch (error) {
        console.error('[Announcement] 确认公告失败:', error);
        showToast('公告确认失败，请检查网络后重试', 'error');
        return;
      }
    }
    announcementVisible.value = false;
  };

  const handleAnnouncementAction = async (url: string) => {
    window.open(url, '_blank');
    await closeAnnouncement();
  };

  /** 调试用：使用模拟数据直接弹出公告弹窗，不做真实网络请求 */
  const simulateAnnouncement = () => {
    currentAnnouncement.value = {
      id: 'debug-simulated',
      title: '【调试模拟】这是一条测试公告',
      content: '此公告由调试模式模拟生成，用于测试公告弹窗的显示效果。\n\n您可以在此查看公告的排版、样式和交互行为，而无需连接服务器。\n\n点击下方按钮可测试动作链接的跳转效果。',
      type: 'info',
      date: new Date().toISOString().slice(0, 10),
      actionUrl: 'https://xymusic.cc',
      actionText: '访问官网',
      updatedAt: new Date().toISOString(),
    };
    announcementVisible.value = true;
  };

  return {
    announcementVisible,
    currentAnnouncement,
    isFetchingAnnouncement,
    checkAnnouncement,
    manualCheckAnnouncement,
    closeAnnouncement,
    handleAnnouncementAction,
    simulateAnnouncement,
  };
}
