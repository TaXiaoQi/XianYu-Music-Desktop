<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, ChevronDown, FolderOpen, Music, FileText, RotateCcw } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import type { DownloadFormat, DownloadQuality } from '../../types';

const { settings } = useSettings();
const { showToast } = useToast();

// 下拉菜单状态
const isFormatMenuOpen = ref(false);
const isQualityMenuOpen = ref(false);
const isLyricsFormatMenuOpen = ref(false);
const formatSelectRef = ref<HTMLElement | null>(null);
const qualitySelectRef = ref<HTMLElement | null>(null);
const lyricsFormatSelectRef = ref<HTMLElement | null>(null);

// 选项定义
const formatOptions: { value: DownloadFormat; label: string; desc: string }[] = [
  { value: 'mp3', label: 'MP3', desc: '通用兼容性最佳' },
  { value: 'flac', label: 'FLAC', desc: '无损压缩，音质最佳' },
  { value: 'wav', label: 'WAV', desc: '无损未压缩' },
  { value: 'aac', label: 'AAC', desc: '高压缩比，音质良好' },
];

const qualityOptions: { value: DownloadQuality; label: string; desc: string }[] = [
  { value: 'lossless', label: '无损', desc: '最高音质，文件较大' },
  { value: 'high', label: '高品', desc: '320kbps，平衡音质与体积' },
  { value: 'standard', label: '标准', desc: '128kbps，文件较小' },
];

const lyricsFormatOptions: { value: 'lrc' | 'txt'; label: string; desc: string }[] = [
  { value: 'lrc', label: 'LRC', desc: '带时间轴，可同步显示' },
  { value: 'txt', label: 'TXT', desc: '纯文本歌词' },
];

// 当前选中项的标签
const selectedFormatLabel = computed(() =>
  formatOptions.find(o => o.value === settings.value.download.format)?.label ?? 'MP3',
);
const selectedQualityLabel = computed(() =>
  qualityOptions.find(o => o.value === settings.value.download.quality)?.label ?? '高品',
);
const selectedLyricsFormatLabel = computed(() =>
  lyricsFormatOptions.find(o => o.value === settings.value.download.lyricsFormat)?.label ?? 'LRC',
);

// 下载路径展示（空时显示占位）
const downloadPathLabel = computed(() => settings.value.download.downloadPath || '未设置，将使用音乐库根目录');

// 选择下载目录
async function handleSelectDownloadPath() {
  const selected = await open({ directory: true, multiple: false, title: '选择下载目录' });
  if (selected && typeof selected === 'string') {
    settings.value.download.downloadPath = selected;
    showToast('下载位置已更新', 'success');
  }
}

// 切换下拉菜单
function toggleFormatMenu() {
  isQualityMenuOpen.value = false;
  isLyricsFormatMenuOpen.value = false;
  isFormatMenuOpen.value = !isFormatMenuOpen.value;
}

function toggleQualityMenu() {
  isFormatMenuOpen.value = false;
  isLyricsFormatMenuOpen.value = false;
  isQualityMenuOpen.value = !isQualityMenuOpen.value;
}

function toggleLyricsFormatMenu() {
  isFormatMenuOpen.value = false;
  isQualityMenuOpen.value = false;
  isLyricsFormatMenuOpen.value = !isLyricsFormatMenuOpen.value;
}

// 选择具体选项
function handleSelectFormat(value: DownloadFormat) {
  settings.value.download.format = value;
  isFormatMenuOpen.value = false;
}

function handleSelectQuality(value: DownloadQuality) {
  settings.value.download.quality = value;
  isQualityMenuOpen.value = false;
}

function handleSelectLyricsFormat(value: 'lrc' | 'txt') {
  settings.value.download.lyricsFormat = value;
  isLyricsFormatMenuOpen.value = false;
}

