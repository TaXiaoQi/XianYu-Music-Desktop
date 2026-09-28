import { onUnmounted, type Ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { ThemeSettings } from '../../../types';
import { probeImageSize, probeVideoSize } from './mediaProbe';

type SkinDraft = ThemeSettings['customBackground'];

interface SkinDraftMediaOptions {
  /** 皮肤预览草稿（响应式对象，直接原地更新） */
  draft: Ref<SkinDraft>;
  /** 触发系统图片选择框（由 useCustomThemeModal 提供） */
  pickImage: () => Promise<void>;
  /** 触发系统视频选择框 */
  pickVideo: () => Promise<void>;
}

/**
 * 皮肤草稿的媒体接入器：
 * 负责本地图片/视频选择与壁纸中心选定后的路径落稿、变换复位与尺寸探测。
 */
export function useSkinDraftMedia({ draft, pickImage, pickVideo }: SkinDraftMediaOptions) {
  let disposed = false;
  onUnmounted(() => {
    disposed = true;
  });

  const resetTransform = () => {
    draft.value.scale = 1.0;
    draft.value.translateX = 0;
    draft.value.translateY = 0;
  };

  /** 探测媒体尺寸并写入草稿；失败时清零以回落默认几何 */
  const syncMediaSize = async (src: string, kind: 'image' | 'video', failureLog: string) => {
    try {
      const size = kind === 'video' ? await probeVideoSize(src) : await probeImageSize(src);
      if (disposed) {
        return;
      }
      draft.value.imageWidth = size.width;
      draft.value.imageHeight = size.height;
    } catch (err) {
      console.error(failureLog, err);
      draft.value.imageWidth = 0;
      draft.value.imageHeight = 0;
    }
  };

  /** 选择本地图片；路径确有变化时复位变换并重新测量 */
  const adoptLocalImage = async () => {
    const previousPath = draft.value.imagePath;
    await pickImage();
    const nextPath = draft.value.imagePath;
    if (!nextPath || nextPath === previousPath) {
      return;
    }

    resetTransform();
    const kind: 'image' | 'video' = draft.value.mediaType === 'video' ? 'video' : 'image';
    await syncMediaSize(convertFileSrc(nextPath), kind, 'Failed to load media size metadata');
  };

  /** 选择本地视频；路径确有变化时复位变换并重新测量 */
  const adoptLocalVideo = async () => {
    const previousPath = draft.value.imagePath;
    await pickVideo();
    const nextPath = draft.value.imagePath;
    if (!nextPath || nextPath === previousPath) {
      return;
    }

    resetTransform();
    await syncMediaSize(convertFileSrc(nextPath), 'video', 'Failed to load video size metadata');
  };

  /** 壁纸中心选定：无条件落稿并复位变换 */
  const adoptGalleryWallpaper = async (localPath: string, mediaType?: 'image' | 'video') => {
    draft.value.imagePath = localPath;
    draft.value.mediaType = mediaType === 'video' ? 'video' : 'image';
    resetTransform();
    await syncMediaSize(
      convertFileSrc(localPath),
      draft.value.mediaType === 'video' ? 'video' : 'image',
      'Failed to load wallpaper size metadata',
    );
  };

  return {
    adoptLocalImage,
    adoptLocalVideo,
    adoptGalleryWallpaper,
  };
}
