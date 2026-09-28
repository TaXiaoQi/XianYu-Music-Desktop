<script setup lang="ts">
interface StageMarker {
  key: string;
  caption: string;
}

const props = defineProps<{
  stages: StageMarker[];
  activeIndex: number;
}>();

const hasPassed = (position: number) => position < props.activeIndex;
const isCurrent = (position: number) => position === props.activeIndex;

const badgeTone = (position: number) => {
  if (hasPassed(position)) {
    return 'border-[#EC4141] bg-[#EC4141] text-white shadow-[0_10px_24px_-16px_rgba(236,65,65,0.9)]';
  }
  if (isCurrent(position)) {
    return 'border-[#EC4141]/30 bg-[#EC4141]/10 text-[#EC4141]';
  }
  return 'border-white/10 bg-white/5 text-gray-500';
};

const captionTone = (position: number) =>
  position <= props.activeIndex
    ? 'text-gray-800 dark:text-white'
    : 'text-gray-500 dark:text-white/50';

const connectorTone = (position: number) =>
  position < props.activeIndex ? 'bg-[#EC4141]' : 'bg-white/10';
</script>

<template>
  <section class="w-full px-5 py-5">
    <div class="grid items-start gap-y-3 [grid-template-columns:repeat(4,minmax(0,1fr)_88px)_minmax(0,1fr)]">
      <template v-for="(marker, position) in stages" :key="marker.key">
        <div class="flex flex-col items-center gap-3">
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-sm font-semibold transition"
            :class="badgeTone(position)"
          >
            <span v-if="hasPassed(position)">✓</span>
            <span v-else>{{ position + 1 }}</span>
          </div>

          <div
            class="text-center text-xs font-medium transition"
            :class="captionTone(position)"
          >
            {{ marker.caption }}
          </div>
        </div>

        <div
          v-if="position < stages.length - 1"
          class="mt-5 h-1 rounded-full transition"
          :class="connectorTone(position)"
        ></div>
      </template>
    </div>
  </section>
</template>
