<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  useSettingsConflict,
  type CategoryChoice,
  type SyncCategoryChoices,
} from '../../composables/useSettingsConflict';

const { conflictState, resolveSettingsConflict } = useSettingsConflict();

const pad = (n: number) => n.toString().padStart(2, '0');

const localTimeDisplay = computed(() => {
  const ts = conflictState.value.localTimestamp;
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

const cloudTimeDisplay = computed(() => {
  const ts = conflictState.value.cloudTimestamp;
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

/** 二级确认状态 */
const pendingDirection = ref<CategoryChoice | null>(null);

/** 按类别的选择，默认跟随第一弹窗的整体选择 */
const categoryChoices = ref<SyncCategoryChoices>({
  settings: 'local',
  playlists: 'local',
  plugins: 'local',
});

const categoryItems = computed(() => [
  { key: 'settings' as const, label: '设置', desc: '播放、歌词、外观等偏好配置' },
  { key: 'playlists' as const, label: '歌单', desc: '本地创建与编辑的歌单' },
  { key: 'plugins' as const, label: '插件', desc: '已安装的插件配置' },
]);

/** 主弹窗关闭时重置二级确认状态 */
watch(() => conflictState.value.visible, (visible) => {
  if (!visible) {
    pendingDirection.value = null;
  }
});

function handleFirstChoice(direction: CategoryChoice) {
  // 预选所有类别为同一方向
  categoryChoices.value = {
    settings: direction,
    playlists: direction,
    plugins: direction,
  };
  pendingDirection.value = direction;
}

function toggleCategory(key: keyof SyncCategoryChoices, choice: CategoryChoice) {
  categoryChoices.value = {
    ...categoryChoices.value,
    [key]: choice,
  };
}

function confirmPendingChoice() {
  resolveSettingsConflict({ ...categoryChoices.value });
  pendingDirection.value = null;
}

function cancelPendingChoice() {
  pendingDirection.value = null;
}

function cancelAll() {
  resolveSettingsConflict('cancel');
}
</script>

<template>
  <Teleport to="body">
    <!-- 第一弹窗：冲突选择 -->
    <Transition name="conflict-modal" appear>
      <div
        v-if="conflictState.visible && !pendingDirection"
        class="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        @click.self="cancelAll"
      >
        <div class="conflict-card">
          <div class="conflict-icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <h3 class="conflict-title">设置同步冲突</h3>
          <p class="conflict-desc">
            检测到本地设置与云端设置不一致，请选择要保留的版本。下一 步可按类别精细调整。
          </p>

          <div class="conflict-info">
            <div class="conflict-info-row">
              <div class="conflict-info-label">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                本地设置
              </div>
              <span class="conflict-info-time">{{ localTimeDisplay }}</span>
            </div>
            <div class="conflict-info-row">
              <div class="conflict-info-label">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                云端设置
              </div>
              <span class="conflict-info-time">{{ cloudTimeDisplay }}</span>
            </div>
          </div>

          <div class="conflict-actions">
            <button
              type="button"
              class="conflict-btn conflict-btn--local"
              @click="handleFirstChoice('local')"
            >
              保留本地
            </button>
            <button
              type="button"
              class="conflict-btn conflict-btn--cloud"
              @click="handleFirstChoice('cloud')"
            >
              保留云端
            </button>
          </div>
          <button
            type="button"
            class="conflict-cancel"
            @click="cancelAll"
          >
            取消
          </button>
        </div>
      </div>
    </Transition>

    <!-- 第二弹窗：按类别精细选择 -->
    <Transition name="confirm-modal" appear>
      <div
        v-if="pendingDirection"
        class="fixed inset-0 z-[310] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        @click.self="cancelPendingChoice"
      >
        <div class="confirm-card">
          <div class="confirm-icon" :class="pendingDirection === 'local' ? 'confirm-icon--local' : 'confirm-icon--cloud'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h3 class="confirm-title">确认同步范围</h3>
          <p class="confirm-desc">可按类别分别选择保留本地或云端，确认后将执行对应方向的同步。</p>

          <div class="category-list">
            <div
              v-for="item in categoryItems"
              :key="item.key"
              class="category-row"
            >
              <div class="category-label-block">
                <div class="category-label">{{ item.label }}</div>
                <div class="category-desc">{{ item.desc }}</div>
              </div>
              <div class="category-toggle">
                <button
                  type="button"
                  class="toggle-btn"
                  :class="{ 'toggle-btn--active-local': categoryChoices[item.key] === 'local' }"
                  @click="toggleCategory(item.key, 'local')"
                >
                  本地
                </button>
                <button
                  type="button"
                  class="toggle-btn"
                  :class="{ 'toggle-btn--active-cloud': categoryChoices[item.key] === 'cloud' }"
                  @click="toggleCategory(item.key, 'cloud')"
                >
                  云端
                </button>
              </div>
            </div>
          </div>

          <div class="confirm-actions">
            <button
              type="button"
              class="confirm-btn confirm-btn--ghost"
              @click="cancelPendingChoice"
            >
              返回
            </button>
            <button
              type="button"
              class="confirm-btn confirm-btn--primary"
              @click="confirmPendingChoice"
            >
              确认同步
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ==================== 主弹窗 ==================== */
.conflict-card {
  width: min(90vw, 400px);
  background: #ffffff;
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.conflict-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  margin: 0 auto 14px;
}

.conflict-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}

.conflict-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 18px;
}

.conflict-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
}

.conflict-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.conflict-info-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(55, 65, 81, 0.9);
}

