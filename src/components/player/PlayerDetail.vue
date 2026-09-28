<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow as locateHostWindow } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';
import { isFlyingCover } from '../../composables/useFlyingCover';
import { loadLyrics, lyricsSettings, lyricsStatus } from '../../composables/lyrics/state';
import { useSharedTransition as useEntranceSync } from '../../composables/useSharedTransition';
import { useToast as useNotifier } from '../../composables/toast';
import { useBilibiliVideoBackground } from '../../composables/useBilibiliVideoBackground';
import { usePlaybackController as useStageControl } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useUiStore } from '../../shared/stores/ui';
import { windowApi } from '../../services/tauri/windowApi';
import { preloadAmlLyricPlayer } from './amlLyricPlayerLoader';
import DetailBackdrop from './detail/DetailBackdrop.vue';
import DetailLyricsStage from './detail/DetailLyricsStage.vue';
import DetailNowPlaying from './detail/DetailNowPlaying.vue';
import DetailTopBar from './detail/DetailTopBar.vue';
import { useDetailChrome } from './detail/useDetailChrome';
import { useDetailEntrance } from './detail/useDetailEntrance';
import { usePointerNapping } from './detail/usePointerNapping';
import { isStreamPath, useSongDetailLookup } from './detail/useSongDetailLookup';
import { useTrackMeta } from './detail/useTrackMeta';

const PlayerDetailLeft = defineAsyncComponent(() => import('./PlayerDetailLeft.vue'));
const PlayerDetailVinyl = defineAsyncComponent(() => import('./PlayerDetailVinyl.vue'));
const PlayerDetailContextMenu = defineAsyncComponent(() => import('../overlays/PlayerDetailContextMenu.vue'));
const LyricsReplacementModal = defineAsyncComponent(() => import('../overlays/LyricsReplacementModal.vue'));

const {
  showPlayerDetail: detailShown,
  showQueue: queueOpen,
  currentSong: activeTrack,
  closePlayerDetail: dismissDetail,
} = useStageControl();

const { settings, patchTheme } = useSettings();
const { isImmersiveFullscreen: isFullscreen, fullscreenAnimState } = storeToRefs(useUiStore());
const { showToast } = useNotifier();
const {
  requested: filmRequested,
  loading: filmLoading,
  sourceSongPath: filmSongPath,
  videoUrl: filmVideoUrl,
  start: startFilmBackground,
  stop: stopFilmBackground,
} = useBilibiliVideoBackground();

const isCinemaMode = computed(() => filmRequested.value && Boolean(filmVideoUrl.value));

const { revealed: barRevealed, peek: revealBarOnHover, relax: relaxBarOnLeave, flashReveal: flashBar, conceal: concealBar } = useDetailChrome();
const { napping: pointerAsleep, engage: engagePointerSentry, release: releasePointerSentry } = usePointerNapping();
const { staggerPhase } = useEntranceSync();
const { enterShift } = useDetailEntrance(detailShown, staggerPhase);

const activeTrackPath = computed(() => activeTrack.value?.path ?? '');
const { detail: currentSongDetail, reset: forgetDetail } = useSongDetailLookup(detailShown, activeTrackPath);
const { rows: metaRows } = useTrackMeta(activeTrack, currentSongDetail);

// —— 重型内容（背景/歌词区）延后一帧挂载，避免展开动画掉帧 ——
const heavyMounted = ref(false);
let heavyRafId: number | null = null;

const requestHeavyMount = () => {
  if (heavyMounted.value || heavyRafId !== null) {
    return;
  }
  heavyRafId = requestAnimationFrame(() => {
    heavyRafId = null;
    if (detailShown.value) {
      heavyMounted.value = true;
    }
  });
};

// —— 首支曲目出现前不渲染封面组件，等待封面飞入动画结束（超时兜底） ——
const coverReady = ref(false);
watch(activeTrack, (track) => {
  if (!track || coverReady.value) {
    return;
  }
  if (isFlyingCover.value) {
    const stopWatchingFlight = watch(isFlyingCover, (flying) => {
      if (!flying) {
        coverReady.value = true;
        stopWatchingFlight();
      }
    });
    setTimeout(() => {
      if (!coverReady.value) {
        coverReady.value = true;
      }
    }, 3000);
    return;
  }
  coverReady.value = true;
}, { immediate: true });

// —— 背景视频绑定的曲目被切走时收尾 ——
watch(activeTrackPath, (path) => {
  if (filmSongPath.value && filmSongPath.value !== path) {
    void stopFilmBackground();
  }
});

const coverHidden = ref(false);

const handleToggleCover = () => {
  coverHidden.value = !coverHidden.value;
  patchTheme({ lastPlayerDetailCoverVisible: !coverHidden.value });
};