// 点击外部关闭下拉
function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (isFormatMenuOpen.value && formatSelectRef.value && !formatSelectRef.value.contains(target)) {
    isFormatMenuOpen.value = false;
  }
  if (isQualityMenuOpen.value && qualitySelectRef.value && !qualitySelectRef.value.contains(target)) {
    isQualityMenuOpen.value = false;
  }
  if (isLyricsFormatMenuOpen.value && lyricsFormatSelectRef.value && !lyricsFormatSelectRef.value.contains(target)) {
    isLyricsFormatMenuOpen.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    isFormatMenuOpen.value = false;
    isQualityMenuOpen.value = false;
    isLyricsFormatMenuOpen.value = false;
  }
}

window.addEventListener('pointerdown', handleDocumentPointerDown);
window.addEventListener('keydown', handleDocumentKeydown);

onScopeDispose(() => {
  window.removeEventListener('pointerdown', handleDocumentPointerDown);
  window.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">

    <!-- 下载位置 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        下载位置
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载目录</div>
            <div class="text-xs text-gray-500 dark:text-white/55 mt-1 truncate" :title="downloadPathLabel">
              {{ downloadPathLabel }}
            </div>
          </div>
          <button
            type="button"
            class="settings-download-action"
            @click="handleSelectDownloadPath"
          >
            <FolderOpen class="h-4 w-4" />
            选择目录
          </button>
        </div>
      </div>
    </section>

    <!-- 下载格式与音质 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        格式与音质
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <!-- 下载格式 -->
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <Music class="h-4 w-4 text-gray-400 dark:text-white/45" />
              下载格式
            </div>
            <div class="text-xs text-gray-500 dark:text-white/55 mt-1">
              {{ formatOptions.find(o => o.value === settings.download.format)?.desc }}
            </div>
          </div>
          <div ref="formatSelectRef" class="settings-download-select">
            <button
              type="button"
              class="settings-download-select__trigger"
              :class="{ 'settings-download-select__trigger--open': isFormatMenuOpen }"
              aria-haspopup="listbox"
              :aria-expanded="isFormatMenuOpen"
              @click="toggleFormatMenu"
            >
              <span class="settings-download-select__label">{{ selectedFormatLabel }}</span>
              <ChevronDown
                class="settings-download-select__icon"
                :class="{ 'settings-download-select__icon--open': isFormatMenuOpen }"
                aria-hidden="true"
              />
            </button>
            <transition name="settings-download-menu">
              <div
                v-if="isFormatMenuOpen"
                class="settings-download-select__menu"
                role="listbox"
                aria-label="下载格式"
              >
                <button
                  v-for="option in formatOptions"
                  :key="option.value"
                  type="button"
                  class="settings-download-select__option"
                  :class="{ 'settings-download-select__option--selected': settings.download.format === option.value }"
                  role="option"
                  :aria-selected="settings.download.format === option.value"
                  @click="handleSelectFormat(option.value)"
                >
                  <div class="settings-download-select__option-info">
                    <div class="settings-download-select__option-text">{{ option.label }}</div>
                    <div class="settings-download-select__option-desc">{{ option.desc }}</div>
                  </div>
                  <Check
                    v-if="settings.download.format === option.value"
                    class="settings-download-select__check"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </transition>
          </div>
        </div>

        <!-- 下载音质 -->
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <Music class="h-4 w-4 text-gray-400 dark:text-white/45" />
              下载音质
            </div>
            <div class="text-xs text-gray-500 dark:text-white/55 mt-1">
              {{ qualityOptions.find(o => o.value === settings.download.quality)?.desc }}
            </div>
          </div>
          <div ref="qualitySelectRef" class="settings-download-select">
            <button
              type="button"
              class="settings-download-select__trigger"
              :class="{ 'settings-download-select__trigger--open': isQualityMenuOpen }"
              aria-haspopup="listbox"
              :aria-expanded="isQualityMenuOpen"
              @click="toggleQualityMenu"
            >
              <span class="settings-download-select__label">{{ selectedQualityLabel }}</span>
              <ChevronDown
                class="settings-download-select__icon"
                :class="{ 'settings-download-select__icon--open': isQualityMenuOpen }"
                aria-hidden="true"
              />
            </button>
            <transition name="settings-download-menu">
              <div
                v-if="isQualityMenuOpen"
                class="settings-download-select__menu"
                role="listbox"
                aria-label="下载音质"
              >
                <button
                  v-for="option in qualityOptions"
                  :key="option.value"
                  type="button"
                  class="settings-download-select__option"
                  :class="{ 'settings-download-select__option--selected': settings.download.quality === option.value }"
                  role="option"
                  :aria-selected="settings.download.quality === option.value"
                  @click="handleSelectQuality(option.value)"
                >
                  <div class="settings-download-select__option-info">
                    <div class="settings-download-select__option-text">{{ option.label }}</div>
                    <div class="settings-download-select__option-desc">{{ option.desc }}</div>
                  </div>
                  <Check
                    v-if="settings.download.quality === option.value"
                    class="settings-download-select__check"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </transition>
          </div>
        </div>
      </div>
    </section>

    <!-- 歌词下载 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        歌词
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <!-- 是否一并下载歌词 -->
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">一并下载歌词</div>
            <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">下载音乐时同时保存对应的歌词文件</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
            :class="settings.download.downloadLyrics ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="settings.download.downloadLyrics = !settings.download.downloadLyrics"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.downloadLyrics ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 歌词格式（仅当启用歌词下载时可用） -->
        <transition name="settings-download-collapse">
          <div
            v-if="settings.download.downloadLyrics"
            class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                <FileText class="h-4 w-4 text-gray-400 dark:text-white/45" />
                歌词格式
              </div>
              <div class="text-xs text-gray-500 dark:text-white/55 mt-1">
                {{ lyricsFormatOptions.find(o => o.value === settings.download.lyricsFormat)?.desc }}
              </div>
            </div>
            <div ref="lyricsFormatSelectRef" class="settings-download-select">
              <button
                type="button"
                class="settings-download-select__trigger"
                :class="{ 'settings-download-select__trigger--open': isLyricsFormatMenuOpen }"
                aria-haspopup="listbox"
                :aria-expanded="isLyricsFormatMenuOpen"
                @click="toggleLyricsFormatMenu"
              >
                <span class="settings-download-select__label">{{ selectedLyricsFormatLabel }}</span>
                <ChevronDown
                  class="settings-download-select__icon"
                  :class="{ 'settings-download-select__icon--open': isLyricsFormatMenuOpen }"
                  aria-hidden="true"
                />
              </button>
              <transition name="settings-download-menu">
                <div
                  v-if="isLyricsFormatMenuOpen"
                  class="settings-download-select__menu"
                  role="listbox"
                  aria-label="歌词格式"
                >
                  <button
                    v-for="option in lyricsFormatOptions"
                    :key="option.value"
                    type="button"
                    class="settings-download-select__option"
                    :class="{ 'settings-download-select__option--selected': settings.download.lyricsFormat === option.value }"
                    role="option"
                    :aria-selected="settings.download.lyricsFormat === option.value"
                    @click="handleSelectLyricsFormat(option.value)"
                  >
                    <div class="settings-download-select__option-info">
                      <div class="settings-download-select__option-text">{{ option.label }}</div>
                      <div class="settings-download-select__option-desc">{{ option.desc }}</div>
                    </div>
                    <Check
                      v-if="settings.download.lyricsFormat === option.value"
                      class="settings-download-select__check"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </transition>
            </div>
          </div>
        </transition>
      </div>
    </section>

    <!-- 文件命名 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        文件选项
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <!-- 覆盖已存在文件 -->
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">覆盖已存在文件</div>
            <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">下载同名文件时直接替换，关闭则会自动跳过或重命名</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
            :class="settings.download.overwriteExisting ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="settings.download.overwriteExisting = !settings.download.overwriteExisting"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.overwriteExisting ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 保留源文件名 -->
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">保留源文件名</div>
            <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">使用源链接的原始文件名，关闭则按"歌手 - 标题"格式命名</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
            :class="settings.download.keepSourceFilename ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="settings.download.keepSourceFilename = !settings.download.keepSourceFilename"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.keepSourceFilename ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- 重置按钮 -->
    <section class="space-y-3">
      <div class="flex justify-end">
        <button
          type="button"
          class="settings-download-action settings-download-action--soft"
          @click="() => {
            settings.download.downloadPath = '';
            settings.download.format = 'mp3';
            settings.download.quality = 'high';
            settings.download.downloadLyrics = true;
            settings.download.lyricsFormat = 'lrc';
            settings.download.overwriteExisting = false;
            settings.download.keepSourceFilename = false;
            showToast('已恢复默认下载设置', 'success');
          }"
        >
          <RotateCcw class="h-4 w-4" />
          恢复默认
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-download-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 12px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
  cursor: pointer;
  flex-shrink: 0;
}

