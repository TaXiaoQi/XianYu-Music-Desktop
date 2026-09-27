<script setup lang="ts">
// 文件夹右键菜单：定位、边界翻转、外部点击关闭与分层操作项
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue';
import type { CSSProperties } from 'vue';

import { shouldShowFolderManagementActions } from './folderContextMenuState';

const props = defineProps<{
  folderPath: string;
  visible: boolean;
  x: number;
  y: number;
  isRootFolder?: boolean;
  isManagementMode?: boolean;
  selectedCount?: number;
}>();

const emit = defineEmits([
  'cancel',
  'close',
  'play',
  'addToQueue',
  'createPlaylist',
  'addToPlaylist',
  'openFolder',
  'remove',
  'refresh',
  'new-folder',
  'delete-disk',
]);

const panelRef = ref<HTMLElement | null>(null);
const panelBox = ref({ width: 0, height: 0 });

// 显示时等渲染完成后测量实际尺寸，隐藏时清零以便下次重新测量
watch(
  () => props.visible,
  async (shown) => {
    if (!shown) {
      panelBox.value = { width: 0, height: 0 };
      return;
    }

    await nextTick();
    if (!panelRef.value) return;

    panelBox.value = {
      width: panelRef.value.offsetWidth,
      height: panelRef.value.offsetHeight,
    };
  },
  { immediate: true },
);

// 超出视口时向上/向左翻转，并始终保留 8px 安全边距
const panelPlacement = computed<CSSProperties>(() => {
  if (!props.visible) {
    return {};
  }

  const { width, height } = panelBox.value;
  const flipX = props.x + width > window.innerWidth;
  const flipY = props.y + height > window.innerHeight;

  return {
    left: `${Math.max(8, flipX ? props.x - width : props.x)}px`,
    top: `${Math.max(8, flipY ? props.y - height : props.y)}px`,
    visibility: height === 0 ? 'hidden' : 'visible',
    transformOrigin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
  };
});

