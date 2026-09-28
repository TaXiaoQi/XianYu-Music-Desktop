<script setup lang="ts">
import { computed, ref } from 'vue';
import { type ArtistTabId, getOrderedArtistTabs, saveTabsOrder } from '../../../utils/artistTabsOrder';

const props = defineProps<{
  activeTab: ArtistTabId;
  readOnly?: boolean;
  hasDetail?: boolean;
  nameOverrides?: Partial<Record<ArtistTabId, string>>;
}>();

const emit = defineEmits(['activate']);

const order = ref(getOrderedArtistTabs());
const dragId = ref<ArtistTabId | null>(null);
const clickGuard = ref(false);
const dragActive = ref(false);
const dropIndex = ref<number | null>(null);
let holdTimer: number | null = null;
let pressX = 0;
let pressY = 0;

const shownTabs = computed(() => {
  if (!props.readOnly) return order.value;
  return props.hasDetail ? order.value : order.value.filter(tab => tab.id !== 'details');
});

const activate = (id: ArtistTabId) => {
  if (clickGuard.value) return;
  emit('activate', id);
};

const beginPress = (tabId: ArtistTabId, event: PointerEvent) => {
  if (event.button !== 0) return;
  if (props.readOnly) return;

  dragId.value = tabId;
  pressX = event.clientX;
  pressY = event.clientY;
  dragActive.value = false;
  dropIndex.value = null;

  event.preventDefault();

  holdTimer = window.setTimeout(() => {
    dragActive.value = true;
    clickGuard.value = true;
    document.body.style.cursor = 'grabbing';
  }, 300);

  window.addEventListener('pointermove', trackPointer);
  window.addEventListener('pointerup', endPress);
};

const trackPointer = (event: PointerEvent) => {
  if (dragId.value === null) return;

  const driftX = Math.abs(event.clientX - pressX);
  const driftY = Math.abs(event.clientY - pressY);

  if (!dragActive.value && (driftX > 6 || driftY > 6)) {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    endPress();
    return;
  }

  if (!dragActive.value) return;

  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  let hoverTab: ArtistTabId | null = null;
  let hoverEl: HTMLElement | null = null;

  for (const node of stack) {
    const marker = node.getAttribute('data-artist-tab-id');
    if (marker && (marker === 'songs' || marker === 'albums' || marker === 'details')) {
      hoverTab = marker as ArtistTabId;
      hoverEl = node as HTMLElement;
      break;
    }
  }

  if (hoverTab !== null && hoverEl !== null) {
    const rect = hoverEl.getBoundingClientRect();
    const at = order.value.findIndex(tab => tab.id === hoverTab);

    if (at !== -1) {
      dropIndex.value = event.clientX < rect.left + rect.width / 2 ? at : at + 1;
    }
  } else {
    dropIndex.value = null;
  }
};

const endPress = () => {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  window.removeEventListener('pointermove', trackPointer);
  window.removeEventListener('pointerup', endPress);

  document.body.style.cursor = '';

  if (dragId.value === null) return;

  if (dragActive.value && dropIndex.value !== null) {
    const from = order.value.findIndex(tab => tab.id === dragId.value);
    let to = dropIndex.value;

    if (from !== -1 && from !== to) {
      const [moved] = order.value.splice(from, 1);

      if (to > from) {
        to--;
      }

      order.value.splice(to, 0, moved);
      saveTabsOrder(order.value.map(tab => tab.id));
    }
  }

  dragId.value = null;
  dragActive.value = false;
  dropIndex.value = null;

  setTimeout(() => {
    clickGuard.value = false;
  }, 50);
};
</script>

<template>
  <TransitionGroup
    name="tabs-list"
    tag="div"
    class="flex gap-8 text-[15px] font-medium mt-auto w-full select-none touch-none"
  >
    <div
      v-for="(tab, index) in shownTabs"
      :key="tab.id"
      class="relative flex items-center shrink-0"
    >
      <div
        v-if="dragActive && dropIndex === index"
        class="absolute left-[-16px] w-[3px] h-5 bg-[#EC4141] rounded-full animate-pulse transition-all z-20 pointer-events-none"
      ></div>

      <button
        :data-artist-tab-id="tab.id"
        class="pb-1.5 transition-all relative cursor-pointer select-none touch-none no-user-drag"
        :class="[
          activeTab === tab.id
            ? 'text-gray-900 dark:text-white font-bold'
            : 'text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90',
          dragId === tab.id ? 'opacity-60 scale-95 cursor-grabbing' : ''
        ]"
        @pointerdown="beginPress(tab.id, $event)"
        @click="activate(tab.id)"
      >
        <span class="pointer-events-none">{{ nameOverrides?.[tab.id] || tab.name }}</span>
        <div
          v-if="activeTab === tab.id"
          class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-[3px] bg-[#EC4141] rounded-t-full pointer-events-none"
        ></div>
      </button>

      <div
        v-if="dragActive && dropIndex === shownTabs.length && index === shownTabs.length - 1"
        class="absolute right-[-16px] w-[3px] h-5 bg-[#EC4141] rounded-full animate-pulse transition-all z-20 pointer-events-none"
      ></div>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.tabs-list-move {
  transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.no-user-drag {
  -webkit-user-drag: none;
  user-drag: none;
}
</style>
