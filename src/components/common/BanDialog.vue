<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBanDialog } from '../../composables/useBanDialog';
import { submitAppeal } from '../../services/usageStats';
import { useToast } from '../../composables/toast';

const { showToast } = useToast();

const { banDialogState, resolveBanDialog } = useBanDialog();

const mode = computed(() => banDialogState.value.mode);

const APPEAL_MAX = 1000;
const appealing = ref(false);
const appealText = ref('');
const submitting = ref(false);

watch(
  () => banDialogState.value.visible,
  (visible) => {
    if (!visible) {
      appealing.value = false;
      appealText.value = '';
      submitting.value = false;
    }
  },
);

const title = computed(() => {
  if (banDialogState.value.mode === 'session') return '登录验证失败';
  return banDialogState.value.banType === 'device' ? '设备已被封禁' : '账号已被封禁';
});

const reasonText = computed(() => {
  if (banDialogState.value.mode === 'session') {
    return banDialogState.value.reason || '登录状态已失效，请重新登录账号以继续使用。';
  }
  return banDialogState.value.reason || '你的账号已被管理员封禁，如有疑问请联系管理员。';
});

function confirm() {
  resolveBanDialog(true);
}

/** session 模式：仅关闭弹窗，不跳转 */
function confirmClose() {
  resolveBanDialog(false);
}

/** 切换按钮：仅关闭并告知调用方「去登录」，由调用方跳转登录页 */
function goLogin() {
  resolveBanDialog(true);
}

function cancelAppeal() {
  appealing.value = false;
}

function startAppeal() {
  appealText.value = '';
  appealing.value = true;
}

async function submitAppealHandler() {
  const content = appealText.value.trim();
  if (!content) {
    showToast('请填写申诉内容', 'error');
    return;
  }
  if (content.length > APPEAL_MAX) {
    showToast(`申诉内容不能超过 ${APPEAL_MAX} 字`, 'error');
    return;
  }
  if (!banDialogState.value.ciyuanxiId && !banDialogState.value.debug) {
    showToast('登录信息已失效，无法提交申诉，请重新登录账号', 'error');
    return;
  }
  submitting.value = true;
  try {
    if (banDialogState.value.debug) {
      // 调试模式：仅模拟提交流程，不发送服务器
      await new Promise((r) => setTimeout(r, 600));
      showToast('（调试）申诉已提交，请耐心等待处理', 'success');
    } else {
      await submitAppeal(
        banDialogState.value.ciyuanxiId,
        banDialogState.value.nickname,
        content,
      );
      showToast('申诉已提交，请耐心等待处理', 'success');
    }
    resolveBanDialog(false);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '申诉提交失败', 'error');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <transition name="ban-modal" appear>
      <div
        v-if="banDialogState.visible"
        class="ban-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
        @click.self="!appealing && (mode === 'session' ? confirmClose() : confirm())"
      >
        <div class="ban-card">
          <div class="ban-icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM9 14.5a1 1 0 112 0 1 1 0 01-2 0z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
          <h3 class="ban-title">{{ title }}</h3>
          <p v-if="mode === 'session'" class="ban-version">请重新登录账号以继续</p>
          <p v-else-if="banDialogState.ciyuanxiId" class="ban-version">弦予号 {{ banDialogState.ciyuanxiId }}</p>
          <p v-else class="ban-version">当前设备已受限</p>

          <div v-if="!appealing" class="ban-content">
            <p class="ban-desc">{{ reasonText }}</p>
          </div>

          <div v-else class="ban-content">
            <textarea
              v-model="appealText"
              class="ban-textarea"
              :maxlength="APPEAL_MAX"
              rows="4"
              placeholder="请填写申诉理由，我们会尽快审核处理…"
            ></textarea>
            <div class="ban-counter">{{ appealText.length }} / {{ APPEAL_MAX }}</div>
          </div>

          <div v-if="!appealing" class="ban-actions">
            <template v-if="mode === 'session'">
              <button type="button" class="ban-btn ban-btn--ghost" @click="confirmClose">
                确认
              </button>
              <button type="button" class="ban-btn ban-btn--primary" @click="goLogin">
                登录
              </button>
            </template>
            <template v-else>
              <button type="button" class="ban-btn ban-btn--ghost" @click="startAppeal">
                申诉
              </button>
              <button type="button" class="ban-btn ban-btn--primary" @click="confirm">
                确认
              </button>
            </template>
          </div>

          <div v-else class="ban-actions">
            <button type="button" class="ban-btn ban-btn--ghost" :disabled="submitting" @click="cancelAppeal">
              取消
            </button>
            <button type="button" class="ban-btn ban-btn--primary" :disabled="submitting" @click="submitAppealHandler">
              {{ submitting ? '提交中…' : '提交申诉' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.ban-overlay {
  transition: opacity 0.2s ease;
}

.ban-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ban-modal-enter-active {
  transition: opacity 0.2s ease;
}

.ban-modal-enter-active .ban-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ban-modal-enter-from {
  opacity: 0;
}

.ban-modal-enter-from .ban-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.ban-modal-leave-active {
  transition: opacity 0.2s ease;
}

.ban-modal-leave-active .ban-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ban-modal-leave-to {
  opacity: 0;
}

.ban-modal-leave-to .ban-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
.ban-card {
  width: min(90vw, 400px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.ban-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
  margin: 0 auto 14px;
}

.ban-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
}

.ban-version {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.85);
  margin: 0 0 16px;
}

.ban-content {
  margin-bottom: 18px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  max-height: 40vh;
  overflow-y: auto;
  text-align: left;
}

.ban-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0;
  white-space: pre-line;
}

.ban-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 96px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
  color: #1f2937;
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 10px 12px;
  outline: none;
}

.ban-textarea:focus {
  border-color: #ec4141;
}

.ban-counter {
  margin-top: 6px;
  text-align: right;
  font-size: 0.72rem;
  color: rgba(107, 114, 128, 0.85);
}

.ban-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.ban-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.ban-btn:active {
  transform: scale(0.97);
}

.ban-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ban-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.ban-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.ban-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

.ban-btn--primary:hover {
  background: #d13b3b;
}

html.dark .ban-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .ban-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #fca5a5;
}

html.dark .ban-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .ban-version {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .ban-content {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .ban-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .ban-textarea {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .ban-counter {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .ban-actions {
  background: rgba(255, 255, 255, 0.05);
}

html.dark .ban-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .ban-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .ban-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

html.dark .ban-btn--primary:hover {
  background: #d13b3b;
}
</style>