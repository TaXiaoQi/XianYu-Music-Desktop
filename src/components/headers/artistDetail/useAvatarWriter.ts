import { onMounted, onUnmounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { libraryApi } from '../../../services/tauri/libraryApi';
import { useLibraryStore } from '../../../features/library/store';
import { useSettings } from '../../../features/settings/useSettings';
import { useToast } from '../../../composables/toast';
import type { ArtistCatalogItem } from '../../../types';

export interface TagWriteProgress {
  taskId: string;
  current: number;
  total: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  skippedMultiArtist: number;
  skippedRemote: number;
  skippedCue: number;
  skippedReadonly: number;
  skippedMissing: number;
  done: boolean;
}

const blankProgress = (taskId: string): TagWriteProgress => ({
  taskId,
  current: 0,
  total: 0,
  successCount: 0,
  failureCount: 0,
  skippedCount: 0,
  skippedMultiArtist: 0,
  skippedRemote: 0,
  skippedCue: 0,
  skippedReadonly: 0,
  skippedMissing: 0,
  done: false,
});

/**
 * 歌手头像保存流程：
 * 选图 →（可选）询问是否写回标签 → 调用后端保存 → 监听写回进度并汇总提示。
 */
export function useAvatarWriter(target: () => ArtistCatalogItem | undefined) {
  const store = useLibraryStore();
  const { settings } = useSettings();
  const { showToast } = useToast();

  const saving = ref(false);
  const dialogOpen = ref(false);
  const stagedImage = ref('');
  const task = ref<TagWriteProgress | null>(null);
  let runningTaskId: string | null = null;
  let stopProgress: UnlistenFn | null = null;

  const persist = async (imagePath: string, alsoWriteTags: boolean) => {
    const entry = target();
    if (!entry) return;
    saving.value = true;

    try {
      const saved = await libraryApi.saveArtistAvatar(entry.id, imagePath, alsoWriteTags);

      store.setArtistCatalog(
        store.artistCatalog.map(item =>
          item.id === saved.artistId ? { ...item, avatarPath: saved.avatarPath } : item,
        ),
      );

      if (saved.taskId) {
        runningTaskId = saved.taskId;
        task.value = blankProgress(saved.taskId);
      } else {
        showToast('修改歌手头像成功', 'success');
        saving.value = false;
      }
    } catch (error) {
      console.error('Failed to save artist avatar:', error);
      showToast(typeof error === 'string' ? error : '修改歌手头像失败', 'error');
      saving.value = false;
    }
  };

  const confirmWriteBack = () => {
    dialogOpen.value = false;
    if (stagedImage.value) {
      persist(stagedImage.value, true);
      stagedImage.value = '';
    }
  };

  const confirmAppOnly = () => {
    dialogOpen.value = false;
    if (stagedImage.value) {
      persist(stagedImage.value, false);
      stagedImage.value = '';
    }
  };

  const pickNewAvatar = async () => {
    if (!target() || saving.value) return;

    const picked = await open({
      multiple: false,
      directory: false,
      title: '选择歌手头像',
      filters: [
        {
          name: '图片',
          extensions: ['jpg', 'jpeg', 'png', 'webp'],
        },
      ],
    });

    if (!picked || Array.isArray(picked)) {
      return;
    }

    if (settings.value.writeArtistAvatarToTags) {
      stagedImage.value = picked as string;
      dialogOpen.value = true;
    } else {
      persist(picked as string, false);
    }
  };

  onMounted(async () => {
    stopProgress = await listen<any>('artist-avatar:write-tags-progress', (event) => {
      const payload = event.payload;
      if (!runningTaskId || payload.taskId !== runningTaskId) return;

      task.value = {
        taskId: payload.taskId,
        current: payload.current,
        total: payload.total,
        successCount: payload.successCount,
        failureCount: payload.failureCount,
        skippedCount: payload.skippedCount,
        skippedMultiArtist: payload.skippedMultiArtist,
        skippedRemote: payload.skippedRemote,
        skippedCue: payload.skippedCue,
        skippedReadonly: payload.skippedReadonly,
        skippedMissing: payload.skippedMissing,
        done: payload.done,
      };

      if (!payload.done) return;

      const skipBits: string[] = [];
      if (payload.skippedMultiArtist > 0) skipBits.push(`多歌手: ${payload.skippedMultiArtist}`);
      if (payload.skippedRemote > 0) skipBits.push(`远程: ${payload.skippedRemote}`);
      if (payload.skippedCue > 0) skipBits.push(`CUE: ${payload.skippedCue}`);
      if (payload.skippedReadonly > 0) skipBits.push(`只读: ${payload.skippedReadonly}`);
      if (payload.skippedMissing > 0) skipBits.push(`缺失: ${payload.skippedMissing}`);

      const skipNote = skipBits.length > 0 ? ` (${skipBits.join(', ')})` : '';

      if (payload.error) {
        showToast(`写回标签出错: ${payload.error}`, 'error');
      } else if (payload.total === 0 || (payload.successCount === 0 && payload.skippedCount === payload.total && payload.total > 0)) {
        showToast(`头像已保存，但没有可写入的本地单人歌曲${skipNote}。`, 'info');
      } else {
        showToast(
          `歌手头像保存并写回标签完成！成功: ${payload.successCount} 首，跳过: ${payload.skippedCount} 首${skipNote}，失败: ${payload.failureCount} 首`,
          payload.failureCount > 0 ? 'error' : 'success',
        );
      }

      runningTaskId = null;
      task.value = null;
      saving.value = false;
    });
  });

  onUnmounted(() => {
    if (stopProgress) {
      stopProgress();
      stopProgress = null;
    }
  });

  return { saving, dialogOpen, task, pickNewAvatar, confirmWriteBack, confirmAppOnly };
}
