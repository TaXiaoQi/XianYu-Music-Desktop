<script setup lang="ts">
import { computed } from 'vue';

import { useI18n } from '../../features/i18n';

export type HomeDiscoverTab = 'statistics' | 'dailyRecommend' | 'topLists';

interface Props {
  activeMode: string;
}

defineProps<Props>();

const emit = defineEmits<{
  (event: 'change', tab: HomeDiscoverTab): void;
}>();

const { isEnglish } = useI18n();

const tabs = computed<{ key: HomeDiscoverTab; label: string }[]>(() => [
  { key: 'statistics', label: isEnglish.value ? 'Statistics' : '统计' },
  { key: 'dailyRecommend', label: isEnglish.value ? 'Daily Mix' : '每日推荐' },
  { key: 'topLists', label: isEnglish.value ? 'Charts' : '音源榜单' },
]);
</script>

<template>
  <div class="flex items-center gap-1 px-6 border-b border-black/5 dark:border-white/5 shrink-0 select-none">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="relative px-5 py-3 text-[clamp(0.875rem,1.1vw,1rem)] font-medium tracking-wide transition-colors cursor-pointer"
      :class="activeMode === tab.key
        ? 'text-[#EC4141]'
        : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
      @click="emit('change', tab.key)"
    >
      {{ tab.label }}
      <span
        class="absolute left-1/2 -translate-x-1/2 -bottom-px h-[2px] w-8 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
        :class="activeMode === tab.key ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
      ></span>
    </button>
  </div>
</template>
