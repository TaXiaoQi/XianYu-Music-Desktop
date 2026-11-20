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
import { usePlayerDetailSkin } from '../../composables/usePlayerDetailSkin';
import { useUiStore } from '../../shared/stores/ui';
import { windowApi } from '../../services/tauri/windowApi';
import { preloadAmlLyricPlayer } from './amlLyricPlayerLoader';
import DetailBackdrop from './detail/DetailBackdrop.vue';
import DetailAmllControls from './detail/DetailAmllControls.vue';
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
  showComment: commentOpen,
  currentSong: activeTrack,
  closePlayerDetail: dismissDetail,
} = useStageControl();

const { settings, patchTheme } = useSettings();
const { isImmersiveFullscreen: isFullscreen, fullscreenAnimState } = storeToRefs(useUiStore());
// 详情页皮肤：类名 + 主题派生 CSS 变量（amll 皮肤的全部配色都走这组变量）
const { skinClass, skinVars, isAmllSkin } = usePlayerDetailSkin();
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

// —— 进出过渡静置窗 ——
// morph/slide 动画期间临时关闭 plus-lighter blend：全屏重混合（歌词/信息/控制簇
// × WebGL 背景）是 AMLL 下动画卡顿与封面"停留数秒"（700ms 过渡被掉帧拖长）的主因。
// 不冻结 fluid canvas——WebGL 默认不保留绘制缓冲，过渡期停绘会闪黑。
const detailTransitioning = ref(false);
const detailTransitionDirection = ref<'enter' | 'exit'>('exit');
let settlingTimer: ReturnType<typeof setTimeout> | null = null;
watch(detailShown, (open) => {
  detailTransitionDirection.value = open ? 'enter' : 'exit';
  detailTransitioning.value = true;
  if (settlingTimer) clearTimeout(settlingTimer);
  settlingTimer = setTimeout(() => {
    detailTransitioning.value = false;
    settlingTimer = null;
  }, 750);
});

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

// macOS 走系统原生红绿灯（titleBarStyle: Overlay），绿键触发的系统全屏
// 不经过下方按钮的沉浸状态机，需监听窗口全屏变化把两侧状态拉齐。
const IS_MACOS = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

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

// —— mac 红绿灯绿键 ⇆ 沉浸模式的状态拉齐 ——
// 绿键进出系统全屏时不走 toggleFullscreen 的动画链，这里检测到
// 原生全屏态与沉浸态不一致时补走一次 toggleFullscreen（幂等），
// 使隐藏光标、顶栏联动、Esc 退出与按钮路径完全一致。
let trafficLightSyncing = false;
const syncImmersiveWithTrafficLight = async () => {
  if (trafficLightSyncing || fullscreenAnimState.value) return;
  let nativeFullscreen: boolean;
  try {
    nativeFullscreen = await hostWindow.isFullscreen();
  } catch {
    return;
  }
  if (nativeFullscreen === isFullscreen.value) return;
  trafficLightSyncing = true;
  try {
    await toggleFullscreen();
  } finally {
    trafficLightSyncing = false;
  }
};
let unlistenTrafficLight: (() => void) | null = null;

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

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown);
  if (IS_MACOS) {
    unlistenTrafficLight = await hostWindow.onResized(() => {
      void syncImmersiveWithTrafficLight();
    });
  }
});

onBeforeUnmount(() => {
  unlistenTrafficLight?.();
  unlistenTrafficLight = null;
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
      skinClass,
      detailShown ? 'detail-root--live' : 'detail-root--idle',
      detailShown && pointerAsleep ? 'detail-root--asleep' : '',
      detailTransitioning ? 'detail-root--settling' : '',
    ]"
    :style="skinVars"
    @contextmenu.prevent="openTrackMenu"
  >
    <div
      class="detail-shell"
      :class="[
        detailShown && (isFullscreen || fullscreenAnimState) ? 'shell-flush' : 'shell-raised',
        // mac 全屏动画交给系统原生（Space 切换）；前端再叠 CSS 缩放动画会在
        // 动画结束回收合成层时于透明窗口上闪一帧，故 mac 不挂动画 class。
        !IS_MACOS && fullscreenAnimState === 'entering' ? 'fs-entering' : '',
        !IS_MACOS && fullscreenAnimState === 'exiting' ? 'fs-exiting' : '',
      ]"
    >
      <DetailBackdrop
        :ready="heavyMounted"
        :active="detailShown"
        :mesh-on="(isAmllSkin || settings.theme.playerDetailMeshBackground) && !isCinemaMode"
        :mesh-mode="isAmllSkin ? 'fluid' : 'polygon'"
      />

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
          :amll="isAmllSkin"
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
        :amll="isAmllSkin"
        :genie-active="detailTransitioning"
        :genie-direction="detailTransitionDirection"
        @toggle-cover="handleToggleCover"
      />
      <PlayerDetailVinyl
        v-else-if="preferVinylStage && (coverReady || heavyMounted)"
        :is-expanded="detailShown"
        :cover-hidden="coverHidden"
        @toggle-cover="handleToggleCover"
      />

      <!-- AMLL 皮肤：控制簇竖排在封面下方左列（全局底栏此时隐藏） -->
      <DetailAmllControls
        v-if="isAmllSkin && detailShown && !isCinemaMode"
        :title="marqueeTitle"
        :artist="marqueeArtist"
        :album="activeTrack?.album"
        @more="openTrackMenu"
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

      <!-- AMLL 皮肤：右下浮钮（队列 / 评论），对齐参考图位置 -->
      <div v-if="isAmllSkin && detailShown" class="amll-float-actions">
        <button
          class="amll-float-btn"
          :class="queueOpen ? 'amll-float-btn--on' : ''"
          title="播放队列"
          aria-label="播放队列"
          @click="queueOpen = !queueOpen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="amll-float-icon"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
        </button>
        <button
          class="amll-float-btn"
          :class="commentOpen ? 'amll-float-btn--on' : ''"
          title="评论"
          aria-label="评论"
          @click="commentOpen = !commentOpen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="amll-float-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </button>
      </div>
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

<style scoped> /* 样式 */
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

/* mac 原生全屏动画逐帧改写视口尺寸：封面形变的 700ms 过渡会滞后于实时
   缩放、并在动画收尾突进落位造成跳变，故全屏链路内暂停形变过渡，让
   尺寸与主页一样逐帧跟随；页面展开/收起的形变动画在非全屏时不受影响。 */
.shell-flush :deep(.morph-stage) {
  transition: none !important;
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
/* AMLL 皮肤：右下浮钮（队列/评论），颜色走皮肤变量 */
.amll-float-actions {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 80;
  display: flex;
  gap: 12px;
}

.amll-float-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4em;
  height: 4em;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--skin-text, #fff) 10%, transparent);
  color: var(--skin-text, #fff);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: background 160ms ease, transform 160ms ease;
}

.amll-float-btn:hover {
  background: color-mix(in srgb, var(--skin-text, #fff) 18%, transparent);
  transform: translateY(-2px);
}

.amll-float-btn--on {
  background: color-mix(in srgb, var(--skin-accent, #ec4141) 26%, transparent);
  color: var(--skin-text, #fff);
}

.amll-float-icon {
  width: 1.4em;
  height: 1.4em;
}
</style>
