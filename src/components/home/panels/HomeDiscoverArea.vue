<script setup lang="ts">
import { computed } from 'vue';
import type { HomeDiscoverTab } from '../HomeDiscoverTabs.vue';
import HomeDiscoverTabs from '../HomeDiscoverTabs.vue';
import StatisticsPage from '../../statistics/StatisticsPage.vue';
import LeaderboardPage from '../../statistics/LeaderboardPage.vue';
import DailyRecommend from '../../../views/DailyRecommend.vue';
import TopLists from '../../../views/TopLists.vue';
import { useSettings } from '../../../features/settings/useSettings';

interface HomeDiscoverAreaProps {
  activePage: string;
}

const props = defineProps<HomeDiscoverAreaProps>();

const emit = defineEmits<{
  (e: 'switchPage', tab: HomeDiscoverTab): void;
}>();

const { theme } = useSettings();

// 经典扁平档没有独立的排行榜入口：排行榜已内联进统计页。若路由/状态仍停在
// 'leaderboard'（切档残留或旧深链），扁平档回落到统计页；玻璃档原样保留独立页。
const effectivePage = computed(() => (
  props.activePage === 'leaderboard' && !theme.value.useGlassSwitch ? 'statistics' : props.activePage
));

const forwardTabChange = (tab: HomeDiscoverTab) => {
  emit('switchPage', tab);
};
</script>

<template>
  <div data-test="discover-container" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <HomeDiscoverTabs :active-mode="effectivePage" @change="forwardTabChange" />

    <KeepAlive>
      <StatisticsPage v-if="effectivePage === 'statistics'" key="statistics" class="min-h-0 flex-1" />
      <LeaderboardPage v-else-if="effectivePage === 'leaderboard'" key="leaderboard" class="min-h-0 flex-1" />
      <DailyRecommend v-else-if="effectivePage === 'dailyRecommend'" key="dailyRecommend" class="min-h-0 flex-1" />
      <TopLists v-else-if="effectivePage === 'topLists'" key="topLists" class="min-h-0 flex-1" />
    </KeepAlive>
  </div>
</template>