.conflict-info-time {
  font-size: 0.72rem;
  color: rgba(107, 114, 128, 0.85);
}

.conflict-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 10px;
}

.conflict-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.conflict-btn:active {
  transform: scale(0.97);
}

.conflict-btn--local {
  border-color: rgba(236, 65, 65, 0.3);
  background: rgba(236, 65, 65, 0.06);
  color: #EC4141;
}

.conflict-btn--local:hover {
  background: #EC4141;
  color: #ffffff;
}

.conflict-btn--cloud {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6;
}

.conflict-btn--cloud:hover {
  background: #3b82f6;
  color: #ffffff;
}

.conflict-cancel {
  background: transparent;
  border: none;
  color: rgba(107, 114, 128, 0.8);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 4px 12px;
  transition: color 160ms ease;
}

.conflict-cancel:hover {
  color: rgba(55, 65, 81, 1);
}

/* ==================== 二级确认弹窗 ==================== */
.confirm-card {
  width: min(92vw, 440px);
  background: #ffffff;
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22), 0 4px 16px rgba(0, 0, 0, 0.1);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.confirm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  margin: 0 auto 14px;
}

.confirm-icon--local {
  background: rgba(236, 65, 65, 0.1);
  color: #EC4141;
}

.confirm-icon--cloud {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.confirm-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}

.confirm-desc {
  font-size: 0.82rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 18px;
}

/* ==================== 类别选择列表 ==================== */
.category-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
  text-align: left;
}

.category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
}

.category-label-block {
  min-width: 0;
}

.category-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(31, 41, 55, 0.95);
}

.category-desc {
  font-size: 0.7rem;
  color: rgba(107, 114, 128, 0.8);
  margin-top: 2px;
}

.category-toggle {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.toggle-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: transparent;
  color: rgba(107, 114, 128, 0.7);
  transition: all 160ms ease;
}

.toggle-btn:hover {
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(55, 65, 81, 0.9);
}

.toggle-btn--active-local {
  background: #EC4141;
  border-color: #EC4141;
  color: #ffffff;
}

.toggle-btn--active-local:hover {
  background: #d13b3b;
  border-color: #d13b3b;
  color: #ffffff;
}

.toggle-btn--active-cloud {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #ffffff;
}

