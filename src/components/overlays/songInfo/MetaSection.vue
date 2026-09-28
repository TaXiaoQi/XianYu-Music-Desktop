<!-- 元数据分区：可编辑三元数据（音轨/碟号/年份）+ 静态技术字段 + 文件路径 + 时间戳 -->
<script setup lang="ts">
import type { Song } from '../../../types';
import type { TrackEditForm } from './editForm';
import { presentBitrate, presentDuration, presentSampleRate, presentSize, presentTimestamp } from './presentFormats';

const props = defineProps<{
  song: Song | null;
  draft: TrackEditForm;
  editing: boolean;
}>();

// 编辑态直接绑定草稿、查看态回退展示原值的三个格子
interface EditableCell {
  key: 'trackNo' | 'discNo' | 'releaseYear';
  label: string;
  pick: () => string | undefined;
}

const EDITABLE_CELLS: EditableCell[] = [
  { key: 'trackNo', label: '音轨号', pick: () => props.song?.track_number },
  { key: 'discNo', label: '碟号', pick: () => props.song?.disc_number },
  { key: 'releaseYear', label: '年份', pick: () => props.song?.year },
];

// 只读展示的九宫格后半段（格式格需要 uppercase 样式）
interface StaticCell {
  label: string;
  upper?: boolean;
  value: () => string;
}

const STATIC_CELLS: StaticCell[] = [
  { label: '音乐时长', value: () => presentDuration(props.song?.duration) },
  { label: '文件大小', value: () => presentSize(props.song?.file_size) },
  { label: '格式', upper: true, value: () => props.song?.format || props.song?.container || '无' },
  { label: '位深', value: () => (props.song?.bit_depth ? `${props.song.bit_depth} bit` : '无') },
  { label: '采样率', value: () => presentSampleRate(props.song?.sample_rate) },
  { label: '比特率', value: () => presentBitrate(props.song?.bitrate) },
];

const TIMESTAMP_CELLS = [
  { label: '添加时间', pick: () => props.song?.added_at },
  { label: '文件修改时间', pick: () => props.song?.file_modified_at },
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="song-info-detail-grid dark:bg-white/5 bg-gray-50/50 rounded-xl p-4 dark:border-gray-800 border border-gray-100 grid grid-cols-3 gap-y-6 gap-x-4">
      <div v-for="cell in EDITABLE_CELLS" :key="cell.key">
        <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">{{ cell.label }}</div>
        <input
          v-if="editing"
          v-model="draft[cell.key]"
          class="song-info-edit-input song-info-edit-input--compact"
          placeholder="无"
        />
        <div v-else class="text-sm dark:text-gray-200 text-gray-800">{{ cell.pick() || '无' }}</div>
      </div>
      <div v-for="cell in STATIC_CELLS" :key="cell.label">
        <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">{{ cell.label }}</div>
        <div class="text-sm dark:text-gray-200 text-gray-800" :class="cell.upper ? 'uppercase' : ''">{{ cell.value() }}</div>
      </div>
    </div>

    <div class="dark:bg-white/5 bg-gray-50/50 rounded-xl p-4 dark:border-gray-800 border border-gray-100">
      <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 no-text-select text-gray-400 dark:text-gray-500">文件路径</div>
      <div class="text-sm break-all leading-snug selectable-text dark:text-gray-200 text-gray-800">{{ song?.path }}</div>
    </div>

    <div class="song-info-time-grid dark:bg-white/5 bg-gray-50/50 rounded-xl p-4 dark:border-gray-800 border border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div v-for="cell in TIMESTAMP_CELLS" :key="cell.label">
        <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">{{ cell.label }}</div>
        <div class="text-sm dark:text-gray-200 text-gray-800">{{ presentTimestamp(cell.pick()) }}</div>
      </div>
    </div>
  </div>
</template>
