<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  playlistName: string;
  selectedCount?: number;
}>();

const emit = defineEmits(['close', 'play', 'addToQueue', 'delete', 'cancel']);

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      if (menuRef.value) {
        menuSize.value = {
          width: menuRef.value.offsetWidth,
          height: menuRef.value.offsetHeight,
        };
      }
      return;
    }

    menuSize.value = { width: 0, height: 0 };
  },
  { immediate: true },
);

const menuStyle = computed<CSSProperties>(() => {
  if (!props.visible) {
    return {};
  }

  let top = props.y;
  let left = props.x;
  let verticalOrigin = 'top';
  let horizontalOrigin = 'left';

  if (top + menuSize.value.height > window.innerHeight) {
    top = props.y - menuSize.value.height;
    verticalOrigin = 'bottom';
  }

  if (left + menuSize.value.width > window.innerWidth) {
    left = props.x - menuSize.value.width;
    horizontalOrigin = 'right';
  }

  return {
    left: `${Math.max(8, left)}px`,
    top: `${Math.max(8, top)}px`,
    visibility: menuSize.value.height === 0 ? 'hidden' : 'visible' as any,
    transformOrigin: `${horizontalOrigin} ${verticalOrigin}`,
  };
});

const handleClickOutside = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('cancel');
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const motionDelay = (index: number): CSSProperties => ({
  '--menu-item-delay': `${index * 14}ms`,
} as CSSProperties);
</script>

<template>
  <Teleport to="body">
    <Transition name="song-menu-pop" appear>
      <div
        v-if="visible"
        ref="menuRef"
        class="fixed z-[9999] min-w-[220px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="menuStyle"
        @contextmenu.prevent
      >
        <div class="song-menu-section px-4 py-2 text-xs text-gray-400" :style="motionDelay(0)">
          {{ selectedCount && selectedCount > 1 ? `已选中 ${selectedCount} 个歌单` : playlistName }}
        </div>

        <div
          v-if="!selectedCount || selectedCount <= 1"
          class="song-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors"
          :style="motionDelay(1)"
          @click="emit('play')"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
          </div>
          <span>播放</span>
        </div>

        <div
          class="song-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors"
          :style="motionDelay(2)"
          @click="emit('addToQueue')"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          </div>
          <span>添加到播放队列</span>
        </div>

        <div class="song-menu-divider" :style="motionDelay(3)"></div>

        <div
          class="song-menu-item flex cursor-pointer items-center px-4 py-2.5 text-[#EC4141] transition-colors"
          :style="motionDelay(4)"
          @click="emit('delete')"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </div>
          <span>{{ selectedCount && selectedCount > 1 ? `删除选中的 ${selectedCount} 个歌单` : '删除歌单' }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.song-menu-pop-enter-active,
.song-menu-pop-leave-active {
  will-change: opacity, transform;
}

.song-menu-pop-enter-active {
  animation: song-menu-enter 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.song-menu-pop-leave-active {
  animation: song-menu-leave 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-menu-pop-enter-active .song-menu-item,
.song-menu-pop-enter-active .song-menu-divider,
.song-menu-pop-enter-active .song-menu-section {
  animation: song-menu-item-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--menu-item-delay, 0ms);
}

.song-menu-item {
  margin: 0 0.375rem;
  border-radius: 12px;
}

.song-menu-item:hover {
  background: rgba(15, 23, 42, 0.055);
}

.song-menu-divider {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

@keyframes song-menu-enter {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.965);
  }

  72% {
    opacity: 1;
    transform: translateY(-1px) scale(1.008);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes song-menu-leave {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  100% {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
}

@keyframes song-menu-item-in {
  0% {
    opacity: 0;
    transform: translateY(6px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
