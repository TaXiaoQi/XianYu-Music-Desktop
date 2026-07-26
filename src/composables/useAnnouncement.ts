import { ref } from 'vue';
import {
  fetchAnnouncement,
  isAnnouncementDismissed,
  dismissAnnouncement,
  type Announcement,
} from '../utils/announcement';

// 模块级单例状态，保证全局共享同一份公告状态
const announcementVisible = ref(false);
const currentAnnouncement = ref<Announcement | null>(null);
const isFetchingAnnouncement = ref(false);

export function useAnnouncement() {
  /**
   * 自动检查公告（应用启动时调用）
   * 已被用户忽略（dismissed）的公告不会再次弹出
   */
  const checkAnnouncement = async () => {
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement && !isAnnouncementDismissed(announcement.id)) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      }
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  /**
   * 手动检查公告（点击标题栏铃铛按钮时调用）
   * 无论是否曾被忽略，只要有新公告就强制弹出
   */
  const manualCheckAnnouncement = async () => {
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true;
    try {
      const announcement = await fetchAnnouncement();
      if (announcement) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
      }
    } finally {
      isFetchingAnnouncement.value = false;
    }
  };

  const closeAnnouncement = () => {
    if (currentAnnouncement.value) {
      dismissAnnouncement(currentAnnouncement.value.id);
    }
    announcementVisible.value = false;
  };

  const handleAnnouncementAction = (url: string) => {
    window.open(url, '_blank');
    closeAnnouncement();
  };

  return {
    announcementVisible,
    currentAnnouncement,
    isFetchingAnnouncement,
    checkAnnouncement,
    manualCheckAnnouncement,
    closeAnnouncement,
    handleAnnouncementAction,
  };
}
