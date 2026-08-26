<script setup lang="ts">
import { Music } from 'lucide-vue-next';
import { useShareLinkDialog } from '../../composables/useShareLinkDialog';

const { shareLinkDialogState, resolveShareLinkDialog } = useShareLinkDialog();

function cancel() {
  resolveShareLinkDialog('cancel');
}

function play() {
  // 播放中状态由深链处理器在播放结束后调用 finishShareLinkDialog 关闭
  resolveShareLinkDialog('play');
}

function playNext() {
  // 添加到下一首播放，弹窗直接关闭
  resolveShareLinkDialog('playNext');
}
</script>

<template>
  <Teleport to="body">
    <transition name="share-link-modal" appear>
      <div
        v-if="shareLinkDialogState.visible"
        class="share-link-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
      >
        <div class="share-link-card">
          <h3 class="share-link-title">分享歌曲</h3>
          <p class="share-link-desc">收到一首分享歌曲，点击播放开始收听</p>

          <div class="share-link-song">
            <div class="share-link-cover">
              <img
                v-if="shareLinkDialogState.cover"
                :src="shareLinkDialogState.cover"
                alt="封面"
                referrerpolicy="no-referrer"
                @error="shareLinkDialogState.cover = ''"
              />
              <Music v-else class="h-8 w-8" />
            </div>
            <div class="share-link-info">
              <div class="share-link-name">{{ shareLinkDialogState.name }}</div>
              <div class="share-link-artist">{{ shareLinkDialogState.artist }}</div>
              <div class="share-link-source">
                <span class="share-link-tag">来源</span>
                <span class="share-link-source-name">{{ shareLinkDialogState.sourceLabel }}</span>
              </div>
            </div>
          </div>

          <div class="share-link-actions">
            <button
              type="button"
              class="share-link-btn share-link-btn--ghost"
              :disabled="shareLinkDialogState.resolver === null"
              @click="cancel"
            >
              取消
            </button>
            <button
              type="button"
              class="share-link-btn share-link-btn--secondary"
              :disabled="shareLinkDialogState.resolver === null"
              @click="playNext"
            >
              下一首播放
            </button>
            <button
              type="button"
              class="share-link-btn share-link-btn--primary"
              :disabled="shareLinkDialogState.resolver === null"
              @click="play"
            >
              {{ shareLinkDialogState.resolver === null ? '播放中…' : '播放' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.share-link-overlay {
  transition: opacity 0.2s ease;
}
.share-link-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.share-link-modal-enter-active {
  transition: opacity 0.2s ease;
}
.share-link-modal-enter-active .share-link-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.share-link-modal-enter-from {
  opacity: 0;
}
.share-link-modal-enter-from .share-link-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
.share-link-modal-leave-active {
  transition: opacity 0.2s ease;
}
.share-link-modal-leave-active .share-link-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.share-link-modal-leave-to {
  opacity: 0;
}
.share-link-modal-leave-to .share-link-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
.share-link-card {
  width: min(90vw, 400px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.share-link-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
  text-align: center;
}
.share-link-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 16px;
  text-align: center;
}
.share-link-song {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(249, 250, 251, 0.6);
}
.share-link-cover {
  width: 92px;
  height: 92px;
  flex-shrink: 0;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(226, 232, 240, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(100, 116, 139, 0.6);
}
.share-link-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.share-link-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.share-link-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-link-artist {
  font-size: 0.8rem;
  color: rgba(107, 114, 128, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-link-source {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.share-link-tag {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
  flex-shrink: 0;
}
.share-link-source-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(75, 85, 99, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-link-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}
.share-link-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}
.share-link-btn:active {
  transform: scale(0.97);
}
.share-link-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.share-link-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}
.share-link-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}
.share-link-btn--secondary {
  border-color: rgba(236, 65, 65, 0.32);
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}
.share-link-btn--secondary:hover {
  background: rgba(236, 65, 65, 0.14);
  color: #d13b3b;
}
.share-link-btn--primary {
  background: #ec4141;
  color: #ffffff;
}
.share-link-btn--primary:hover {
  background: #d13b3b;
}

html.dark .share-link-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}
html.dark .share-link-title {
  color: rgba(255, 255, 255, 0.96);
}
html.dark .share-link-desc {
  color: rgba(255, 255, 255, 0.6);
}
html.dark .share-link-song {
  background: rgba(255, 255, 255, 0.05);
}
html.dark .share-link-cover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.35);
}
html.dark .share-link-name {
  color: rgba(255, 255, 255, 0.96);
}
html.dark .share-link-artist {
  color: rgba(255, 255, 255, 0.55);
}
html.dark .share-link-source-name {
  color: rgba(255, 255, 255, 0.75);
}
html.dark .share-link-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}
html.dark .share-link-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}
html.dark .share-link-btn--secondary {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.12);
  color: #ff7a7a;
}
html.dark .share-link-btn--secondary:hover {
  background: rgba(236, 65, 65, 0.2);
  color: #ff8f8f;
}
html.dark .share-link-actions {
  background: rgba(255, 255, 255, 0.05);
}
</style>
