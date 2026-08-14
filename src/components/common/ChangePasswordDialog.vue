<script setup lang="ts">
import { ref, watch } from 'vue';
import { useChangePasswordDialog } from '../../composables/useChangePasswordDialog';
import { useAuthStore } from '../../features/auth/store';
import { changePassword, logout } from '../../services/auth/authService';
import { useToast } from '../../composables/toast';

const { showToast } = useToast();
const authStore = useAuthStore();

const { changePasswordDialogState, resolveChangePasswordDialog } = useChangePasswordDialog();

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const loading = ref(false);

watch(
  () => changePasswordDialogState.value.visible,
  (visible) => {
    if (visible) {
      oldPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
      loading.value = false;
    }
  },
);

function cancel() {
  resolveChangePasswordDialog(false);
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
  loading.value = true;
  try {
    await changePassword(oldPassword.value, newPassword.value);
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
          <p class="change-pwd-desc">修改成功后需要重新登录，请妥善保管新密码。</p>

          <div class="change-pwd-form">
            <label class="change-pwd-field">
              <span class="change-pwd-label">当前密码</span>
              <input
                v-model="oldPassword"
                type="password"
                placeholder="输入当前密码"
                autocomplete="current-password"
                class="change-pwd-input"
              />
            </label>
            <label class="change-pwd-field">
              <span class="change-pwd-label">新密码</span>
              <input
                v-model="newPassword"
                type="password"
                placeholder="输入新密码"
                autocomplete="new-password"
                class="change-pwd-input"
              />
            </label>
            <label class="change-pwd-field">
              <span class="change-pwd-label">确认新密码</span>
              <input
                v-model="confirmPassword"
                type="password"
                placeholder="再次输入新密码"
                autocomplete="new-password"
                class="change-pwd-input"
              />
            </label>
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
}

.change-pwd-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
  text-align: center;
}

.change-pwd-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 16px;
  text-align: center;
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
