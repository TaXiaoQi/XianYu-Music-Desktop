<script setup lang="ts">
import { Cast, Link, Share2, X } from 'lucide-vue-next';

import type { Song } from '../../types';

/**
 * 歌曲分享弹窗（对齐移动端分享弹层）：
 * 投屏本就是分享的一种 —— 复制分享链接与投屏到 DLNA 设备统一收口。
 * 实际动作由父级处理：copy → 复制分享文案；cast → 关闭本弹窗并拉起 DLNA 设备弹窗。
 */
const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'copy'): void;
  (e: 'cast'): void;
}>();

const close = () => emit('update:visible', false);

const songName = () => props.song?.title || props.song?.name || '';
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <!-- 遮罩 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        @click="close"
      ></div>

      <!-- 弹窗卡片 -->
      <div
        class="relative bg-white/85 dark:bg-zinc-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all duration-300 border border-white/20 ring-1 ring-black/5 dark:border-white/10"
      >
        <!-- 头部：标题 + 当前歌曲名 -->
        <div class="flex items-center justify-between px-5 pt-4 pb-2">
          <div class="flex items-center gap-2 min-w-0">
            <Share2 class="h-4 w-4 shrink-0 text-[#EC4141]" />
            <div class="min-w-0">
              <h3 class="text-[15px] font-bold text-gray-900 dark:text-white leading-6">分享歌曲</h3>
              <p v-if="songName()" class="text-[11px] text-gray-500 dark:text-white/45 truncate leading-4">
                {{ songName() }}
              </p>
            </div>
          </div>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- 分享选项 -->
        <div class="px-5 pb-5 pt-1 space-y-1.5">
          <button
            class="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors border-gray-200/50 bg-white/40 hover:border-[#EC4141]/30 hover:bg-white/70 dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
            @click="emit('copy')"
          >
            <div class="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 dark:bg-white/8 shrink-0">
              <Link class="h-4.5 w-4.5 text-gray-500 dark:text-white/50" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-medium text-gray-800 dark:text-white/85">复制分享链接</div>
              <div class="text-[10px] text-gray-400 dark:text-white/35 truncate">
                生成歌曲分享链接并复制分享文案
              </div>
            </div>
          </button>

          <button
            class="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors border-gray-200/50 bg-white/40 hover:border-[#EC4141]/30 hover:bg-white/70 dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
            @click="emit('cast')"
          >
            <div class="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 dark:bg-white/8 shrink-0">
              <Cast class="h-4.5 w-4.5 text-gray-500 dark:text-white/50" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-medium text-gray-800 dark:text-white/85">投屏到 DLNA 设备</div>
              <div class="text-[10px] text-gray-400 dark:text-white/35 truncate">
                在局域网电视/音箱上播放这首歌
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
