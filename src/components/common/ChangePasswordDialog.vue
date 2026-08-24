<script setup lang="ts">
import { onUnmounted, reactive, ref, watch } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useChangePasswordDialog } from '../../composables/useChangePasswordDialog';
import { useAuthStore } from '../../features/auth/store';
import {
  changePassword,
  logout,
  sendEmailCode,
  type HumanCaptchaPayload,
} from '../../services/auth/authService';
import { useToast } from '../../composables/toast';
import HumanCaptchaModal from './HumanCaptchaModal.vue';

const { showToast } = useToast();
const authStore = useAuthStore();

const { changePasswordDialogState, resolveChangePasswordDialog } = useChangePasswordDialog();

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const code = ref('');
const loading = ref(false);
const codeLoading = ref(false);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// 密码可见性状态
const pwdVisible = reactive<Record<string, boolean>>({});

// 密码聚焦状态：小眼睛仅在"聚焦且有内容"时显示，失焦消失（可反复重现）
const pwdFocused = reactive<Record<string, boolean>>({});

// 人机验证
const captchaOpen = ref(false);
const captchaTitle = ref('');
const captchaDescription = ref('');
let captchaResolver: ((payload: HumanCaptchaPayload | null) => void) | null = null;

watch(
  () => changePasswordDialogState.value.visible,
  (visible) => {
    if (visible) {
      oldPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
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

function cancel() {
  resolveChangePasswordDialog(false);
}

async function handleSendCode() {
  const email = authStore.user?.email;
  if (!email) {
    showToast('未获取到注册邮箱，请重新登录', 'error');
    return;
  }
  const captchaPayload = await requestHumanCaptcha(
    '发送修改密码验证码前验证',
    '完成验证后将向当前账号的注册邮箱发送修改密码验证码。',
  );
  if (!captchaPayload) return;
  codeLoading.value = true;
  try {
    const result = await sendEmailCode(email, 'change_password', captchaPayload);
    showToast(result.message || '验证码已发送到注册邮箱', 'success');
    startCountdown();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '验证码发送失败', 'error');
  } finally {
    codeLoading.value = false;
  }
}

async function submit() {
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) {
    showToast('请填写完整的密码信息', 'error');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    showToast('两次新密码不一致', 'error');
    return;
  }
  if (!code.value.trim()) {
    showToast('请输入邮箱验证码', 'error');
    return;
  }
  loading.value = true;
  try {
    await changePassword(oldPassword.value, newPassword.value, code.value.trim());
    await logout();
    authStore.reset();
    showToast('密码已修改，请重新登录', 'success');
    resolveChangePasswordDialog(true);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '修改密码失败', 'error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <transition name="change-pwd-modal" appear>
      <div
        v-if="changePasswordDialogState.visible"
        class="change-pwd-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
      >
        <div class="change-pwd-card">
          <h3 class="change-pwd-title">修改密码</h3>
          <p class="change-pwd-desc">修改成功后需要重新登录，验证码将发送到注册邮箱：{{ authStore.user?.email || '未知邮箱' }}</p>

          <div class="change-pwd-form">
            <label class="change-pwd-field">
              <span class="change-pwd-label">当前密码</span>
              <div class="relative" @focusin="pwdFocused.oldPassword = true" @focusout="pwdFocused.oldPassword = false; pwdVisible.oldPassword = false">
                <input
                  v-model="oldPassword"
                  :type="pwdVisible.oldPassword ? 'text' : 'password'"
                  placeholder="输入当前密码"
                  autocomplete="current-password"
                  class="change-pwd-input pr-9"
                />
                <button
                  type="button"
                  v-show="pwdFocused.oldPassword && oldPassword.length > 0"
                  class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.oldPassword ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.oldPassword = !pwdVisible.oldPassword"
                >
                  <EyeOff v-if="pwdVisible.oldPassword" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
            </label>
            <label class="change-pwd-field">
              <span class="change-pwd-label">新密码</span>
              <div class="relative" @focusin="pwdFocused.newPassword = true" @focusout="pwdFocused.newPassword = false; pwdVisible.newPassword = false">
                <input
                  v-model="newPassword"
                  :type="pwdVisible.newPassword ? 'text' : 'password'"
                  placeholder="输入新密码"
                  autocomplete="new-password"
                  class="change-pwd-input pr-9"
                />
                <button
                  type="button"
                  v-show="pwdFocused.newPassword && newPassword.length > 0"
                  class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.newPassword ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.newPassword = !pwdVisible.newPassword"
                >
                  <EyeOff v-if="pwdVisible.newPassword" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
            </label>
            <label class="change-pwd-field">
              <span class="change-pwd-label">确认新密码</span>
              <div class="relative" @focusin="pwdFocused.confirmPassword = true" @focusout="pwdFocused.confirmPassword = false; pwdVisible.confirmPassword = false">
                <input
                  v-model="confirmPassword"
                  :type="pwdVisible.confirmPassword ? 'text' : 'password'"
                  placeholder="再次输入新密码"
                  autocomplete="new-password"
                  class="change-pwd-input pr-9"
                />
                <button
                  type="button"
                  v-show="pwdFocused.confirmPassword && confirmPassword.length > 0"
                  class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.confirmPassword ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.confirmPassword = !pwdVisible.confirmPassword"
                >
                  <EyeOff v-if="pwdVisible.confirmPassword" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
            </label>
            <div class="change-pwd-code-row">
              <label class="change-pwd-field change-pwd-code-field">
                <span class="change-pwd-label">邮箱验证码</span>
                <input
                  v-model="code"
                  type="text"
                  placeholder="输入验证码"
                  autocomplete="one-time-code"
                  class="change-pwd-input"
                />
              </label>
              <button
                type="button"
                class="change-pwd-code-btn"
                :disabled="codeLoading || loading || countdown > 0"
                @click="handleSendCode"
              >
                {{ codeLoading ? '发送中…' : countdown > 0 ? `重新发送 (${countdown}s)` : '发送验证码' }}
              </button>
            </div>
          </div>

          <div class="change-pwd-actions">
            <button type="button" class="change-pwd-btn change-pwd-btn--ghost" :disabled="loading" @click="cancel">
              取消
            </button>
            <button type="button" class="change-pwd-btn change-pwd-btn--primary" :disabled="loading" @click="submit">
              {{ loading ? '提交中…' : '确认修改' }}
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
  </Teleport>
</template>

<style scoped>
.change-pwd-overlay {
  transition: opacity 0.2s ease;
}

.change-pwd-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.change-pwd-modal-enter-active {
  transition: opacity 0.2s ease;
}

.change-pwd-modal-enter-active .change-pwd-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.change-pwd-modal-enter-from {
  opacity: 0;
}

.change-pwd-modal-enter-from .change-pwd-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.change-pwd-modal-leave-active {
  transition: opacity 0.2s ease;
}

.change-pwd-modal-leave-active .change-pwd-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.change-pwd-modal-leave-to {
  opacity: 0;
}

.change-pwd-modal-leave-to .change-pwd-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
.change-pwd-card {
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

.change-pwd-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
}

.change-pwd-desc {
  font-size: 0.82rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 16px;
}

.change-pwd-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.change-pwd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.change-pwd-label {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.9);
}

.change-pwd-input {
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

.change-pwd-input::placeholder {
  color: rgba(107, 114, 128, 0.55);
}

.change-pwd-input:focus {
  border-color: #ec4141;
  background: rgba(255, 255, 255, 0.9);
}

.change-pwd-code-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.change-pwd-code-field {
  flex: 1;
  min-width: 0;
}

.change-pwd-code-btn {
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

.change-pwd-code-btn:hover {
  background: #ec4141;
  color: #ffffff;
}

.change-pwd-code-btn:active {
  transform: scale(0.97);
}

.change-pwd-code-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.change-pwd-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.change-pwd-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.change-pwd-btn:active {
  transform: scale(0.97);
}

.change-pwd-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.change-pwd-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.change-pwd-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.change-pwd-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

.change-pwd-btn--primary:hover {
  background: #d13b3b;
}

html.dark .change-pwd-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.2);
}

html.dark .change-pwd-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .change-pwd-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .change-pwd-label {
  color: rgba(255, 255, 255, 0.5);
}

html.dark .change-pwd-input {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .change-pwd-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

html.dark .change-pwd-input:focus {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .change-pwd-code-btn {
  border-color: rgba(255, 120, 120, 0.35);
  background: rgba(236, 65, 65, 0.12);
  color: #ff8b8b;
}

html.dark .change-pwd-code-btn:hover {
  background: #ec4141;
  color: #ffffff;
}

html.dark .change-pwd-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .change-pwd-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .change-pwd-actions {
  background: rgba(255, 255, 255, 0.05);
}
</style>