const onGlobalMousedown = (event: MouseEvent) => {
  if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
    emit('cancel');
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', onGlobalMousedown));
onUnmounted(() => window.removeEventListener('mousedown', onGlobalMousedown));

const rowClass = 'song-menu-item transition-colors flex items-center group px-4 py-2.5 cursor-pointer';
const sectionLabelClass = 'song-menu-section text-gray-400 px-4 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em]';
const actionRowClass = 'song-menu-item group transition-colors flex items-center text-left px-4 py-2.5 w-full cursor-pointer';
const lockedRowClass = 'song-menu-item transition-colors flex items-center text-left px-4 py-2.5 w-full opacity-45 cursor-not-allowed';

const managementUnlocked = computed(() => shouldShowFolderManagementActions(!!props.isManagementMode));
const removableFromLibrary = computed(() => !!props.isRootFolder);
const isBatchMode = computed(() => !!props.selectedCount && props.selectedCount > 1);
const batchSummary = computed(() => `已选择 ${props.selectedCount} 个文件夹`);

// 受管理权限约束的动作，未授权时不触发
const sendWhenPermitted = (eventName: 'remove' | 'new-folder' | 'delete-disk', permitted: boolean) => {
  if (permitted) {
    emit(eventName, props.folderPath);
  }
};

// 逐项错峰入场动画的延迟变量
const staggerStyle = (step: number): CSSProperties =>
  ({ '--row-stagger': `${step * 14}ms` } as CSSProperties);

const labels = {
  play: '播放',
  enqueue: '添加到播放队列',
  toPlaylist: '创建为歌单',
  intoPlaylist: '添加到歌单',
  revealInExplorer: '打开所在目录',
  rescan: '刷新文件夹内容',
  detachFromLibrary: '从音乐库移除',
  createFolder: '新建文件夹',
  wipeOnDisk: '删除文件夹（本地）',
  batchDetach: '批量移除文件夹',
  managementHint: '仅管理模式可用',
} as const;

const playFolder = () => emit('play');
const enqueueFolder = () => emit('addToQueue');
const buildPlaylistFromFolder = () => emit('createPlaylist');
const collectFolderToPlaylist = () => emit('addToPlaylist');
const revealFolderOnDisk = () => emit('openFolder');
const rescanFolder = () => emit('refresh');
const detachSelection = () => emit('remove');
</script>

<template>
  <Teleport to="body">
    <Transition name="song-menu-pop" appear>
      <div
        ref="panelRef"
        v-if="visible"
        class="fixed z-[9999] rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 select-none min-w-[220px] shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="panelPlacement"
        @contextmenu.prevent
      >
      <template v-if="isBatchMode">
        <div class="song-menu-section text-xs text-gray-400 px-4 py-2" :style="staggerStyle(0)">
          {{ batchSummary }}
        </div>
        <div
          class="song-menu-item text-[#EC4141] flex px-4 py-2.5 items-center cursor-pointer transition-colors"
          :style="staggerStyle(1)"
          @click="detachSelection"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <span>{{ labels.batchDetach }}</span>
        </div>
      </template>

      <template v-else>
        <div :class="rowClass" :style="staggerStyle(0)" @click="playFolder">
          <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
              <path
                clip-rule="evenodd"
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
              />
            </svg>
          </div>
          <span>{{ labels.play }}</span>
        </div>

        <div :class="rowClass" :style="staggerStyle(1)" @click="enqueueFolder">
          <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span>{{ labels.enqueue }}</span>
        </div>

        <div class="song-menu-divider" :style="staggerStyle(2)"></div>

        <div :class="rowClass" :style="staggerStyle(3)" @click="buildPlaylistFromFolder">
          <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span>{{ labels.toPlaylist }}</span>
        </div>

        <div :class="rowClass" :style="staggerStyle(4)" @click="collectFolderToPlaylist">
          <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span>{{ labels.intoPlaylist }}</span>
        </div>

        <div :class="rowClass" :style="staggerStyle(5)" @click="revealFolderOnDisk">
          <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span>{{ labels.revealInExplorer }}</span>
        </div>

        <div class="song-menu-divider" :style="staggerStyle(6)"></div>

        <div :class="rowClass" :style="staggerStyle(7)" @click="rescanFolder">
          <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <span>{{ labels.rescan }}</span>
        </div>

        <button
          v-if="isRootFolder"
          type="button"
          :class="removableFromLibrary ? actionRowClass : lockedRowClass"
          :style="staggerStyle(8)"
          :disabled="!removableFromLibrary"
          @click="sendWhenPermitted('remove', removableFromLibrary)"
        >
          <div
            class="mr-3 flex h-5 w-5 items-center justify-center"
            :class="removableFromLibrary ? 'group-hover:text-gray-800 text-gray-500' : 'text-gray-400'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
              <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
            </svg>
          </div>
          <div class="min-w-0">{{ labels.detachFromLibrary }}</div>
        </button>

        <template v-if="managementUnlocked">
          <div class="song-menu-divider" :style="staggerStyle(9)"></div>
          <div :class="sectionLabelClass" :style="staggerStyle(10)">{{ labels.managementHint }}</div>

          <button
            type="button"
            :class="actionRowClass"
            :style="staggerStyle(11)"
            @click="sendWhenPermitted('new-folder', managementUnlocked)"
          >
            <div class="mr-3 flex h-5 w-5 items-center justify-center group-hover:text-gray-800 text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
                <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div class="min-w-0">{{ labels.createFolder }}</div>
          </button>

          <button
            type="button"
            :class="actionRowClass"
            :style="staggerStyle(12)"
            @click="sendWhenPermitted('delete-disk', managementUnlocked)"
          >
            <div class="mr-3 flex h-5 w-5 items-center justify-center text-[#EC4141]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" class="h-5 w-5">
                <path
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
                <path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 11v6m4-6v6" />
              </svg>
            </div>
            <div class="min-w-0 font-bold text-[#EC4141]">{{ labels.wipeOnDisk }}</div>
          </button>
        </template>
      </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.song-menu-pop-enter-active,
.song-menu-pop-leave-active {
  will-change: transform, opacity;
}

.song-menu-pop-enter-active { animation: menu-bounce-in 240ms cubic-bezier(0.16, 1, 0.3, 1); }

.song-menu-pop-leave-active { animation: menu-fade-away 140ms cubic-bezier(0.4, 0, 0.2, 1); }

.song-menu-pop-enter-active .song-menu-section,
.song-menu-pop-enter-active .song-menu-divider,
.song-menu-pop-enter-active .song-menu-item {
  animation: menu-row-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--row-stagger, 0ms);
}

.song-menu-item { margin: 0 0.375rem; border-radius: 12px; }

.song-menu-item:hover:not(:disabled) { background: rgba(15, 23, 42, 0.055); }

.song-menu-divider {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

@keyframes menu-bounce-in {
  0% { opacity: 0; transform: translateY(10px) scale(0.965); }
  72% { opacity: 1; transform: translateY(-1px) scale(1.008); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes menu-fade-away {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(4px) scale(0.985); }
}

@keyframes menu-row-in {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
</style>
