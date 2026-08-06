import { ref } from 'vue';
import {
  fetchAnnouncement,
  isAnnouncementDismissed,
  dismissAnnouncement,
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
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement && !isAnnouncementDismissed(announcement)) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      }
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  /**
   * 手动查看公告（点击标题栏铃铛按钮时调用）
   * 无论是否已读，只要有公告就显示；无公告或失败时给出提示，避免「点击没反应」
   * （启动时才做「有新公告才弹」的校验，手动点击始终展示当前公告）
   */
  const manualCheckAnnouncement = async () => {
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      } else {
        // fetchAnnouncement 返回 null：可能是无启用公告，也可能是请求失败（已在控制台打印错误）
        showToast('暂无公告', 'info');
      }
    } catch (e) {
      console.error('[Announcement] 手动获取公告失败:', e);
      showToast('获取公告失败，请稍后重试', 'error');
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  const closeAnnouncement = () => {
    if (currentAnnouncement.value) {
      dismissAnnouncement(currentAnnouncement.value);
    }
    announcementVisible.value = false;
  };

  const handleAnnouncementAction = (url: string) => {
    window.open(url, '_blank');
    closeAnnouncement();
  };

  /** 调试用：使用模拟数据直接弹出公告弹窗，不做真实网络请求 */
  const simulateAnnouncement = () => {
    currentAnnouncement.value = {
      id: 'debug-simulated',
      title: '【调试模拟】这是一条测试公告',
      content: '此公告由调试模式模拟生成，用于测试公告弹窗的显示效果。\n\n您可以在此查看公告的排版、样式和交互行为，而无需连接服务器。\n\n点击下方按钮可测试动作链接的跳转效果。',
      type: 'info',
      date: new Date().toISOString().slice(0, 10),
      actionUrl: 'https://xy.zh2026.cn/ciyuanxi/',
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
