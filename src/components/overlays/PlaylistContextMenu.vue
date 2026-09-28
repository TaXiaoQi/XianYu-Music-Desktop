<script setup lang="ts">
// 歌单右键菜单：批量选中多歌单时标题切换为统计文案并隐藏播放项，删除文案随之变化。
// 外壳定位与动效由 MenuSurface 承担，行渲染复用 CtxRow。
import { computed, ref } from 'vue';

import CtxRow from './contextMenu/CtxRow.vue';
import GlyphIcon from './contextMenu/GlyphIcon.vue';
import MenuSurface from './contextMenu/MenuSurface.vue';
import { glyphPlusCross, glyphRoundPlay, glyphTrashLid } from './contextMenu/actionGlyphs';
import { GLASS_SHEET } from './contextMenu/sheetChrome';
import { rowLag } from './contextMenu/motion';
import { watchPointerAway } from './contextMenu/onPointerAway';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  playlistName: string;
  selectedCount?: number;
}>();

const emit = defineEmits([
  'close',
  'play',
  'addToQueue',
  'delete',
  'cancel',
]);

const sheet = ref<InstanceType<typeof MenuSurface> | null>(null);

// 点在面板外：同时上报取消与关闭
watchPointerAway(
  (hit) => {
    const el = sheet.value?.shell;
    return !!el && !el.contains(hit as Node);
  },
  () => {
    emit('cancel');
    emit('close');
  },
);

const batchPicking = computed(() => !!props.selectedCount && props.selectedCount > 1);
const heading = computed(() =>
  batchPicking.value ? `已选中 ${props.selectedCount} 个歌单` : props.playlistName);
const wipeCaption = computed(() =>
  batchPicking.value ? `删除选中的 ${props.selectedCount} 个歌单` : '删除歌单');
</script>

<template>
  <Teleport to="body">
    <MenuSurface
      :shown="visible"
      :at-x="x"
      :at-y="y"
      pop-name="ctx-pop"
      :chrome-class="GLASS_SHEET"
    >
      <div class="ctx-note px-4 py-2 text-xs text-gray-400" :style="rowLag(0)">
        {{ heading }}
      </div>

      <CtxRow v-if="!batchPicking" :step="1" caption="播放" lead-class="text-gray-500 group-hover:text-gray-800" @pick="emit('play')">
        <template #lead>
          <GlyphIcon :shape="glyphRoundPlay" />
        </template>
      </CtxRow>

      <CtxRow :step="2" caption="添加到播放队列" lead-class="text-gray-500 group-hover:text-gray-800" @pick="emit('addToQueue')">
        <template #lead>
          <GlyphIcon :shape="glyphPlusCross" />
        </template>
      </CtxRow>

      <div class="ctx-sep" :style="rowLag(3)"></div>

      <CtxRow :step="4" alert :caption="wipeCaption" lead-class="text-[#EC4141]" @pick="emit('delete')">
        <template #lead>
          <GlyphIcon :shape="glyphTrashLid" />
        </template>
      </CtxRow>
    </MenuSurface>
  </Teleport>
</template>
