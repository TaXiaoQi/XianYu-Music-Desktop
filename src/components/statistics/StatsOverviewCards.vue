<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { Music, Disc, Mic2, Clock, Database, Zap } from 'lucide-vue-next';

const TEXT = {
  totalSongs: '\u603b\u6b4c\u66f2',
  albums: '\u4e13\u8f91',
  artists: '\u6b4c\u624b',
  totalDuration: '\u603b\u65f6\u957f',
  librarySize: '\u5e93\u5927\u5c0f',
  losslessRate: '\u65e0\u635f\u5360\u6bd4',
  monthlyAddedPrefix: '\u672c\u6708 +',
  hiddenCardTitle: '\u9690\u85cf\u6b64\u5361\u7247',
};

const showMonthlyBadge = ref(true);
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  badgeTimer = setTimeout(() => {
    showMonthlyBadge.value = false;
  }, 3000);
});

onUnmounted(() => {
  if (badgeTimer) {
    clearTimeout(badgeTimer);
  }
});

const props = defineProps<{
  totalSongs: number;
  albumCount: number;
  artistCount: number;
  totalDuration: number;
  totalFileSize: number;
  losslessCount: number;
  thisMonthAdded: number;
  hiddenCards: Set<string>;
  expandedCard: string | null;
}>();

const emit = defineEmits<{
  hide: [title: string];
  'card-click': [title: string];
}>();

const isClickable = (title: string) => title === TEXT.losslessRate || title === TEXT.librarySize;

const formattedDuration = computed(() => {
  const seconds = props.totalDuration;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}D ${hours}H`;
  }

  if (hours > 0) {
    return `${hours}H ${minutes}M`;
  }

  if (minutes > 0) {
    return `${minutes}M ${remainingSeconds}S`;
  }

  return `${remainingSeconds}S`;
});

const formattedSize = computed(() => {
  const bytes = props.totalFileSize;
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
});

const losslessRate = computed(() => {
  if (props.totalSongs === 0) {
    return '0%';
  }

  return `${((props.losslessCount / props.totalSongs) * 100).toFixed(1)}%`;
});

const allCards = computed(() => [
  {
    title: TEXT.totalSongs,
    value: props.totalSongs.toLocaleString(),
    subtitle: props.thisMonthAdded > 0 ? `${TEXT.monthlyAddedPrefix}${props.thisMonthAdded}` : null,
    icon: Music,
    colorClass: 'text-blue-500 dark:text-blue-400',
    bgClass: 'bg-blue-500/10 dark:bg-blue-400/10',
    borderClass: 'group-hover:border-blue-500/30',
  },
  {
    title: TEXT.albums,
    value: props.albumCount.toLocaleString(),
    icon: Disc,
    colorClass: 'text-indigo-500 dark:text-indigo-400',
    bgClass: 'bg-indigo-500/10 dark:bg-indigo-400/10',
    borderClass: 'group-hover:border-indigo-500/30',
  },
  {
    title: TEXT.artists,
    value: props.artistCount.toLocaleString(),
    icon: Mic2,
    colorClass: 'text-violet-500 dark:text-violet-400',
    bgClass: 'bg-violet-500/10 dark:bg-violet-400/10',
    borderClass: 'group-hover:border-violet-500/30',
  },
  {
    title: TEXT.totalDuration,
    value: formattedDuration.value,
    icon: Clock,
    colorClass: 'text-purple-500 dark:text-purple-400',
    bgClass: 'bg-purple-500/10 dark:bg-purple-400/10',
    borderClass: 'group-hover:border-purple-500/30',
  },
  {
    title: TEXT.librarySize,
    value: formattedSize.value,
    icon: Database,
    colorClass: 'text-fuchsia-500 dark:text-fuchsia-400',
    bgClass: 'bg-fuchsia-500/10 dark:bg-fuchsia-400/10',
    borderClass: 'group-hover:border-fuchsia-500/30',
  },
  {
    title: TEXT.losslessRate,
    value: losslessRate.value,
    icon: Zap,
    colorClass: 'text-pink-500 dark:text-pink-400',
    bgClass: 'bg-pink-500/10 dark:bg-pink-400/10',
    borderClass: 'group-hover:border-pink-500/30',
  },
]);
</script>

<template>
  <section>
    <div v-if="allCards.some(card => !hiddenCards.has(card.title))" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
      <template v-for="(card, index) in allCards" :key="card.title">
        <div
          v-if="!hiddenCards.has(card.title)"
          class="stat-card relative overflow-hidden rounded-xl p-4 backdrop-blur-md bg-white/40 dark:bg-white/5 border border-white/20 dark:border-white/5 transition-all duration-300 hover:scale-[1.02] group animate-slide-up-fade"
          :class="[
            'hover:bg-white/60 dark:hover:bg-white/10',
            card.borderClass,
            isClickable(card.title) ? 'cursor-pointer' : '',
            expandedCard === card.title && card.title === TEXT.losslessRate ? 'ring-2 ring-pink-500/50 bg-white/60 dark:bg-white/10' : '',
            expandedCard === card.title && card.title === TEXT.librarySize ? 'ring-2 ring-fuchsia-500/50 bg-white/60 dark:bg-white/10' : ''
          ]"
          :style="{ animationDelay: `${index * 100}ms` }"
          @click="isClickable(card.title) && emit('card-click', card.title)"
        >
          <div
            v-if="isClickable(card.title)"
            class="absolute right-3 bottom-3 opacity-30 group-hover:opacity-100 transition-opacity duration-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 transition-transform duration-300"
              :class="[
                expandedCard === card.title ? 'rotate-180' : '',
                card.title === TEXT.losslessRate ? 'text-pink-500' : 'text-fuchsia-500'
              ]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          <div class="close-zone absolute top-0 right-0 w-10 h-10 z-20">
            <button
              @click.stop="emit('hide', card.title)"
              class="absolute top-2 right-2 p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white opacity-0 close-btn transition-opacity duration-200"
              :title="TEXT.hiddenCardTitle"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="relative z-10 flex flex-col h-full justify-between">
            <div class="flex items-start justify-between mb-2">
              <div :class="['p-2 rounded-lg transition-colors duration-300', card.bgClass, card.colorClass]">
                <component :is="card.icon" :stroke-width="1.5" class="w-5 h-5" />
              </div>
            </div>

            <div>
              <p class="text-xs font-medium text-gray-700 dark:text-white/80 mb-0.5 line-clamp-1">{{ card.title }}</p>
              <div class="flex items-baseline gap-2 flex-nowrap">
                <p class="text-xl font-bold text-gray-900 dark:text-white tracking-tight">{{ card.value }}</p>
                <Transition name="fade">
                  <p v-if="card.subtitle && showMonthlyBadge" class="text-[10px] text-emerald-500 dark:text-emerald-400 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    {{ card.subtitle }}
                  </p>
                </Transition>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.stat-card {
  height: 120px;
}

.close-zone:hover .close-btn {
  opacity: 1;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