// —— 封面显隐偏好：强制隐藏 / 记住上次选择，关闭详情页时复位 ——
watch(detailShown, (open) => {
  if (open && isCinemaMode.value) {
    coverHidden.value = true;
    return;
  }
  if (!open) {
    coverHidden.value = false;
    return;
  }
  const { playerDetailCoverBehavior, lastPlayerDetailCoverVisible } = settings.value.theme;
  coverHidden.value = playerDetailCoverBehavior === 'hide'
    || (playerDetailCoverBehavior === 'remember' && !lastPlayerDetailCoverVisible);
});

// —— 进入电影模式前保存封面/模糊状态，退出时还原 ——
const coverStateBeforeFilm = ref(false);
const blurLevelBeforeFilm = ref(0);
watch(isCinemaMode, (filmOn) => {
  if (filmOn) {
    coverStateBeforeFilm.value = coverHidden.value;
    blurLevelBeforeFilm.value = lyricsSettings.backgroundBlur;
    coverHidden.value = true;
    lyricsSettings.backgroundBlur = 0;
    return;
  }
  coverHidden.value = coverStateBeforeFilm.value;
  lyricsSettings.backgroundBlur = blurLevelBeforeFilm.value;
}, { flush: 'post' });

// —— 沉浸式全屏（保留最大化→全屏的平滑过渡） ——
const hostWindow = locateHostWindow();
const FS_MORPH_MS = 320;

const doMinimize = () => hostWindow.minimize();

const applyImmersive = async (enter: boolean) => {
  await windowApi.setImmersiveFullscreen(enter);
  isFullscreen.value = enter;
};

const toggleFullscreen = async () => {
  if (fullscreenAnimState.value) {
    return;
  }

  if (!isFullscreen.value) {
    fullscreenAnimState.value = 'entering';
    engagePointerSentry();
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    try {
      await applyImmersive(true);
    } catch (error) {
      console.error('进入全屏失败:', error);
      releasePointerSentry();
      isFullscreen.value = false;
      fullscreenAnimState.value = null;
      return;
    }
    setTimeout(() => {
      fullscreenAnimState.value = null;
    }, FS_MORPH_MS);
    return;
  }

  fullscreenAnimState.value = 'exiting';
  releasePointerSentry();
  setTimeout(async () => {
    try {
      await applyImmersive(false);
    } catch (error) {
      console.error('退出全屏失败:', error);
      isFullscreen.value = true;
      engagePointerSentry();
      fullscreenAnimState.value = null;
      return;
    }
    fullscreenAnimState.value = null;
  }, FS_MORPH_MS);
};

const flipWindowState = async () => {
  if (isFullscreen.value || fullscreenAnimState.value === 'exiting') {
    return;
  }
  await windowApi.smartToggleMaximize();
};

const shutdownApp = async () => {
  if (settings.value.closeToTray) return hostWindow.hide();
  return hostWindow.close();
};

// —— 播放详情页皮肤：电影模式优先级更高，视频模式下不启用黑胶 ——
const preferVinylStage = computed(
  () => settings.value.theme.playerDetailStyle === 'vinyl' && !isCinemaMode.value,
);

// —— 顶栏/标题文案 ——
const marqueeTitle = computed(() => (activeTrack.value ? activeTrack.value.title || activeTrack.value.name : ''));
const marqueeArtist = computed(() => activeTrack.value?.artist ?? '');

// —— 右键菜单与歌词替换入口 ——
const trackMenuShown = ref(false);
const trackMenuX = ref(0);
const trackMenuY = ref(0);
const lyricToolShown = ref(false);

const openTrackMenu = (e: MouseEvent) => {
  if (!activeTrack.value || !detailShown.value) return;
  e.preventDefault();
  trackMenuX.value = e.clientX;
  trackMenuY.value = e.clientY;
  trackMenuShown.value = true;
};

const closeTrackMenu = () => {
  trackMenuShown.value = false;
};

const launchLyricTool = () => {
  trackMenuShown.value = false;
  lyricToolShown.value = true;
};

const flipFilmBackground = async () => {
  const track = activeTrack.value;
  trackMenuShown.value = false;
  if (!track) return;

  if (filmRequested.value) {
    await stopFilmBackground();
    showToast('背景视频已关闭，封面与歌词已恢复', 'info');
    return;
  }

  showToast('正在解析并加载背景视频…', 'info');
  try {
    const started = await startFilmBackground(track);
    if (started) {
      showToast('背景视频已开启', 'success');
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '背景视频加载失败', 'error');
  }
};

// —— 详情页开合的统一入口编排 ——
watch(detailShown, (open) => {
  if (!open) {
    concealBar();
    forgetDetail();
    releasePointerSentry();
    return;
  }

  flashBar();
  requestHeavyMount();
  const trackPathNow = activeTrack.value?.path;
  if (trackPathNow && isStreamPath(trackPathNow)) {
    void preloadAmlLyricPlayer().catch(() => {});
  }
  if (activeTrack.value?.path && lyricsStatus.value !== 'ready') {
    void loadLyrics();
  }
  if (isFullscreen.value) {
    engagePointerSentry();
  }
});

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  if (isFullscreen.value) {
    void toggleFullscreen();
    return;
  }
  dismissDetail();
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  if (heavyRafId !== null) {
    cancelAnimationFrame(heavyRafId);
    heavyRafId = null;
  }
  window.removeEventListener('keydown', handleKeydown);
  releasePointerSentry();
  void stopFilmBackground();
});
</script>

