import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';

import { useCoverCache } from './useCoverCache';
import { useHomeNavigation } from './useHomeNavigation';
import { usePlayerViewState } from './usePlayerViewState';
import { useToast } from './toast';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { useLibraryStore } from '../features/library/store';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { usePlaybackController } from '../features/playback/usePlaybackController';

/**
 * 集中收集首页页模型的全部外部依赖（路由、store、领域组合函数），
 * 让 useHomePageModel 只负责状态编排与分组输出。
 * 必须在组件 setup 上下文中调用。
 */
export function collectHomePageModelSources() {
  const route = useRoute();
  const router = useRouter();
  const navigation = useHomeNavigation(router);
  const toasts = useToast();
  const addToPlaylistDialog = useAddToPlaylistDialog();

  const libraryRefs = storeToRefs(useLibraryStore());
  const viewState = usePlayerViewState();
  const libraryView = usePlayerLibraryView();
  const playback = usePlaybackController();
  const runtime = useLibraryRuntimeActions();
  const collections = useLibraryCollections();
  const covers = useCoverCache();

  return {
    route,
    router,
    navigation,
    toasts,
    addToPlaylistDialog,
    libraryRefs,
    viewState,
    libraryView,
    playback,
    runtime,
    collections,
    covers,
  };
}

export type HomePageModelSources = ReturnType<typeof collectHomePageModelSources>;
