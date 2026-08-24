<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useCiyuanxiDialog } from '../../composables/useCiyuanxiDialog';
import { useAuthStore } from '../../features/auth/store';
import { updateCiyuanxiId } from '../../services/auth/authService';
import { useToast } from '../../composables/toast';

const { showToast } = useToast();
const authStore = useAuthStore();

const { ciyuanxiDialogState, resolveCiyuanxiDialog } = useCiyuanxiDialog();

const newId = ref('');
const password = ref('');
const loading = ref(false);

// 密码可见性状态
const pwdVisible = reactive<Record<string, boolean>>({});

// 密码聚焦状态：小眼睛仅在"聚焦且有内容"时显示，失焦消失（可反复重现）
const pwdFocused = reactive<Record<string, boolean>>({});

watch(
  () => ciyuanxiDialogState.value.visible,
  (visible) => {
    if (visible) {
      newId.value = '';
      password.value = '';
      loading.value = false;
    }
  },
);

function cancel() {
  resolveCiyuanxiDialog(false);
}

async function submit() {
  const oldId = ciyuanxiDialogState.value.oldId.trim();
  const target = newId.value.trim();
  const pwd = password.value;

  if (!oldId) {
    showToast('未获取到当前弦予号，请重新登录', 'error');
    return;
  }
  if (target.length < 6 || target.length > 20) {
    showToast('弦予号需 6-20 位', 'error');
    return;
  }
  if (!/^[a-zA-Z0-9]{6,20}$/.test(target)) {
    showToast('弦予号仅支持纯数字、纯字母或数字字母组合', 'error');
    return;
  }
  if (!pwd) {
    showToast('请输入登录密码', 'error');
    return;
  }

  loading.value = true;
  try {
    if (ciyuanxiDialogState.value.debug) {
      // 调试模式：仅模拟修改流程，不发送服务器
      await new Promise((r) => setTimeout(r, 600));
      showToast('（调试）弦予号修改成功', 'success');
    } else {
      const res = await updateCiyuanxiId(oldId, target, pwd);
      showToast(res.message || '弦予号修改成功', 'success');
      const user = authStore.user;
      if (user) {
        authStore.setUser({ ...user, ciyuanxi_id: res.ciyuanxi_id });
      }
    }
    resolveCiyuanxiDialog(true);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '弦予号修改失败', 'error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <transition name="ciyuanxi-modal" appear>
      <div
        v-if="ciyuanxiDialogState.visible"
        class="ciyuanxi-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
      >
        <div class="ciyuanxi-card">
          <h3 class="ciyuanxi-title">修改弦予号</h3>
          <p class="ciyuanxi-desc">弦予号是登录账号的唯一标识（参考微信号），每月仅可修改一次，请谨慎设置。</p>

          <div class="ciyuanxi-form">
            <label class="ciyuanxi-field">
              <span class="ciyuanxi-label">当前弦予号</span>
              <input
                :value="ciyuanxiDialogState.oldId"
                type="text"
                readonly
                spellcheck="false"
                class="ciyuanxi-input"
              />
            </label>
            <label class="ciyuanxi-field">
              <span class="ciyuanxi-label">新弦予号</span>
              <input
                v-model="newId"
                type="text"
                placeholder="6-20 位，支持纯数字、纯字母或组合"
                spellcheck="false"
                class="ciyuanxi-input"
              />
            </label>
            <label class="ciyuanxi-field">
              <span class="ciyuanxi-label">登录密码</span>
              <div class="relative" @focusin="pwdFocused.password = true" @focusout="pwdFocused.password = false; pwdVisible.password = false">
                <input
                  v-model="password"
                  :type="pwdVisible.password ? 'text' : 'password'"
                  placeholder="请输入当前登录密码"
                  autocomplete="current-password"
                  class="ciyuanxi-input pr-9"
                />
                <button
                  type="button"
                  v-show="pwdFocused.password && password.length > 0"
                  class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.password ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.password = !pwdVisible.password"
                >
                  <EyeOff v-if="pwdVisible.password" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
            </label>
          </div>

          <div class="ciyuanxi-actions">
            <button type="button" class="ciyuanxi-btn ciyuanxi-btn--ghost" :disabled="loading" @click="cancel">
              取消
            </button>
            <button type="button" class="ciyuanxi-btn ciyuanxi-btn--primary" :disabled="loading" @click="submit">
              {{ loading ? '提交中…' : '确认修改' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.ciyuanxi-overlay {
  transition: opacity 0.2s ease;
}

.ciyuanxi-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ciyuanxi-modal-enter-active {
  transition: opacity 0.2s ease;
}

.ciyuanxi-modal-enter-active .ciyuanxi-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ciyuanxi-modal-enter-from {
  opacity: 0;
}

.ciyuanxi-modal-enter-from .ciyuanxi-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.ciyuanxi-modal-leave-active {
  transition: opacity 0.2s ease;
}

.ciyuanxi-modal-leave-active .ciyuanxi-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ciyuanxi-modal-leave-to {
  opacity: 0;
}

.ciyuanxi-modal-leave-to .ciyuanxi-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
.ciyuanxi-card {
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

.ciyuanxi-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
  text-align: center;
}

.ciyuanxi-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 16px;
  text-align: center;
}

.ciyuanxi-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ciyuanxi-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ciyuanxi-label {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.9);
}

.ciyuanxi-input {
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

.ciyuanxi-input::placeholder {
  color: rgba(107, 114, 128, 0.55);
}

.ciyuanxi-input:focus {
  border-color: #ec4141;
  background: rgba(255, 255, 255, 0.9);
}

.ciyuanxi-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.ciyuanxi-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.ciyuanxi-btn:active {
  transform: scale(0.97);
}

.ciyuanxi-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ciyuanxi-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.ciyuanxi-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.ciyuanxi-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

.ciyuanxi-btn--primary:hover {
  background: #d13b3b;
}

html.dark .ciyuanxi-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .ciyuanxi-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .ciyuanxi-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .ciyuanxi-label {
  color: rgba(255, 255, 255, 0.5);
}

html.dark .ciyuanxi-input {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .ciyuanxi-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

html.dark .ciyuanxi-input:focus {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .ciyuanxi-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .ciyuanxi-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .ciyuanxi-actions {
  background: rgba(255, 255, 255, 0.05);
}

html.dark .ciyuanxi-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

html.dark .ciyuanxi-btn--primary:hover {
  background: #d13b3b;
}
</style>