<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useDragScrollX } from '../../composables/useDragScrollX';
import type { SearchTypeKey } from '../../composables/search/useSearchQuery';
import type { SourceItem } from '../../composables/search/useSearchSources';

const props = defineProps<{
  tabs: { type: SearchTypeKey; label: string }[];
  activeSearchType: SearchTypeKey;
  sources: SourceItem[];
  selectedSourceId: string;
  searchQuery: string;
  resultCount: number;
}>();

const emit = defineEmits<{
  (e: 'type-change', type: SearchTypeKey): void;
  (e: 'select-source', source: SourceItem): void;
}>();

// ==================== 来源横向滚动 ====================
const sourceScrollRef = ref<HTMLElement | null>(null);
const { isDragging } = useDragScrollX(sourceScrollRef);

function scrollSelectedSourceIntoView() {
  const container = sourceScrollRef.value;
  if (!container) return;
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

const handleSearchTypeChange = (type: SearchTypeKey) => {
  emit('type-change', type);
};

const handleSelectSource = (source: SourceItem) => {
  emit('select-source', source);
};

watch(() => props.selectedSourceId, () => {
  nextTick(() => scrollSelectedSourceIntoView());
});

const sourceResizeObserver = new ResizeObserver(() => {
  const container = sourceScrollRef.value;
  if (!container) return;
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  if (!active) return;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;
  if (left < viewLeft || right > viewRight) {
    scrollSelectedSourceIntoView();
  }
});
watch(sourceScrollRef, (el) => {
  sourceResizeObserver.disconnect();
  if (el) sourceResizeObserver.observe(el);
});

onBeforeUnmount(() => {
  sourceResizeObserver.disconnect();
});
</script>

<template>
  <div class="px-6 shrink-0 select-none">
    <div class="flex items-center gap-1 border-b border-black/5 dark:border-white/5">
      <button
        v-for="tab in tabs"
        :key="tab.type"
        type="button"
        class="relative px-5 py-3 text-[clamp(0.875rem,1.1vw,1rem)] font-medium tracking-wide transition-colors cursor-pointer"
        :class="activeSearchType === tab.type
          ? 'text-[#EC4141]'
          : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
        @click="handleSearchTypeChange(tab.type)"
      >
        {{ tab.label }}
        <span
          class="absolute left-1/2 -translate-x-1/2 -bottom-px h-[2px] w-8 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
          :class="activeSearchType === tab.type ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
        ></span>
      </button>
    </div>

    <div class="flex items-center justify-between gap-4 py-3">
      <div class="flex items-center min-w-0 flex-1">
        <span class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 mr-1 shrink-0">来源</span>
        <div
          ref="sourceScrollRef"
          class="flex items-center gap-1 overflow-x-auto no-h-scrollbar min-w-0 pr-3 cursor-grab select-none"
          :class="{ 'cursor-grabbing': isDragging, 'scroll-smooth': !isDragging }"
        >
          <button
            v-for="source in sources"
            :key="source.id"
            type="button"
            :data-active="selectedSourceId === source.id ? 'true' : 'false'"
            class="px-3 py-1.5 rounded-md text-[clamp(0.8rem,1vw,0.9rem)] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            :class="selectedSourceId === source.id
              ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10'
              : 'text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5'"
            @click="handleSelectSource(source)"
          >
            {{ source.name }}
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2 min-w-0 shrink-0">
        <span v-if="searchQuery.trim()" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 truncate max-w-[16rem]">
          "{{ searchQuery }}" · {{ resultCount }} 个结果
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.no-h-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.no-h-scrollbar::-webkit-scrollbar {
  display: none;
  height: 0;
}
</style>
