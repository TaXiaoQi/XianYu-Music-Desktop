<script setup lang="ts">
import { onUnmounted, ref } from 'vue';

import { useCustomThemeModal } from '../../composables/useCustomThemeModal';
import SkinPreviewStage from './customSkin/SkinPreviewStage.vue';
import SkinAdjustmentPanel from './customSkin/SkinAdjustmentPanel.vue';
import { useSkinDraftMedia } from './customSkin/useSkinDraftMedia';
import WallpaperGallery from './WallpaperGallery.vue';
import ThemeGallery from './ThemeGallery.vue';

const emit = defineEmits<{ (event: 'close'): void; }>();

const themeModal = useCustomThemeModal();
const preview = themeModal.preview;
const handleSelectImage = themeModal.handleSelectImage;
const handleSelectVideo = themeModal.handleSelectVideo;
const resetSkinDefaults = themeModal.resetToDefaults;
const discardThemeDraft = themeModal.handleCancel;
const applyThemeDraft = themeModal.handleSave;

const draftMedia = useSkinDraftMedia({ draft: preview, pickImage: handleSelectImage, pickVideo: handleSelectVideo });
const adoptLocalImage = draftMedia.adoptLocalImage;
const adoptLocalVideo = draftMedia.adoptLocalVideo;
const applyGalleryWallpaper = draftMedia.adoptGalleryWallpaper;

// —— 关闭淡出动画：先播动画再卸载 ——
const closingOut = ref(false);
let fadeOutTimer: ReturnType<typeof setTimeout> | null = null;

const beginClose = () => {
  if (closingOut.value) { return; }
  closingOut.value = true;
  fadeOutTimer = setTimeout(() => {
    emit('close');
    fadeOutTimer = null;
  }, 220);
};

const cancelAndClose = () => { discardThemeDraft(); beginClose(); };
const saveAndClose = () => { applyThemeDraft(); beginClose(); };

// —— 壁纸中心 / 主题中心弹层 ——
const galleryOpen = ref(false);
const themeOpen = ref(false);

onUnmounted(() => { if (fadeOutTimer) { clearTimeout(fadeOutTimer); fadeOutTimer = null; } });

// 图标路径数据集中管理
const ICON_PATHS = {
  closeModal: 'M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z',
  localImage: 'M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z',
};
</script>

<template>
  <Teleport to="body">
    <div class="skin-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" :class="{ 'is-closing': closingOut }">
      <div class="skin-card flex max-h-[calc(100vh-2rem)] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md" :class="{ 'is-closing': closingOut }">
        <!-- 头部：标题 + 媒体来源入口 -->
        <div class="border-b border-white/10 px-6 py-4">
          <div class="flex items-center justify-between">
            <span class="font-bold text-base">自定义皮肤</span>
            <div class="flex items-center gap-3">
              <button class="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10" @click="resetSkinDefaults">恢复默认</button>
              <button class="text-white/50 transition hover:text-white" @click="cancelAndClose">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" clip-rule="evenodd" :d="ICON_PATHS.closeModal" /></svg></button></div>
          </div>
          <div class="mt-3 flex gap-2">
            <button class="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:bg-white/10 active:scale-95 shadow-sm cursor-pointer" @click="adoptLocalImage">
              <svg class="h-3.5 w-3.5 text-white/70" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" clip-rule="evenodd" :d="ICON_PATHS.localImage" /></svg>
              <span>选择本地图片</span></button>
            <button class="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:bg-white/10 active:scale-95 shadow-sm cursor-pointer" @click="adoptLocalVideo">
              <svg class="h-3.5 w-3.5 text-white/70" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm10.5 5.5a1 1 0 00-1.5-.87l-4 2.31a1 1 0 000 1.73l4 2.31a1 1 0 001.5-.87V8.5z" fill-rule="evenodd" clip-rule="evenodd" /></svg>
              <span>选择本地视频</span></button>
            <button class="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#EC4141]/30 bg-[#EC4141]/10 px-3 py-1.5 text-xs font-semibold text-[#ff8a8a] backdrop-blur-md transition hover:bg-[#EC4141]/20 active:scale-95 shadow-sm cursor-pointer" @click="galleryOpen = true">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline></svg>
              <span>壁纸中心</span></button>
            <button class="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#EC4141]/30 bg-[#EC4141]/10 px-3 py-1.5 text-xs font-semibold text-[#ff8a8a] backdrop-blur-md transition hover:bg-[#EC4141]/20 active:scale-95 shadow-sm cursor-pointer" @click="themeOpen = true">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>
              <span>主题中心</span></button>
          </div></div>

        <!-- 主体：预览舞台 + 参数调节 -->
        <div class="overflow-y-auto flex-1">
          <div class="flex flex-col p-6 gap-6">
            <SkinPreviewStage :draft="preview" />

            <SkinAdjustmentPanel :draft="preview" />
          </div></div>

        <!-- 底部：取消 / 保存 -->
        <div class="flex gap-4 border-t bg-[#242424] border-white/10 px-6 py-4">
          <button class="flex-1 rounded-full border border-white/10 py-2.5 text-sm font-medium transition hover:bg-white/5" @click="cancelAndClose">取消</button>
          <button
            class="rounded-full flex-1 bg-[#EC4141] py-2.5 font-bold text-sm text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#EC4141]"
            :disabled="!preview.imagePath"
            @click="saveAndClose"
          >保存并使用</button></div>
      </div></div>

    <WallpaperGallery
      v-if="galleryOpen"
      :current-path="preview.imagePath"
      @close="galleryOpen = false"
      @select="applyGalleryWallpaper"
    />

    <ThemeGallery
      v-if="themeOpen"
      @close="themeOpen = false"
    />
  </Teleport>
</template>

<style scoped>
/* ==================== 弹窗进出场动画 ==================== */
.skin-overlay {
  animation: skin-overlay-in 0.2s ease;
  transition: opacity 0.2s ease;
}

.skin-card {
  animation: skin-card-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes skin-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes skin-card-in {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.skin-overlay.is-closing { opacity: 0; }

.skin-card.is-closing {
  transform: scale(0.92) translateY(8px);
  opacity: 0;
}
</style>