.settings-download-action:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08);
}

.settings-download-action--soft {
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}

.settings-download-action--soft:hover {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
}

.settings-download-select {
  position: relative;
  width: min(220px, 40vw);
  flex-shrink: 0;
}

.settings-download-select__trigger {
  display: flex;
  min-height: 40px;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 8px 12px 8px 14px;
  color: rgb(55 65 81);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-download-select__trigger:hover,
.settings-download-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.28);
  background: rgba(255, 255, 255, 0.86);
}

.settings-download-select__trigger:focus-visible,
.settings-download-select__trigger--open {
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.settings-download-select__label {
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-download-select__icon {
  height: 16px;
  width: 16px;
  flex: 0 0 auto;
  color: rgba(55, 65, 81, 0.72);
  transition: transform 160ms ease;
}

.settings-download-select__icon--open {
  transform: rotate(180deg);
}

.settings-download-select__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 40;
  width: min(320px, calc(100vw - 48px));
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.16);
  padding: 6px;
  backdrop-filter: blur(18px);
}

.settings-download-select__option {
  display: flex;
  min-height: 44px;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 10px;
  padding: 8px 10px;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  transition: background-color 140ms ease, color 140ms ease;
}

.settings-download-select__option:hover,
.settings-download-select__option:focus-visible {
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
  outline: none;
}

