<script setup lang="ts">
import type { DesktopLyricsAction } from '../../features/desktopLyrics/shared';

// 组件入参：播放态 / 锁定态 / 锁按钮悬浮态 / 收藏态
const props = withDefaults(
  defineProps<{
    isPlaying: boolean;
    isLocked?: boolean;
    isHoveringLock?: boolean;
    isFavorite?: boolean;
  }>(),
  {
    isLocked: false,
    isHoveringLock: false,
    isFavorite: false,
  },
);

// 对外仅暴露 action 事件，由宿主窗口统一分发指令
const emit = defineEmits<{
  (e: 'action', action: DesktopLyricsAction): void;
}>();

const dispatch = (action: DesktopLyricsAction) => emit('action', action);

// —— 图标矢量集中声明：模板通过 :d 绑定引用 ——
const GLYPHS = {
  shackleOpen: 'M7 11V7a5 5 0 0 1 9.9-1',
  shackleShut: 'M7 11V7a5 5 0 0 1 10 0v4',
  brandNote: 'M9 18.5a3.5 3.5 0 1 1-2-3.16V5.72a1 1 0 0 1 .76-.97l9.5-2.3a1 1 0 0 1 1.24.97v11.4a3.5 3.5 0 1 1-2-3.16V6.28l-7.5 1.82v10.4Z',
  gearTeeth: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  cross: 'M6 6l12 12M18 6 6 18',
  rewindBar: 'M7 6v12',
  rewindWedge: 'M17 7 9.5 12 17 17V7Z',
  forwardBar: 'M17 6v12',
  forwardWedge: 'M7 7l7.5 5L7 17V7Z',
  pauseStrokes: 'M9 6v12M15 6v12',
  playSolid: 'M8 5.5v13l10-6.5-10-6.5Z',
  heartOutline: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
};
</script>

<template>
  <!-- 已锁定：仅悬浮锁区域时露出解锁入口 -->
  <div
    v-if="props.isLocked"
    class="pinned-strip"
    @mousedown.stop
  >
    <button
      v-show="props.isHoveringLock"
      class="bar-btn bar-btn--pinned"
      title="解锁桌面歌词"
      @click="dispatch({ type: 'update-settings', patch: { isLocked: false } })"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-15" fill="none" stroke="currentColor" :stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <rect y="11" x="3" height="11" width="18" ry="2" rx="2" />
        <path :d="GLYPHS.shackleOpen" />
      </svg>
    </button>
  </div>

  <!-- 未锁定：上下两条工具带 -->
  <template v-else>
    <div class="bar-upper" @mousedown.stop>
      <span class="brand-dot" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-13" fill="currentColor">
          <path :d="GLYPHS.brandNote" />
        </svg>
      </span>

      <span class="bar-upper-actions">
        <button class="bar-btn" title="锁定桌面歌词" @click="dispatch({ type: 'update-settings', patch: { isLocked: true } })">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-15" fill="none" stroke="currentColor" :stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect y="11" x="3" height="11" width="18" ry="2" rx="2" />
            <path :d="GLYPHS.shackleShut" />
          </svg>
        </button>
        <button class="bar-btn" title="关闭桌面歌词" @click="dispatch({ type: 'close' })">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-15" fill="none" stroke="currentColor" :stroke-width="1.9" stroke-linecap="round">
            <path :d="GLYPHS.cross" />
          </svg>
        </button>
      </span>
    </div>

    <div class="bar-lower" @mousedown.stop>
      <button class="bar-btn" title="桌面歌词设置" @click="dispatch({ type: 'open-settings' })">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-16" fill="none" stroke="currentColor" :stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path :d="GLYPHS.gearTeeth" />
        </svg>
      </button>

      <span class="bar-transport">
        <button class="transport-btn" title="上一首" @click="dispatch({ type: 'prev-song' })">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-14" fill="none" stroke="currentColor" :stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="GLYPHS.rewindBar" />
            <path :d="GLYPHS.rewindWedge" />
          </svg>
        </button>

        <button class="transport-btn transport-btn--lead" :title="props.isPlaying ? '暂停' : '播放'" @click="dispatch({ type: 'toggle-play' })">
          <svg v-if="props.isPlaying" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-18" fill="none" stroke="currentColor" :stroke-width="2" stroke-linecap="round">
            <path :d="GLYPHS.pauseStrokes" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-17" fill="currentColor">
            <path :d="GLYPHS.playSolid" />
          </svg>
        </button>

        <button class="transport-btn" title="下一首" @click="dispatch({ type: 'next-song' })">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-14" fill="none" stroke="currentColor" :stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="GLYPHS.forwardBar" />
            <path :d="GLYPHS.forwardWedge" />
          </svg>
        </button>
      </span>

      <button
        class="bar-btn"
        :class="{ 'bar-btn--loved': props.isFavorite }"
        :title="props.isFavorite ? '取消收藏' : '添加到收藏'"
        @click="dispatch({ type: 'toggle-favorite' })"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-16" :fill="props.isFavorite ? 'currentColor' : 'none'" stroke="currentColor" :stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path :d="GLYPHS.heartOutline" />
        </svg>
      </button>
    </div>
  </template>
</template>

<style scoped>
.icon-13 { width: 13px; height: 13px; }
.icon-14 { width: 14px; height: 14px; }
.icon-15 { width: 15px; height: 15px; }
.icon-16 { width: 16px; height: 16px; }
.icon-17 { width: 17px; height: 17px; }
.icon-18 { width: 18px; height: 18px; }

/* 上带：品牌点 + 锁定/关闭 */
.bar-upper {
  pointer-events: none;
  position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 0;
  color: rgba(255, 255, 255, 0.82);
}

.bar-upper > * { pointer-events: auto; }

.brand-dot {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 999px;
  color: rgba(255, 255, 255, 0.92);
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--desktop-accent-a) 46%, transparent), color-mix(in srgb, var(--desktop-accent-c) 30%, transparent)),
    rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.bar-upper-actions { display: inline-flex; align-items: center; gap: 6px; }

/* 下带：设置 + 走带控制 + 收藏，三栏网格 */
.bar-lower {
  pointer-events: none;
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  padding: 0 12px 8px;
  color: rgba(255, 255, 255, 0.82);
}

.bar-lower > * { pointer-events: auto; }

.bar-lower > .bar-btn:last-child { justify-self: end; }

.bar-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 999px;
  color: rgba(255, 255, 255, 0.78);
  transition: color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.bar-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.13);
}

.bar-btn--loved { color: var(--favorite-color, #f56c6c); }

.bar-btn--loved:hover {
  color: var(--favorite-color, #f56c6c);
  background: color-mix(in srgb, var(--favorite-color, #f56c6c) 16%, transparent);
}

.bar-transport { display: inline-flex; align-items: center; gap: 14px; }

.transport-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.55);
  color: rgba(255, 255, 255, 0.88);
  transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.transport-btn:hover {
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}

.transport-btn--lead { width: 44px; height: 44px; }

.transport-btn--lead:hover { transform: scale(1.05); }

/* 锁定态解锁条：顶部居中悬浮 */
.pinned-strip {
  pointer-events: none;
  position: absolute; top: 8px; left: 50%; z-index: 20;
  transform: translateX(-50%);
}

.pinned-strip .bar-btn {
  pointer-events: auto;
  background: rgba(30, 30, 32, 0.72);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
</style>
