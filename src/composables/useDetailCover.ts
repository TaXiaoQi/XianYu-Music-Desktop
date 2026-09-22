import { computed, ref, watch, type Ref } from 'vue';
import { useCoverCache } from './useCoverCache';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlaybackStore } from '../features/playback/store';
import { storeToRefs } from 'pinia';

/**
 * 播放详情页封面加载组合式函数。
 * 从 PlayerDetailLeft.vue 抽取，供经典封面与黑胶唱片两种皮肤共用：
 * - 缩略图 + 大图两级加载（大图异步，带请求序号防竞态）
 * - 加载失败回退缩略图、最终 placeholder
 * - 前后曲大图预加载与 retain
 */
export function useDetailCover(options: {
  /** 详情页是否展开（收起状态下大图加载直接跳过） */
  isExpanded: Ref<boolean>;
}) {
  const { isExpanded } = options;

  const {
    currentSong, currentCover, currentCoverPath, currentCoverFull,
  } = usePlaybackController();
  const { getFullCoverUrl, loadFullCover, preloadFullCovers, retainFullCoverPaths } = useCoverCache();
  const playbackStore = usePlaybackStore();
  const { playQueue, tempQueue } = storeToRefs(playbackStore);

  const currentSongPath = computed(() => currentSong.value?.path ?? '');

  const localCoverUrl = ref('');
  const localCoverLoadFailed = ref(false);
  const bigCoverLoaded = ref(false);
  const fullCoverLoading = ref(false);
  let fullCoverRequestId = 0;

  const currentLocalCoverUrl = computed(() => {
    if (isExpanded.value && currentCoverPath.value !== currentSongPath.value) {
      return '';
    }

    return localCoverUrl.value;
  });
  const currentBigCoverUrl = computed(() => (
    isExpanded.value && currentCoverFull.value && currentCoverFull.value !== currentLocalCoverUrl.value
      ? currentCoverFull.value
      : ''
  ));
  const displayedLocalCoverUrl = computed(() => (
    localCoverLoadFailed.value ? '' : currentLocalCoverUrl.value
  ));
  const showCoverPlaceholder = computed(() => !displayedLocalCoverUrl.value && !bigCoverLoaded.value);

  const getRetainedFullCoverPaths = (path: string) => {
    if (!path) {
      return [];
    }

    const retainedPaths: string[] = [path];
    const pushUniquePath = (candidatePath: string | undefined) => {
      if (!candidatePath || retainedPaths.includes(candidatePath)) {
        return;
      }

      retainedPaths.push(candidatePath);
    };

    pushUniquePath(tempQueue.value[0]?.path);

    const queue = playQueue.value;
    const currentIndex = queue.findIndex(song => song.path === path);
    if (currentIndex >= 0 && queue.length > 1) {
      pushUniquePath(queue[(currentIndex - 1 + queue.length) % queue.length]?.path);
      pushUniquePath(queue[(currentIndex + 1) % queue.length]?.path);
    }

    return retainedPaths.slice(0, 4);
  };

  watch(currentCover, (cover) => {
    localCoverUrl.value = cover || '';
  }, { immediate: true });

  watch([currentSongPath, currentLocalCoverUrl], () => {
    localCoverLoadFailed.value = false;
  }, { immediate: true });

  watch([currentSongPath, isExpanded], async ([path, expanded]) => {
    const cachedFullCoverUrl = path ? getFullCoverUrl(path) : '';
    bigCoverLoaded.value = Boolean(cachedFullCoverUrl);
    fullCoverLoading.value = false;

    if (!path || !expanded) {
      fullCoverRequestId += 1;
      return;
    }

    const retainedPaths = getRetainedFullCoverPaths(path);
    retainFullCoverPaths(retainedPaths);

    if (cachedFullCoverUrl) {
      currentCoverFull.value = cachedFullCoverUrl;
      preloadFullCovers(retainedPaths.filter(candidatePath => candidatePath !== path));
      return;
    }

    const requestId = ++fullCoverRequestId;
    const fullCoverLoad = loadFullCover(path);
    fullCoverLoading.value = true;
    preloadFullCovers(retainedPaths.filter(candidatePath => candidatePath !== path));

    try {
      const fullCoverUrl = await fullCoverLoad;
      if (requestId !== fullCoverRequestId || path !== currentSongPath.value || !isExpanded.value) return;
      if (fullCoverUrl) {
        currentCoverFull.value = fullCoverUrl;
      }
      fullCoverLoading.value = false;
    } catch {
      if (requestId !== fullCoverRequestId || path !== currentSongPath.value || !isExpanded.value) return;
      fullCoverLoading.value = false;
    }
  }, { immediate: true });

  watch(isExpanded, (expanded) => {
    if (expanded) {
      return;
    }

    bigCoverLoaded.value = false;
    fullCoverLoading.value = false;
  });

  const onBigCoverLoad = () => {
    bigCoverLoaded.value = true;
    fullCoverLoading.value = false;
  };

  const onBigCoverError = () => {
    bigCoverLoaded.value = false;
    fullCoverLoading.value = false;
  };

  const onLocalCoverError = () => {
    localCoverLoadFailed.value = true;
  };

  return {
    currentSongPath,
    displayedLocalCoverUrl,
    currentBigCoverUrl,
    currentLocalCoverUrl,
    showCoverPlaceholder,
    fullCoverLoading,
    bigCoverLoaded,
    onBigCoverLoad,
    onBigCoverError,
    onLocalCoverError,
  };
}
