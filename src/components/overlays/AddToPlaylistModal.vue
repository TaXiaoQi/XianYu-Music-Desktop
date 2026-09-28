<script setup lang="ts">
// 「收藏到歌单」弹窗对外入口：声明冻结的 props/emits 契约，
// 具体渲染与交互全部下沉到 addToPlaylist/ 子目录内的实现组件。
import AddToPlaylistDialogBody from './addToPlaylist/AddToPlaylistDialogBody.vue';

defineProps<{
  visible: boolean;
  selectedCount: number;
  excludedPlaylistId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add', playlistId: string): void;
}>();

const forwardAdd = (playlistId: string) => emit('add', playlistId);
</script>

<template>
  <AddToPlaylistDialogBody
    :visible="visible"
    :excluded-playlist-id="excludedPlaylistId"
    @close="emit('close')"
    @add="forwardAdd"
  />
</template>
