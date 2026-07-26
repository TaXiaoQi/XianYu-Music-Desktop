import { ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  fetchAnnouncement,
  isAnnouncementDismissed,
  dismissAnnouncement,
  type Announcement,
} from '../utils/announcement';

const announcementVisible = ref(false);
const currentAnnouncement = ref<Announcement | null>(null);
const isFetchingAnnouncement = ref(false);

export function useAnnouncement() {
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

  const manualCheckAnnouncement = async () => {
    if (isFetchingAnnouncement.value) return;
    isFetchingAnnouncement.value = true;

    try {
      const announcement = await fetchAnnouncement();
      console.log('[Announcement] 手动检查结果:', announcement);
      if (announcement) {
        currentAnnouncement.value = announcement;
        announcementVisible.value = true;
        console.log('[Announcement] 弹窗已设置为可见');
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

  const handleAnnouncementAction = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
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
