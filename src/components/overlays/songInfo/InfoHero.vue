<!-- 信息栏首屏：封面按钮 + 歌名/歌手/专辑（查看态标题区或编辑态输入区） -->
<script setup lang="ts">
import type { Song } from '../../../types';
import type { TrackEditForm } from './editForm';

defineProps<{
  song: Song | null;
  draft: TrackEditForm;
  editing: boolean;
  coverSrc: string;
  titleText: string;
}>();

const emit = defineEmits<{
  (e: 'choose-cover'): void;
}>();

// 头部三输入字段的配置化描述（domId 同时用于 label 关联）
interface HeadlineField {
  key: 'trackTitle' | 'artistName' | 'albumName';
  domId: string;
  label: string;
  placeholder: string;
  accentClass: string;
  gapClass: string;
}

const HEADLINE_FIELDS: HeadlineField[] = [
  { key: 'trackTitle', domId: 'song-info-title-input', label: '歌名', placeholder: '请输入歌名', accentClass: 'song-info-edit-input--title', gapClass: '' },
  { key: 'artistName', domId: 'song-info-artist-input', label: '歌手', placeholder: '请输入歌手名', accentClass: 'song-info-edit-input--artist', gapClass: 'mt-3' },
  { key: 'albumName', domId: 'song-info-album-input', label: '专辑', placeholder: '请输入专辑名', accentClass: '', gapClass: 'mt-2' },
];
</script>

<template>
  <div v-if="song" class="song-info-hero flex flex-col sm:flex-row mb-4 gap-6">
    <button
      type="button"
      class="song-info-cover w-32 h-32 shrink-0 rounded-xl overflow-hidden dark:bg-gray-800 bg-gray-100 shadow-md dark:border-gray-700/50 border border-gray-200/50 flex items-center justify-center"
      :class="editing ? 'song-info-cover--editable' : ''"
      :disabled="!editing"
      @click="emit('choose-cover')"
    >
      <img v-if="coverSrc" decoding="async" draggable="false" class="object-cover h-full w-full" :src="coverSrc" />
      <svg v-else class="w-12 h-12 dark:text-gray-600 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span v-if="editing" class="song-info-cover-overlay">更换封面</span>
    </button>

    <div class="flex-1 min-w-0 flex flex-col justify-center">
      <template v-if="editing">
        <div
          v-for="field in HEADLINE_FIELDS"
          :key="field.domId"
          class="song-info-edit-wrapper"
          :class="field.gapClass"
        >
          <label class="song-info-edit-label" :for="field.domId">{{ field.label }}</label>
          <input
            :id="field.domId"
            v-model="draft[field.key]"
            class="song-info-edit-input--with-label song-info-edit-input"
            :class="field.accentClass"
            :placeholder="field.placeholder"
          />
        </div>
      </template>
      <template v-else>
        <h3 class="song-info-name text-3xl font-bold dark:text-white truncate text-gray-900" :title="titleText">{{ titleText }}</h3>
        <p class="text-lg mt-3 truncate dark:text-gray-300 text-gray-600" :title="song.artist">{{ song.artist }}</p>
        <p class="text-base mt-2 truncate dark:text-gray-400 text-gray-500" :title="song.album">专辑：{{ song.album }}</p>
      </template>

      <div v-if="song.is_various_artists_album" class="flex gap-2 flex-wrap mt-4">
        <span class="px-2 py-0.5 text-xs font-semibold rounded dark:bg-blue-900/30 bg-blue-100/80 dark:text-blue-300 text-blue-700 dark:border-blue-800/50 border border-blue-200">
          群星合辑
        </span>
      </div>
    </div>
  </div>
</template>