<template>
  <div
    class="detail-root"
    :class="[
      detailShown ? 'detail-root--live' : 'detail-root--idle',
      detailShown && pointerAsleep ? 'detail-root--asleep' : '',
    ]"
    @contextmenu.prevent="openTrackMenu"
  >
    <div
      class="detail-shell"
      :class="[
        detailShown && (isFullscreen || fullscreenAnimState) ? 'shell-flush' : 'shell-raised',
        fullscreenAnimState === 'entering' ? 'fs-entering' : '',
        fullscreenAnimState === 'exiting' ? 'fs-exiting' : '',
      ]"
    >
      <DetailBackdrop :ready="heavyMounted" :active="detailShown" :mesh-on="settings.theme.playerDetailMeshBackground && !isCinemaMode" />

      <div
        class="chrome-row"
        :class="detailShown ? 'chrome-row--in' : ''"
        :style="enterShift(1, 'y', -10)"
        @mouseenter="revealBarOnHover"
        @mousemove="revealBarOnHover"
        @mouseleave="relaxBarOnLeave"
      >
        <div class="chrome-hit" :class="detailShown ? 'chrome-hit--live' : 'chrome-hit--dead'"></div>
        <DetailTopBar
          :revealed="barRevealed"
          :shown="detailShown"
          :cinema="isCinemaMode"
          :mask-cover="coverHidden"
          :fullscreen-on="isFullscreen"
          :has-track="Boolean(activeTrack)"
          :track-title="marqueeTitle"
          :track-artist="marqueeArtist"
          @collapse="dismissDetail"
          @toggle-cover="handleToggleCover"
          @toggle-fullscreen="toggleFullscreen"
          @minimize="doMinimize"
          @toggle-maximize="flipWindowState"
          @close-window="shutdownApp"
        />
      </div>

      <DetailNowPlaying
        v-if="activeTrack && !isCinemaMode"
        :shown="detailShown"
        :enter-style="enterShift(1, 'y', -6)"
        :title="marqueeTitle"
        :artist="marqueeArtist"
      />

      <PlayerDetailLeft
        v-if="!preferVinylStage && (coverReady || heavyMounted)"
        :is-expanded="detailShown"
        :cover-hidden="coverHidden"
        @toggle-cover="handleToggleCover"
      />
      <PlayerDetailVinyl
        v-else-if="preferVinylStage && (coverReady || heavyMounted)"
        :is-expanded="detailShown"
        :cover-hidden="coverHidden"
        @toggle-cover="handleToggleCover"
      />

      <DetailLyricsStage
        :mounted="heavyMounted"
        :engaged="detailShown"
        :queue-open="queueOpen"
        :mask-cover="coverHidden"
        :cinema="isCinemaMode"
        :meta-rows="metaRows"
        :enter-style="enterShift(2, 'x', 20)"
      />
    </div>

    <PlayerDetailContextMenu
      v-if="trackMenuShown"
      :visible="trackMenuShown"
      :x="trackMenuX"
      :y="trackMenuY"
      :song="activeTrack"
      :video-background-requested="filmRequested"
      :video-background-loading="filmLoading"
      @close="closeTrackMenu"
      @change-lyrics="launchLyricTool"
      @toggle-video-background="flipFilmBackground"
    />
    <LyricsReplacementModal
      v-if="lyricToolShown"
      :visible="lyricToolShown"
      :song="activeTrack"
      @close="lyricToolShown = false"
    />
  </div>
</template>

<style scoped>
.detail-root {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  display: flex;
  height: 100vh;
  flex-direction: column;
  overflow: visible;
  font-family: var(--font-sans);
  color: var(--color-white);
  -webkit-user-select: none;
  user-select: none;
}

.detail-root--live {
  pointer-events: auto;
}

.detail-root--idle {
  pointer-events: none;
}

.detail-root--asleep,
.detail-root--asleep :deep(*) {
  cursor: none !important;
}

.detail-shell {
  position: relative;
  display: flex;
  height: 100vh;
  width: 100%;
  flex-direction: column;
}

.shell-flush {
  padding-top: 0;
}

.shell-raised {
  padding-top: calc(100vh - 100%);
}

.chrome-row {
  position: relative;
  z-index: 60;
  height: 4rem;
}

.chrome-row--in {
  animation: panel-rise 500ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both;
}

.chrome-hit {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 4rem;
}

.chrome-hit--live {
  pointer-events: auto;
}

.chrome-hit--dead {
  pointer-events: none;
}

@keyframes panel-rise {
  from {
    opacity: 0;
    transform: translate(-30px, 30px);
  }
  to {
    opacity: 1;
    transform: translate(0, 0);
  }
}
</style>
