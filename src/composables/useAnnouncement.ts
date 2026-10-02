import { ref } from 'vue'; // 实现
import { // 实现
  fetchAnnouncement, // 实现
  isAnnouncementDismissed, // 实现
  dismissAnnouncement, // 实现
  confirmAnnouncement,
  type Announcement, // 实现
} from '../utils/announcement'; // 实现
import { useToast } from './toast'; // 实现
const announcementVisible = ref(false); // 实现
const currentAnnouncement = ref<Announcement | null>(null); // 实现
const isFetchingAnnouncement = ref(false); // 实现
export function useAnnouncement() { // 实现
  const { showToast } = useToast(); // 实现
  const checkAnnouncement = async () => { // 实现
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true; // 实现
    try { // 实现
      const announcement = await fetchAnnouncement(); // 实现
      if (announcement && !isAnnouncementDismissed(announcement)) { // 实现
        currentAnnouncement.value = announcement; // 实现
        announcementVisible.value = true; // 实现
      } // 实现
    } catch (error) {
      console.error('[Announcement] 启动检查公告失败:', error);
    } finally { // 实现
      isFetchingAnnouncement.value = false; // 实现
    } // 实现
  }; // 实现
  const manualCheckAnnouncement = async () => { // 实现
    isFetchingAnnouncement.value = true; // 实现
    try { // 实现
      const announcement = await fetchAnnouncement(); // 实现
      if (announcement) { // 实现
        currentAnnouncement.value = announcement; // 实现
        announcementVisible.value = true; // 实现
      } else { // 实现
        showToast('暂无公告', 'info'); // 实现
      } // 实现
    } catch (e) { // 实现
      console.error('[Announcement] 手动获取公告失败:', e); // 实现
      const reason = e instanceof Error && e.message ? e.message : '未知错误';
      showToast(`获取公告失败：${reason}`, 'error');
    } finally { // 实现
      isFetchingAnnouncement.value = false; // 实现
    } // 实现
  }; // 实现
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
    } // 实现
    announcementVisible.value = false; // 实现
  }; // 实现
  const handleAnnouncementAction = async (url: string) => {
    window.open(url, '_blank'); // 实现
    await closeAnnouncement();
  }; // 实现
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

  return { // 实现
    announcementVisible, // 实现
    currentAnnouncement, // 实现
    isFetchingAnnouncement, // 实现
    checkAnnouncement, // 实现
    manualCheckAnnouncement, // 实现
    closeAnnouncement, // 实现
    handleAnnouncementAction, // 实现
    simulateAnnouncement,
  }; // 实现
} // 实现
