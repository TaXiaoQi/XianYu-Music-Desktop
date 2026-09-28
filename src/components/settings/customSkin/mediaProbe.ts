const IMAGE_DECODE_ERROR = '图片加载失败';
const VIDEO_DECODE_ERROR = '视频加载失败';

export interface MediaSizeMetadata {
  width: number;
  height: number;
}

/** 读取图片自然尺寸；加载失败时以异常告知调用方 */
export const probeImageSize = (src: string) =>
  new Promise<MediaSizeMetadata>((resolve, reject) => {
    const image = new Image();

    const detach = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };

    image.onload = () => {
      const size: MediaSizeMetadata = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      detach();
      resolve(size);
    };

    image.onerror = () => {
      detach();
      reject(new Error(IMAGE_DECODE_ERROR));
    };

    image.src = src;
  });

/** 读取视频帧尺寸；元数据加载失败时以异常告知调用方 */
export const probeVideoSize = (src: string) =>
  new Promise<MediaSizeMetadata>((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const detach = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.src = '';
    };

    video.onloadedmetadata = () => {
      const size: MediaSizeMetadata = {
        width: video.videoWidth,
        height: video.videoHeight,
      };
      detach();
      resolve(size);
    };

    video.onerror = () => {
      detach();
      reject(new Error(VIDEO_DECODE_ERROR));
    };

    video.src = src;
  });