.toggle-btn--active-cloud:hover {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

/* ==================== 确认按钮 ==================== */
.confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.confirm-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.confirm-btn:active {
  transform: scale(0.97);
}

.confirm-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.confirm-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.confirm-btn--primary {
  background: #1f2937;
  color: #ffffff;
}

.confirm-btn--primary:hover {
  background: #111827;
}

/* ==================== 过渡动画 ==================== */
.conflict-modal-enter-active,
.conflict-modal-leave-active {
  transition: opacity 0.2s ease;
}

.conflict-modal-enter-active .conflict-card,
.conflict-modal-leave-active .conflict-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.conflict-modal-enter-from,
.conflict-modal-leave-to {
  opacity: 0;
}

.conflict-modal-enter-from .conflict-card,
.conflict-modal-leave-to .conflict-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.confirm-modal-enter-active,
.confirm-modal-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-modal-enter-active .confirm-card,
.confirm-modal-leave-active .confirm-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.confirm-modal-enter-from,
.confirm-modal-leave-to {
  opacity: 0;
}

.confirm-modal-enter-from .confirm-card,
.confirm-modal-leave-to .confirm-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

</style>

<!-- 深色模式使用非 scoped style 块 -->
<!-- 原因：Vue scoped 的 :global(.dark) .xxx 复合选择器在构建时会被错误编译，
     .xxx 部分被丢弃，导致深色样式直接应用到 html.dark 元素而非目标元素。
     改用非 scoped 块 + html.dark .xxx 选择器可正确适配深色模式。 -->
<style>
/* ==================== 深色模式 - 主弹窗 ==================== */
html.dark .conflict-card {
  background: #1f1f23;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .conflict-icon {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

html.dark .conflict-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .conflict-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .conflict-info {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .conflict-info-label {
  color: rgba(255, 255, 255, 0.8);
}

html.dark .conflict-info-time {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .conflict-btn--local {
  border-color: rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.1);
  color: #ff8b8b;
}

html.dark .conflict-btn--local:hover {
  background: #EC4141;
  color: #ffffff;
}

html.dark .conflict-btn--cloud {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.1);
  color: #93c5fd;
}

html.dark .conflict-btn--cloud:hover {
  background: #3b82f6;
  color: #ffffff;
}

html.dark .conflict-cancel {
  color: rgba(255, 255, 255, 0.5);
}

html.dark .conflict-cancel:hover {
  color: rgba(255, 255, 255, 0.9);
}

/* ==================== 深色模式 - 二级确认弹窗 ==================== */
html.dark .confirm-card {
  background: #1f1f23;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .confirm-icon--local {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

html.dark .confirm-icon--cloud {
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
}

html.dark .confirm-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .confirm-desc {
  color: rgba(255, 255, 255, 0.6);
}

/* ==================== 深色模式 - 类别选择 ==================== */
html.dark .category-row {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .category-label {
  color: rgba(255, 255, 255, 0.9);
}

html.dark .category-desc {
  color: rgba(255, 255, 255, 0.4);
}

html.dark .toggle-btn {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
}

html.dark .toggle-btn:hover {
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
}

html.dark .toggle-btn--active-local {
  background: #EC4141;
  border-color: #EC4141;
  color: #ffffff;
}

html.dark .toggle-btn--active-local:hover {
  background: #d13b3b;
  border-color: #d13b3b;
}

html.dark .toggle-btn--active-cloud {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #ffffff;
}

html.dark .toggle-btn--active-cloud:hover {
  background: #2563eb;
  border-color: #2563eb;
}

/* ==================== 深色模式 - 确认按钮 ==================== */
html.dark .confirm-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .confirm-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .confirm-btn--primary {
  background: rgba(255, 255, 255, 0.9);
  color: #1f1f23;
}

html.dark .confirm-btn--primary:hover {
  background: rgba(255, 255, 255, 1);
}
</style>
