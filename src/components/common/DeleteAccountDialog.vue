<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { useDeleteAccountDialog } from '../../composables/useDeleteAccountDialog';
import { useAuthStore } from '../../features/auth/store';
import {
  deleteAccount,
  preVerifyDeleteAccount,
  sendEmailCode,
  type HumanCaptchaPayload,
} from '../../services/auth/authService';
import { useToast } from '../../composables/toast';
import HumanCaptchaModal from './HumanCaptchaModal.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { showToast } = useToast();
const authStore = useAuthStore();

const { deleteAccountDialogState, resolveDeleteAccountDialog } = useDeleteAccountDialog();

const password = ref('');
const code = ref('');
const loading = ref(false);
const codeLoading = ref(false);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// 人机验证
const captchaOpen = ref(false);
const captchaTitle = ref('');
const captchaDescription = ref('');
let captchaResolver: ((payload: HumanCaptchaPayload | null) => void) | null = null;

// 二级确认
const confirmVisible = ref(false);
const confirmTitle = ref('');
const confirmDesc = ref('');
const confirmTone = ref<'danger' | 'success' | 'info'>('danger');
const confirmShowCancel = ref(true);
let confirmResolver: ((confirmed: boolean) => void) | null = null;

watch(
  () => deleteAccountDialogState.value.visible,
  (visible) => {
    if (visible) {
      password.value = '';
      code.value = '';
      loading.value = false;
      codeLoading.value = false;
      countdown.value = 0;
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
  },
);

onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
});

function startCountdown() {
  countdown.value = 60;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      countdown.value = 0;
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
  }, 1000);
}

function requestHumanCaptcha(title: string, description: string): Promise<HumanCaptchaPayload | null> {
  captchaTitle.value = title;
  captchaDescription.value = description;
  captchaOpen.value = true;
  return new Promise((resolve) => {
    captchaResolver = resolve;
  });
}

function resolveHumanCaptcha(payload: HumanCaptchaPayload | null) {
  captchaOpen.value = false;
  captchaResolver?.(payload);
  captchaResolver = null;
}

function handleCaptchaVerified(payload: HumanCaptchaPayload) {
  resolveHumanCaptcha(payload);
}

function handleCaptchaCancel() {
  resolveHumanCaptcha(null);
}

function showConfirm(options: {
  title: string;
  desc: string;
  confirmText?: string;
  showCancel?: boolean;
  tone?: 'danger' | 'success' | 'info';
}): Promise<boolean> {
  confirmTitle.value = options.title;
  confirmDesc.value = options.desc;
  confirmTone.value = options.tone || 'danger';
  confirmShowCancel.value = options.showCancel !== false;
  confirmVisible.value = true;
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(confirmed: boolean) {
  confirmVisible.value = false;
  confirmResolver?.(confirmed);
  confirmResolver = null;
}

function cancel() {
  resolveDeleteAccountDialog(false);
}

async function handleSendCode() {
  const email = authStore.user?.email;
  if (!email) {
    showToast('未获取到注册邮箱，请重新登录', 'error');
    return;
  }
  const captchaPayload = await requestHumanCaptcha(
    '发送注销验证码前验证',
    '完成验证后将向当前账号的注册邮箱发送注销验证码。',
  );
  if (!captchaPayload) return;
  codeLoading.value = true;
  try {
    const result = await sendEmailCode(email, 'delete_account', captchaPayload);
    showToast(result.message || '注销验证码已发送到注册邮箱', 'success');
    startCountdown();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '注销验证码发送失败', 'error');
  } finally {
    codeLoading.value = false;
  }
}

