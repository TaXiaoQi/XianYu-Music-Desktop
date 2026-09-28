<script setup lang="ts">
import { Heart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-vue-next';
import { computed, type Component } from 'vue';

const props = defineProps<{
  playing: boolean;
  favorite: boolean;
  loopMode: number;
}>();

const emit = defineEmits<{
  favorite: [];
  previous: [];
  toggle: [];
  advance: [];
  cycleLoop: [];
}>();

const LOOP_MODES = new Map<number, { caption: string; glyph: Component }>([
  [1, { caption: '单曲循环', glyph: Repeat1 }],
  [2, { caption: '随机播放', glyph: Shuffle }],
  [0, { caption: '列表循环', glyph: Repeat }],
]);

const activeLoop = computed(() => LOOP_MODES.get(props.loopMode) ?? LOOP_MODES.get(0)!);
</script>

<template>
  <section class="deck" aria-label="播放控制">
    <button
      class="deck__knob"
      :class="{ 'deck__knob--marked': favorite }"
      title="收藏"
      @click="emit('favorite')"
    >
      <Heart :size="16" :stroke-width="2.2" :fill="favorite ? 'currentColor' : 'none'" />
    </button>
    <div class="deck__core">
      <button class="deck__knob" title="上一首" @click="emit('previous')">
        <SkipBack :size="18" :stroke-width="2.35" />
      </button>
      <button class="deck__knob deck__knob--lead" title="播放/暂停" @click="emit('toggle')">
        <Pause v-if="playing" :size="20" :stroke-width="2.5" />
        <Play v-else :size="20" :stroke-width="2.5" />
      </button>
      <button class="deck__knob" title="下一首" @click="emit('advance')">
        <SkipForward :size="18" :stroke-width="2.35" />
      </button>
    </div>
    <button
      class="deck__knob"
      :class="{ 'deck__knob--engaged': loopMode !== 0 }"
      :title="activeLoop.caption"
      @click="emit('cycleLoop')"
    >
      <component :is="activeLoop.glyph" :size="16" :stroke-width="2.2" />
    </button>
  </section>
</template>

<style scoped>
.deck {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 10px;
  flex-shrink: 0;
}

.deck__core {
  display: flex;
  align-items: center;
  gap: 6px;
}

.deck__knob {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  border: 0;
  background: transparent;
  color: var(--trayInkSoft);
  cursor: default;
  transition: color 200ms ease, background-color 200ms ease, transform 200ms ease;
}

.deck__knob--lead {
  color: var(--trayInk);
}

.deck__knob--engaged {
  color: #EC4141;
  background: rgba(236, 65, 65, 0.1);
}

.deck__knob--marked {
  color: var(--favorite-color);
  background: color-mix(in srgb, var(--favorite-color) 10%, transparent);
}

.deck__knob:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--trayInk);
  transform: scale(1.1);
}

.deck__knob--engaged:hover {
  color: #EC4141;
  background: rgba(236, 65, 65, 0.16);
}

.deck__knob--marked:hover {
  color: var(--favorite-color);
  background: color-mix(in srgb, var(--favorite-color) 16%, transparent);
}
</style>
