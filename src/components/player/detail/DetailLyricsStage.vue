<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import type { StyleValue } from 'vue';
import type { TrackMetaRow } from './useTrackMeta';

const QueueList = defineAsyncComponent(() => import('../QueueList.vue'));
const LyricsView = defineAsyncComponent(() => import('../LyricsView.vue'));

defineProps<{
  /** 重型内容放行后才挂载歌词/队列区 */
  mounted?: boolean;
  /** 详情页展开态（驱动入场动画与指针事件） */
  engaged?: boolean;
  /** 是否展示播放队列（替代歌词） */
  queueOpen?: boolean;
  /** 封面隐藏时歌词区居中铺满 */
  maskCover?: boolean;
  /** 电影模式（背景视频）时隐藏歌词区 */
  cinema?: boolean;
  /** 曲目元信息行 */
  metaRows?: TrackMetaRow[];
  /** 入场位移样式 */
  enterStyle?: StyleValue;
}>();
</script>

<template>
  <div v-if="mounted" v-show="!cinema" class="stage-dock">
    <div v-if="!maskCover" class="stage-reserve"></div>
    <div
      class="stage-body"
      :class="[
        maskCover ? 'stage-body--centered' : 'stage-body--sided',
        engaged ? 'stage-body--live' : 'stage-body--idle',
      ]"
      :style="enterStyle"
    >
      <transition name="swap-pop" mode="out-in">
        <QueueList v-if="queueOpen" class="queue-shell" />
        <LyricsView
          v-else
          :meta-info="metaRows"
          :cover-hidden="maskCover"
          :disabled="!engaged"
          :movie-mode="cinema"
          class="stage-fill"
        />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.stage-dock {
  position: relative;
  z-index: 75;
  display: flex;
  min-height: 0;
  flex: 1 1 0%;
  padding-left: 2rem;
  padding-bottom: 5.5rem;
  pointer-events: none;
}

.stage-reserve {
  height: 100%;
  width: 40%;
  min-width: 300px;
  pointer-events: none;
}

.stage-body {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1 1 0%;
  flex-direction: column;
  justify-content: center;
}

.stage-body--centered {
  padding-inline: 8%;
}

.stage-body--sided {
  padding-left: 0.5rem;
  padding-right: 2rem;
}

.stage-body--live {
  pointer-events: auto;
  animation: stage-rise 500ms cubic-bezier(0.22, 1, 0.36, 1) 300ms both;
}

.stage-body--idle {
  pointer-events: none;
  opacity: 0;
}

.stage-fill {
  height: 100%;
}

.queue-shell {
  height: 100%;
  border-radius: 1rem;
  border: 1px solid rgb(255 255 255 / 0.05);
  background-color: rgb(0 0 0 / 0.1);
  padding: 1rem;
  box-shadow: var(--shadow-xl);
  backdrop-filter: var(--blur-sm);
}

.swap-pop-enter-active,
.swap-pop-leave-active {
  transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.swap-pop-enter-from,
.swap-pop-leave-to {
  opacity: 0; transform: scale(0.97) translateY(10px);
}

/* 封面隐藏时强制歌词居中对齐 */
.stage-body--centered :deep(.lyrics-align-left),
.stage-body--centered :deep(.lyrics-align-right) {
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
  --light-align-items: center;
}

@keyframes stage-rise {
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