async function handleDelete() {
  const pwd = password.value;
  const verifyCode = code.value.trim();
  if (!pwd) {
    showToast('请输入登录密码', 'error');
    return;
  }
  if (!verifyCode) {
    showToast('请输入邮箱验证码', 'error');
    return;
  }

  // 并行：弹出二级确认弹窗的同时立即发起预验证（密码+验证码），
  // 用户阅读确认提示期间验证已在进行，点击确认后无需重复等待。
  let preVerifyError: Error | null = null;
  const preVerifyPromise = preVerifyDeleteAccount(verifyCode, pwd)
    .then(() => { /* 预验证通过 */ })
    .catch((err: unknown) => {
      preVerifyError = err instanceof Error ? err : new Error(String(err));
      // 预验证失败时若弹窗仍开着，主动关闭并提示
      if (confirmVisible.value) {
        const tip = preVerifyError.message;
        resolveConfirm(false);
        showToast(tip, 'error');
      }
    });

  const confirmed = await showConfirm({
    title: '确认注销账号',
    desc: '注销后账号和云端同步数据将被删除，且无法恢复。确认继续注销当前账号吗？',
    tone: 'danger',
  });
  if (!confirmed) return;

  // 用户已确认，等待预验证结果
  loading.value = true;
  try {
    await preVerifyPromise;
    if (preVerifyError) {
      // 预验证已失败（错误提示已在 catch 中显示），直接退出
      return;
    }
    // 预验证通过，执行实际注销
    const result = await deleteAccount(verifyCode, pwd);
    await showConfirm({
      title: '账号已注销',
      desc: result.message || '账号已注销，点击确认后将退出当前登录状态。',
      tone: 'success',
      showCancel: false,
    });
    authStore.reset();
    showToast('账号已注销', 'success');
    resolveDeleteAccountDialog(true);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '注销账号失败', 'error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <transition name="del-account-modal" appear>
      <div
        v-if="deleteAccountDialogState.visible"
        class="del-account-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
      >
        <div class="del-account-card">
          <div class="del-account-icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 class="del-account-title">注销账号</h3>
          <p class="del-account-desc">
            注销后账号和云端同步数据将被删除，且无法恢复。需验证登录密码和邮箱验证码，验证码将发送到注册邮箱：{{ authStore.user?.email || '未知邮箱' }}
          </p>

          <div class="del-account-form">
            <label class="del-account-field">
              <span class="del-account-label">登录密码</span>
              <input
                v-model="password"
                type="password"
                placeholder="输入当前账号登录密码"
                autocomplete="current-password"
                class="del-account-input"
              />
            </label>
            <div class="del-account-code-row">
              <label class="del-account-field del-account-code-field">
                <span class="del-account-label">邮箱验证码</span>
                <input
                  v-model="code"
                  type="text"
                  placeholder="输入注销验证码"
                  autocomplete="one-time-code"
                  class="del-account-input"
                />
              </label>
              <button
                type="button"
                class="del-account-code-btn"
                :disabled="codeLoading || loading || countdown > 0"
                @click="handleSendCode"
              >
                {{ codeLoading ? '发送中…' : countdown > 0 ? `重新发送 (${countdown}s)` : '发送验证码' }}
              </button>
            </div>
          </div>

          <div class="del-account-actions">
            <button type="button" class="del-account-btn del-account-btn--ghost" :disabled="loading" @click="cancel">
              取消
            </button>
            <button type="button" class="del-account-btn del-account-btn--danger" :disabled="loading" @click="handleDelete">
              {{ loading ? '注销中…' : '确认注销' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 人机验证 -->
    <HumanCaptchaModal
      :open="captchaOpen"
      :title="captchaTitle"
      :description="captchaDescription"
      @verified="handleCaptchaVerified"
      @cancel="handleCaptchaCancel"
    />

    <!-- 二级确认 / 结果提示 -->
    <ConfirmModal
      :visible="confirmVisible"
      :title="confirmTitle"
      :content="confirmDesc"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />
  </Teleport>
</template>

<style scoped>
.del-account-overlay {
  transition: opacity 0.2s ease;
}

.del-account-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.del-account-modal-enter-active {
  transition: opacity 0.2s ease;
}

.del-account-modal-enter-active .del-account-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.del-account-modal-enter-from {
  opacity: 0;
}

.del-account-modal-enter-from .del-account-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.del-account-modal-leave-active {
  transition: opacity 0.2s ease;
}

.del-account-modal-leave-active .del-account-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.del-account-modal-leave-to {
  opacity: 0;
}

.del-account-modal-leave-to .del-account-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
.del-account-card {
  width: min(90vw, 400px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  text-align: center;
}

.del-account-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
  margin: 0 auto 14px;
}

.del-account-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
  text-align: center;
}

.del-account-desc {
  font-size: 0.82rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 16px;
  text-align: center;
}

.del-account-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.del-account-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.del-account-label {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.9);
}

.del-account-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
  color: #1f2937;
  font-size: 0.85rem;
  padding: 0 12px;
  outline: none;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.del-account-input::placeholder {
  color: rgba(107, 114, 128, 0.55);
}

.del-account-input:focus {
  border-color: #ec4141;
  background: rgba(255, 255, 255, 0.9);
}

.del-account-code-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.del-account-code-field {
  flex: 1;
  min-width: 0;
}

.del-account-code-btn {
  flex-shrink: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.05);
  color: #ec4141;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 160ms ease, color 160ms ease, transform 100ms ease;
}

.del-account-code-btn:hover {
  background: #ec4141;
  color: #ffffff;
}

.del-account-code-btn:active {
  transform: scale(0.97);
}

.del-account-code-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.del-account-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.del-account-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.del-account-btn:active {
  transform: scale(0.97);
}

.del-account-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.del-account-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.del-account-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.del-account-btn--danger {
  background: #ec4141;
  color: #ffffff;
}

.del-account-btn--danger:hover {
  background: #d13b3b;
}

html.dark .del-account-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.2);
}

html.dark .del-account-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

html.dark .del-account-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .del-account-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .del-account-label {
  color: rgba(255, 255, 255, 0.5);
}

html.dark .del-account-input {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .del-account-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

html.dark .del-account-input:focus {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .del-account-code-btn {
  border-color: rgba(255, 120, 120, 0.35);
  background: rgba(236, 65, 65, 0.12);
  color: #ff8b8b;
}

html.dark .del-account-code-btn:hover {
  background: #ec4141;
  color: #ffffff;
}

html.dark .del-account-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .del-account-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .del-account-actions {
  background: rgba(255, 255, 255, 0.05);
}
</style>
