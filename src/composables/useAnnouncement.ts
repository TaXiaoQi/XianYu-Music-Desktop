import { ref } from 'vue';
import {
  fetchAnnouncement,
  isAnnouncementDismissed,
  dismissAnnouncement,
  confirmAnnouncement,
  type Announcement,
} from '../utils/announcement';
import { useToast } from './toast';

const announcementVisible = ref(false);
const currentAnnouncement = ref<Announcement | null>(null);
const isFetchingAnnouncement = ref(false);

export function useAnnouncement() {
  const { showToast } = useToast();

  const checkAnnouncement = async () => {
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement && !isAnnouncementDismissed(announcement)) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      }
    } catch (error) {
      console.error('[Announcement] 启动检查公告失败:', error);
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  const manualCheckAnnouncement = async () => {
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      } else {
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

  const simulateAnnouncement = () => {
    currentAnnouncement.value = {
      id: 'debug-simulated',
      title: '【调试模拟】这是一条测试公告',
      content: '此公告由调试模式模拟生成，用于测试公告弹窗的显示效果。\n\n您可以在此查看公告的排版、样式和交互行为，而无需连接服务器。\n\n点击下方按钮可测试动作链接的跳转效果。',
      type: 'info',
      date: new Date().toISOString().slice(0, 10),
      actionUrl: 'https://xianyumusic.cn',
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
