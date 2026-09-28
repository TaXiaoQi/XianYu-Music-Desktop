<script setup lang="ts">
import type { HomeDiscoverTab } from '../HomeDiscoverTabs.vue';
import HomeDiscoverTabs from '../HomeDiscoverTabs.vue';
import StatisticsPage from '../../statistics/StatisticsPage.vue';
import LeaderboardPage from '../../statistics/LeaderboardPage.vue';
import DailyRecommend from '../../../views/DailyRecommend.vue';
import TopLists from '../../../views/TopLists.vue';

interface HomeDiscoverAreaProps {
  activePage: string;
}

const props = defineProps<HomeDiscoverAreaProps>();

const emit = defineEmits<{
  (e: 'switchPage', tab: HomeDiscoverTab): void;
}>();

const forwardTabChange = (tab: HomeDiscoverTab) => {
  emit('switchPage', tab);
};
</script>

<template>
  <div data-test="discover-container" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <HomeDiscoverTabs :active-mode="props.activePage" @change="forwardTabChange" />

    <KeepAlive>
      <StatisticsPage v-if="props.activePage === 'statistics'" key="statistics" class="min-h-0 flex-1" />
      <LeaderboardPage v-else-if="props.activePage === 'leaderboard'" key="leaderboard" class="min-h-0 flex-1" />
      <DailyRecommend v-else-if="props.activePage === 'dailyRecommend'" key="dailyRecommend" class="min-h-0 flex-1" />
      <TopLists v-else-if="props.activePage === 'topLists'" key="topLists" class="min-h-0 flex-1" />
    </KeepAlive>
  </div>
</template>
