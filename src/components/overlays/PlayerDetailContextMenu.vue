<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch, computed, type CSSProperties } from 'vue';

type PlayerDetailMenuAction = 'changeCover' | 'changeLyrics';

interface MenuEntry {
  key: PlayerDetailMenuAction;
  label: string;
  icon: { viewBox: string; fill: boolean; paths: { d: string }[] };
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'action', action: PlayerDetailMenuAction): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

const menuEntries: MenuEntry[] = [
  {
    key: 'changeCover',
    label: '为此歌曲修改封面',
    icon: {
      viewBox: '0 0 24 24',
      fill: false,
      paths: [
        { d: 'M4 5h16v14H4z' },
        { d: 'M4 16l4.5-4.5 3 3L16 10l4 4' },
        { d: 'M9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z' },
      ],
    },
  },
  {
    key: 'changeLyrics',
    label: '为此歌曲修改字幕',
    icon: {
      viewBox: '0 0 24 24',
      fill: false,
      paths: [
        { d: 'M5 4h14v16H5z' },
        { d: 'M8 8h8' },
        { d: 'M8 12h8' },
        { d: 'M8 16h5' },
      ],
    },
  },
];

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
);

const menuStyle = computed<CSSProperties>(() => {
  if (!props.visible) return {};

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
    visibility: menuSize.value.height === 0 ? 'hidden' : 'visible',
    transformOrigin: `${horizontalOrigin} ${verticalOrigin}`,
  };
});

const handleGlobalClick = (event: MouseEvent) => {
  const target = event.target as Node;
  if (props.visible && !menuRef.value?.contains(target)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

const handleAction = (action: PlayerDetailMenuAction) => {
  emit('action', action);
  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <Transition name="player-detail-menu-pop" appear>
      <div
        v-if="visible"
        ref="menuRef"
        class="fixed z-[9999] min-w-[220px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="menuStyle"
        @contextmenu.prevent
      >
        <div
          v-for="(entry, index) in menuEntries"
          :key="entry.key"
          class="player-detail-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors"
          :style="{ '--menu-item-delay': `${index * 14}ms` }"
          @click="handleAction(entry.key)"
        >
          <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              :viewBox="entry.icon.viewBox"
              :fill="entry.icon.fill ? 'currentColor' : 'none'"
              :stroke="entry.icon.fill ? 'none' : 'currentColor'"
              :stroke-width="entry.icon.fill ? undefined : '1.7'"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path v-for="(p, i) in entry.icon.paths" :key="i" :d="p.d" />
            </svg>
          </div>
          <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-detail-menu-item {
  margin: 0 0.375rem;
  border-radius: 12px;
}

.player-detail-menu-item:hover {
  background: rgba(15, 23, 42, 0.055);
}

.player-detail-menu-pop-enter-active {
  will-change: opacity, transform;
  animation: player-detail-menu-enter 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.player-detail-menu-pop-leave-active {
  will-change: opacity, transform;
  animation: player-detail-menu-leave 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.player-detail-menu-pop-enter-active .player-detail-menu-item {
  animation: player-detail-menu-item-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--menu-item-delay, 0ms);
}

@keyframes player-detail-menu-enter {
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

@keyframes player-detail-menu-leave {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
}

@keyframes player-detail-menu-item-in {
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
