<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { UploadCloud } from 'lucide-vue-next';

export type ExportCategory = 'settings' | 'playlists' | 'plugins' | 'favorites';

export interface ExportSelection {
  settings: boolean;
  playlists: boolean;
  plugins: boolean;
  favorites: boolean;
}

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm', selection: ExportSelection): void;
}>();

const selection = ref<ExportSelection>({
  settings: true,
  playlists: true,
  plugins: true,
  favorites: true,
});

/** 每次打开时重置回全选 */
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selection.value = { settings: true, playlists: true, plugins: true, favorites: true };
    }
  },
);

const categoryItems = computed(() => [
  { key: 'settings' as const, label: '设置', desc: '播放、歌词、外观等偏好配置' },
  { key: 'playlists' as const, label: '歌单', desc: '本地创建与编辑的歌单（自动区分本地/在线/混合）' },
  { key: 'plugins' as const, label: '插件', desc: '已安装的插件脚本与配置' },
  { key: 'favorites' as const, label: '收藏', desc: '收藏的本地与在线歌曲' },
]);

function toggleCategory(key: ExportCategory) {
  selection.value = {
    ...selection.value,
    [key]: !selection.value[key],
  };
}

function confirmExport() {
  emit('confirm', { ...selection.value });
}

function close() {
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="export-modal" appear>
      <div
        v-if="visible"
        class="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      >
        <div class="export-card">
          <div class="export-icon">
            <UploadCloud class="h-6 w-6" />
          </div>
          <h3 class="export-title">导出备份</h3>
          <p class="export-desc">请选择要导出到备份文件的内容，可单独开关每一项。</p>

          <div class="export-list">
            <div
              v-for="item in categoryItems"
              :key="item.key"
              class="export-row"
              :class="{ 'is-selected': selection[item.key] }"
              @click="toggleCategory(item.key)"
            >
              <span
                class="export-check"
                :class="{ 'is-checked': selection[item.key] }"
              >
                <svg v-if="selection[item.key]" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <div class="export-label-block">
                <div class="export-label">{{ item.label }}</div>
                <div class="export-desc-sub">{{ item.desc }}</div>
              </div>
            </div>
          </div>

          <div class="export-actions">
            <button type="button" class="export-btn export-btn--ghost" @click="close">
              取消
            </button>
            <button type="button" class="export-btn export-btn--primary" @click="confirmExport">
              导出
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.export-card {
  width: min(92vw, 420px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22), 0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.export-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #EC4141;
  margin: 0 auto 14px;
}

.export-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}

.export-desc {
  font-size: 0.82rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 18px;
}

/* ==================== 选择列表 ==================== */
.export-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
  text-align: left;
}

.export-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;
}

.export-row:hover {
  background: rgba(0, 0, 0, 0.05);
}

.export-row.is-selected {
  background: rgba(236, 65, 65, 0.07);
  border-color: rgba(236, 65, 65, 0.18);
}

.export-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid rgba(0, 0, 0, 0.16);
  background: transparent;
  color: #fff;
  flex-shrink: 0;
  transition: all 160ms ease;
}

.export-check.is-checked {
  background: #EC4141;
  border-color: #EC4141;
}

.export-label-block {
  min-width: 0;
}

.export-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(31, 41, 55, 0.95);
}

.export-desc-sub {
  font-size: 0.7rem;
  color: rgba(107, 114, 128, 0.8);
  margin-top: 2px;
}

/* ==================== 按钮 ==================== */
.export-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 0 -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.export-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.export-btn:active {
  transform: scale(0.97);
}

.export-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.export-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.export-btn--primary {
  background: #1f2937;
  color: #ffffff;
}

.export-btn--primary:hover {
  background: #111827;
}

/* ==================== 过渡动画 ==================== */
.export-modal-enter-active,
.export-modal-leave-active {
  transition: opacity 0.2s ease;
}

.export-modal-enter-active .export-card,
.export-modal-leave-active .export-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.export-modal-enter-from,
.export-modal-leave-to {
  opacity: 0;
}

.export-modal-enter-from .export-card,
.export-modal-leave-to .export-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<!-- 深色模式用非 scoped 块，适配 html.dark（与设置同步冲突弹窗一致的做法） -->
<style>
html.dark .export-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.2);
}

html.dark .export-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

html.dark .export-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .export-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .export-row {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .export-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

html.dark .export-row.is-selected {
  background: rgba(236, 65, 65, 0.16);
  border-color: rgba(236, 65, 65, 0.3);
}

html.dark .export-check {
  border-color: rgba(255, 255, 255, 0.22);
}

html.dark .export-check.is-checked {
  background: #EC4141;
  border-color: #EC4141;
}

html.dark .export-label {
  color: rgba(255, 255, 255, 0.9);
}

html.dark .export-desc-sub {
  color: rgba(255, 255, 255, 0.4);
}

html.dark .export-actions {
  background: rgba(255, 255, 255, 0.05);
}

html.dark .export-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .export-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .export-btn--primary {
  background: rgba(255, 255, 255, 0.9);
  color: #262626;
}

html.dark .export-btn--primary:hover {
  background: rgba(255, 255, 255, 1);
}
</style>