.settings-download-select__option--selected {
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.settings-download-select__option-info {
  min-width: 0;
  flex: 1;
}

.settings-download-select__option-text {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-download-select__option-desc {
  font-size: 11px;
  font-weight: 400;
  color: rgba(100, 116, 139, 0.85);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-download-select__check {
  height: 15px;
  width: 15px;
  flex: 0 0 auto;
}

.settings-download-menu-enter-active,
.settings-download-menu-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  transform-origin: top right;
}

.settings-download-menu-enter-from,
.settings-download-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.settings-download-menu-enter-to,
.settings-download-menu-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.settings-download-collapse-enter-active,
.settings-download-collapse-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-download-collapse-enter-from,
.settings-download-collapse-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

.settings-download-collapse-enter-to,
.settings-download-collapse-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 200px;
}

:global(.dark) .settings-download-action {
  border-color: rgba(236, 65, 65, 0.24);
  background: rgba(236, 65, 65, 0.12);
  color: #ff8b8b;
}

:global(.dark) .settings-download-action:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.18);
  color: #ffb3b3;
}

:global(.dark) .settings-download-select__trigger {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-download-select__trigger:hover,
:global(.dark) .settings-download-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(255, 255, 255, 0.08);
}

:global(.dark) .settings-download-select__trigger:focus-visible,
:global(.dark) .settings-download-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

:global(.dark) .settings-download-select__icon {
  color: rgba(255, 255, 255, 0.72);
}

:global(.dark) .settings-download-select__menu {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.94);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
}

:global(.dark) .settings-download-select__option {
  color: rgba(255, 255, 255, 0.88);
}

:global(.dark) .settings-download-select__option:hover,
:global(.dark) .settings-download-select__option:focus-visible {
  background: rgba(236, 65, 65, 0.16);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .settings-download-select__option--selected {
  background: rgba(236, 65, 65, 0.22);
  color: #fff;
}

:global(.dark) .settings-download-select__option-desc {
  color: rgba(255, 255, 255, 0.5);
}
</style>
