<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Eye, EyeOff } from 'lucide-vue-next';

import { useAuthStore } from '../features/auth/store';
import HumanCaptchaModal from '../components/common/HumanCaptchaModal.vue';
import AuthShell from '../components/auth/AuthShell.vue';
import LoginForm from '../components/auth/LoginForm.vue';
import RegisterForm from '../components/auth/RegisterForm.vue';
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm.vue';
import AuthProfileHeader from '../components/auth/AuthProfileHeader.vue';
import { useAuthForm } from '../composables/auth/useAuthForm';
import { useAuthCaptcha } from '../composables/auth/useAuthCaptcha';
import { useAuthAgreement } from '../composables/auth/useAuthAgreement';
import { useAuthFlow } from '../composables/auth/useAuthFlow';
import { useAuthProfile } from '../composables/auth/useAuthProfile';
import { useUiStore } from '../shared/stores/ui';
import type { AuthMode, ProfileStats } from '../services/auth/authService';

// 账号页骨架：负责模式切换、区块编排与弹窗层；表单/流程/资料逻辑已拆分至 composables/auth 与 components/auth
const router = useRouter();
const authStore = useAuthStore();
const uiStore = useUiStore();

const mode = ref<AuthMode>('login');
const loginMethod = ref<'password' | 'email' | 'qr'>('password');

const {
  form,
  forgotForm,
  fieldErrors,
  pwdVisible,
  pwdFocused,
  validateField,
  clearFieldError,
  onPasswordInput,
} = useAuthForm({ mode, loginMethod });

const {
  captchaModalOpen,
  captchaModalTitle,
  captchaModalDescription,
  requestHumanCaptcha,
  handleCaptchaVerified,
  handleCaptchaCancel,
} = useAuthCaptcha();

const {
  agreementAccepted,
  termsModalOpen,
  termsScrolledToEnd,
  termsBodyRef,
  agreementTitle,
  agreementContent,
  loadUserAgreement,
  openTermsModal,
  closeTermsModal,
  refreshTermsScrollState,
  handleAgreementCheckboxChange,
  acceptTerms,
} = useAuthAgreement();

const stats = ref<ProfileStats | null>(null);
const nicknameDraft = ref('');
const avatarDraft = ref('');

const {
  message,
  messageTone,
  loading,
  codeLoading,
  codeCountdown,
  showMessage,
  onSubmit,
  handleSendCode,
  switchMode,
  enterForgot,
  qrStatus,
  qrImage,
  qrError,
  startQrLogin,
} = useAuthFlow({
  mode,
  loginMethod,
  form,
  forgotForm,
  fieldErrors,
  validateField,
  requestHumanCaptcha,
  agreementAccepted,
  stats,
  nicknameDraft,
  avatarDraft,
});

const {
  avatarUploading,
  avatarStatus,
  nicknameStatus,
  avatarMenuPos,
  avatarBtnRef,
  avatarMenuOpen,
  avatarPreviewOpen,
  avatarInputRef,
  showNicknameModal,
  nicknameInputRef,
  profileSaving,
  refreshingAvatarStatus,
  showLogoutConfirm,
  showCiyuanxiModal,
  ciyuanxiForm,
  ciyuanxiLoading,
  showBindEmailModal,
  bindEmailForm,
  bindEmailLoading,
  bindCodeLoading,
  bindCodeCountdown,
  displayStats,
  openAvatarMenu,
  openNicknameEditModal,
  submitNicknameEdit,
  cancelNicknameEdit,
  onNicknameBlur,
  handleAvatarFileChange,
  refreshAvatarStatus,
  openAvatarPicker,
  saveAvatarToLocal,
  handleLogout,
  confirmLogout,
  openCiyuanxiModal,
  submitCiyuanxi,
  openBindEmailModal,
  sendBindCode,
  submitBindEmail,
  loadLoggedInProfile,
  startPolling,
} = useAuthProfile({
  mode,
  loginMethod,
  loading,
  message,
  showMessage,
  stats,
  nicknameDraft,
  avatarDraft,
  requestHumanCaptcha,
});

const title = computed(() =>
  mode.value === 'login' ? '欢迎回来' : mode.value === 'register' ? '创建你的账号' : '找回密码',
);
const subtitle = computed(() =>
  mode.value === 'login'
    ? '登录后可同步个人资料到云端服务器。'
    : mode.value === 'register'
      ? '注册需要邮箱验证码，之后即可登录使用。'
      : '通过注册邮箱验证码重置你的登录密码。',
);
const headerLabel = computed(() =>
  mode.value === 'login' ? '登录账号' : mode.value === 'register' ? '注册账号' : '找回密码',
);

// 头像按钮与文件选择框位于 AuthProfileHeader 内部，这里把模板引用同步给 useAuthProfile
const profileHeaderRef = ref<InstanceType<typeof AuthProfileHeader> | null>(null);
watch(profileHeaderRef, (instance) => {
  avatarBtnRef.value = instance?.avatarBtnRef ?? null;
  avatarInputRef.value = instance?.avatarInputRef ?? null;
}, { flush: 'post' });

function navigateShortcut(to: string) {
  void router.push(to);
}

onMounted(async () => {
  uiStore.showPlayerDetail = false;
  void loadUserAgreement();
  if (!authStore.initialized) {
    await authStore.restoreSession();
  }
  if (!authStore.isLoggedIn) {
    return;
  }
  await loadLoggedInProfile();
  startPolling();
});
</script>

<template>
  <div class="auth-page h-full w-full overflow-y-auto custom-scrollbar text-gray-800 dark:text-gray-200">
    <div class="px-[clamp(1rem,1.5vw,1.75rem)] pt-[clamp(1rem,1.5vw,1.75rem)] pb-[clamp(2rem,4vw,4rem)] max-w-6xl mx-auto">

      <AuthShell
        v-if="!authStore.isLoggedIn"
        :mode="mode"
        :header-label="headerLabel"
        :title="title"
        :subtitle="subtitle"
        :message="message"
        :message-tone="messageTone"
        @switch-mode="switchMode"
      >
        <form
          v-if="mode === 'forgot'"
          key="forgot"
          class="pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-8 grid gap-7 max-w-2xl"
          @submit.prevent="onSubmit"
        >
          <ForgotPasswordForm
            :forgot-form="forgotForm"
            :pwd-visible="pwdVisible"
            :pwd-focused="pwdFocused"
            :loading="loading"
            :code-loading="codeLoading"
            :code-countdown="codeCountdown"
            @send-code="handleSendCode"
            @switch-mode="switchMode"
          />
        </form>
        <form
          v-else
          :key="mode"
          class="pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-8 grid gap-7 max-w-2xl"
          @submit.prevent="onSubmit"
        >
          <LoginForm
            v-if="mode === 'login'"
            :mode="mode"
            :login-method="loginMethod"
            :form="form"
            :field-errors="fieldErrors"
            :pwd-visible="pwdVisible"
            :pwd-focused="pwdFocused"
            :loading="loading"
            :code-loading="codeLoading"
            :code-countdown="codeCountdown"
            :agreement-accepted="agreementAccepted"
            :qr-image="qrImage"
            :qr-status="qrStatus"
            :qr-error="qrError"
            @switch-method="loginMethod = $event"
            @qr-refresh="startQrLogin"
            @validate="validateField"
            @clear-error="clearFieldError"
            @password-input="onPasswordInput"
            @send-code="handleSendCode"
            @agreement-change="handleAgreementCheckboxChange"
            @open-terms="openTermsModal"
            @switch-mode="switchMode"
            @enter-forgot="enterForgot"
          />
          <RegisterForm
            v-else
            :mode="mode"
            :login-method="loginMethod"
            :form="form"
            :field-errors="fieldErrors"
            :pwd-visible="pwdVisible"
            :pwd-focused="pwdFocused"
            :loading="loading"
            :code-loading="codeLoading"
            :code-countdown="codeCountdown"
            :agreement-accepted="agreementAccepted"
            @validate="validateField"
            @clear-error="clearFieldError"
            @password-input="onPasswordInput"
            @send-code="handleSendCode"
            @agreement-change="handleAgreementCheckboxChange"
            @open-terms="openTermsModal"
            @switch-mode="switchMode"
          />
        </form>
      </AuthShell>

      <div v-else class="space-y-[clamp(1rem,1.8vw,1.5rem)]">
        <AuthProfileHeader
          ref="profileHeaderRef"
          :user="authStore.user"
          :avatar-draft="avatarDraft"
          :avatar-status="avatarStatus"
          :nickname-status="nicknameStatus"
          :avatar-uploading="avatarUploading"
          :refreshing-avatar-status="refreshingAvatarStatus"
          :loading="loading"
          :display-stats="displayStats"
          @open-avatar-menu="openAvatarMenu"
          @avatar-file-change="handleAvatarFileChange"
          @refresh-status="refreshAvatarStatus"
          @edit-nickname="openNicknameEditModal"
          @open-ciyuanxi="openCiyuanxiModal"
          @open-bind-email="openBindEmailModal"
          @logout="handleLogout"
          @navigate-shortcut="navigateShortcut"
        />

        <Teleport to="body">
          <Transition name="avatar-modal">
            <div
              v-if="avatarMenuOpen"
              class="fixed inset-0 z-[200]"
              @click.self="avatarMenuOpen = false"
            >
              <div
                v-if="avatarMenuPos"
                class="avatar-menu-card fixed"
                :style="{ top: avatarMenuPos.top + 'px', left: avatarMenuPos.left + 'px' }"
              >
                <div class="avatar-menu-body">
                  <button type="button" class="avatar-menu-item" @click="openAvatarPicker">
                    <span class="avatar-menu-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </span>
                    <span class="avatar-menu-text">
                      <strong>更换头像</strong>
                      <small>从本地选择图片上传</small>
                    </span>
                  </button>
                  <button type="button" class="avatar-menu-item" @click="avatarMenuOpen = false; avatarPreviewOpen = true">
                    <span class="avatar-menu-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </span>
                    <span class="avatar-menu-text">
                      <strong>放大查看</strong>
                      <small>查看当前头像大图</small>
                    </span>
                  </button>
                  <button type="button" class="avatar-menu-item" @click="saveAvatarToLocal">
                    <span class="avatar-menu-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </span>
                    <span class="avatar-menu-text">
                      <strong>保存到本地</strong>
                      <small>下载当前头像到电脑</small>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </Transition>

          <Transition name="avatar-preview">
            <div
              v-if="avatarPreviewOpen"
              class="fixed inset-0 z-[201] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
              @click="avatarPreviewOpen = false"
            >
              <div class="relative max-w-full max-h-full">
                <div class="w-[min(80vw,70vh)] h-[min(80vw,70vh)] rounded-full overflow-hidden ring-4 ring-white/10 shadow-2xl">
                  <img
                    v-if="avatarDraft || authStore.user?.avatar"
                    :src="avatarDraft || authStore.user?.avatar || ''"
                    alt="头像"
                    class="h-full w-full object-cover"
                  />
                  <div
                    v-else
                    class="h-full w-full grid place-items-center bg-white/10 text-white text-[20vh] font-black"
                  >
                    {{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}
                  </div>
                </div>
                <button
                  type="button"
                  class="absolute -top-2 -right-2 grid h-9 w-9 place-items-center rounded-full bg-white text-black hover:bg-white/90 transition shadow-lg cursor-pointer"
                  @click="avatarPreviewOpen = false"
                  aria-label="关闭"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </Transition>
        </Teleport>
      </div>

    </div>

    <Teleport to="body">
      <Transition name="avatar-modal">
        <div
          v-if="showLogoutConfirm"
          class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          @click.self="showLogoutConfirm = false"
        >
          <div class="logout-confirm-card">
            <div class="logout-confirm-icon">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <h3 class="logout-confirm-title">退出登录</h3>
            <p class="logout-confirm-desc">确认要退出当前账号吗？退出后需重新登录才能同步云端数据。</p>
            <div class="logout-confirm-actions">
              <button
                type="button"
                class="logout-btn logout-btn--ghost"
                @click="showLogoutConfirm = false"
              >
                取消
              </button>
              <button
                type="button"
                class="logout-btn logout-btn--danger"
                @click="confirmLogout"
              >
                确认退出
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="avatar-modal">
        <div
          v-if="showCiyuanxiModal"
          class="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          @click.self="showCiyuanxiModal = false"
        >
          <div class="logout-confirm-card">
            <h3 class="logout-confirm-title">修改弦予号</h3>
            <p class="logout-confirm-desc">弦予号是登录账号的唯一标识（参考微信号），每月仅可修改一次，请谨慎设置。</p>
            <div class="flex flex-col gap-3 mt-4">
              <label class="flex flex-col gap-1.5">
                <span class="text-xs text-gray-500 dark:text-white/50">新弦予号</span>
                <input
                  v-model="ciyuanxiForm.newId"
                  type="text"
                  placeholder="6-20 位，支持纯数字、纯字母或组合"
                  spellcheck="false"
                  class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-xs text-gray-500 dark:text-white/50">登录密码</span>
                <div class="relative" @focusin="pwdFocused.ciyuanxiPassword = true" @focusout="pwdFocused.ciyuanxiPassword = false; pwdVisible.ciyuanxiPassword = false">
                  <input
                    v-model="ciyuanxiForm.password"
                    :type="pwdVisible.ciyuanxiPassword ? 'text' : 'password'"
                    placeholder="请输入当前登录密码"
                    autocomplete="current-password"
                    class="w-full h-8 rounded-lg border border-black/10 bg-white/45 pl-3 pr-9 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                  />
                  <button
                    type="button"
                    v-show="pwdFocused.ciyuanxiPassword && ciyuanxiForm.password.length > 0"
                    class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 dark:text-white/35 hover:text-[#EC4141] transition cursor-pointer"
                    :aria-label="pwdVisible.ciyuanxiPassword ? '隐藏密码' : '查看密码'"
                    @mousedown.prevent
                    @click="pwdVisible.ciyuanxiPassword = !pwdVisible.ciyuanxiPassword"
                  >
                    <EyeOff v-if="pwdVisible.ciyuanxiPassword" class="h-4 w-4" />
                    <Eye v-else class="h-4 w-4" />
                  </button>
                </div>
              </label>
            </div>
            <div class="logout-confirm-actions mt-5">
              <button
                type="button"
                class="logout-btn logout-btn--ghost"
                :disabled="ciyuanxiLoading"
                @click="showCiyuanxiModal = false"
              >
                取消
              </button>
              <button
                type="button"
                class="logout-btn logout-btn--danger"
                :disabled="ciyuanxiLoading"
                @click="submitCiyuanxi"
              >
                {{ ciyuanxiLoading ? '提交中…' : '确认修改' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="avatar-modal">
        <div
          v-if="showBindEmailModal"
          class="fixed inset-0 z-[211] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          @click.self="showBindEmailModal = false"
        >
          <div class="logout-confirm-card">
            <h3 class="logout-confirm-title">绑定邮箱</h3>
            <p class="logout-confirm-desc">绑定邮箱后可用于登录与找回密码，请填写常用且可接收邮件的地址。</p>
            <div class="flex flex-col gap-3 mt-4">
              <label class="flex flex-col gap-1.5">
                <span class="text-xs text-gray-500 dark:text-white/50">邮箱</span>
                <input
                  v-model="bindEmailForm.email"
                  type="email"
                  placeholder="请输入邮箱"
                  spellcheck="false"
                  class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-xs text-gray-500 dark:text-white/50">邮箱验证码</span>
                <div class="flex gap-2">
                  <input
                    v-model="bindEmailForm.code"
                    type="text"
                    placeholder="请输入验证码"
                    spellcheck="false"
                    class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                  />
                  <button
                    type="button"
                    class="shrink-0 h-8 px-3 rounded-lg border border-[#EC4141]/30 text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="bindCodeLoading || bindCodeCountdown > 0"
                    @click="sendBindCode"
                  >
                    {{ bindCodeLoading ? '发送中…' : bindCodeCountdown > 0 ? `重新发送 (${bindCodeCountdown}s)` : '发送验证码' }}
                  </button>
                </div>
              </label>
            </div>
            <div class="logout-confirm-actions mt-5">
              <button
                type="button"
                class="logout-btn logout-btn--ghost"
                :disabled="bindEmailLoading"
                @click="showBindEmailModal = false"
              >
                取消
              </button>
              <button
                type="button"
                class="logout-btn logout-btn--danger"
                :disabled="bindEmailLoading"
                @click="submitBindEmail"
              >
                {{ bindEmailLoading ? '提交中…' : '确认绑定' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="avatar-modal">
        <div
          v-if="showNicknameModal"
          class="fixed inset-0 z-[212] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          @click.self="cancelNicknameEdit"
        >
          <div class="logout-confirm-card">
            <h3 class="logout-confirm-title">修改昵称</h3>
            <p class="logout-confirm-desc">昵称修改后需管理员审核，审核通过后才会正式生效。</p>
            <div class="flex flex-col gap-3 mt-4">
              <label class="flex flex-col gap-1.5">
                <span class="text-xs text-gray-500 dark:text-white/50">新昵称</span>
                <input
                  ref="nicknameInputRef"
                  v-model="nicknameDraft"
                  type="text"
                  placeholder="最多 20 个字符，支持字母、数字、汉字"
                  maxlength="64"
                  spellcheck="false"
                  class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                  @blur="onNicknameBlur"
                  @keydown.enter.prevent="submitNicknameEdit"
                  @keydown.esc.prevent="cancelNicknameEdit"
                />
              </label>
            </div>
            <div class="logout-confirm-actions mt-5">
              <button
                type="button"
                class="logout-btn logout-btn--ghost"
                :disabled="profileSaving"
                @click="cancelNicknameEdit"
              >
                取消
              </button>
              <button
                type="button"
                class="logout-btn logout-btn--danger"
                :disabled="profileSaving"
                @click="submitNicknameEdit"
              >
                {{ profileSaving ? '提交中…' : '确认修改' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="avatar-modal">
        <div
          v-if="termsModalOpen"
          class="fixed inset-0 z-[202] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm"
          @click.self="closeTermsModal"
        >
          <div class="terms-card">
            <div class="terms-header">
              <div>
                <p>弦予音乐账号系统</p>
                <h3>{{ agreementTitle }}</h3>
              </div>
              <button type="button" class="terms-close" aria-label="关闭" @click="closeTermsModal">×</button>
            </div>
            <div
              ref="termsBodyRef"
              class="terms-body custom-scrollbar"
              @scroll="refreshTermsScrollState"
            >
              <div class="terms-content">{{ agreementContent }}</div>
            </div>
            <div v-if="!termsScrolledToEnd" class="terms-scroll-tip">请先滚动阅读至协议底部后再同意</div>
            <div class="terms-actions">
              <button type="button" class="logout-btn logout-btn--ghost" @click="closeTermsModal">关闭</button>
              <button
                type="button"
                class="logout-btn logout-btn--danger"
                :disabled="!termsScrolledToEnd"
                @click="acceptTerms"
              >
                {{ termsScrolledToEnd ? '已阅读并同意' : '请先读完协议' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <HumanCaptchaModal
      :open="captchaModalOpen"
      :title="captchaModalTitle"
      :description="captchaModalDescription"
      @verified="handleCaptchaVerified"
      @cancel="handleCaptchaCancel"
    />
  </div>
</template>

<style scoped>
.logout-confirm-card {
  width: min(86vw, 360px);
  background: #ffffff;
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.logout-confirm-icon {
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

.logout-confirm-icon--success {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.logout-confirm-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}

.logout-confirm-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0 0 20px;
}

.logout-confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.logout-confirm-actions--single {
  display: grid;
  grid-template-columns: 1fr;
}

.logout-btn {
  flex: 1;
  height: 38px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
  border: 1px solid transparent;
}

.logout-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.logout-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31 41 55);
}

.logout-btn--danger {
  background: #EC4141;
  color: #ffffff;
}

.logout-btn--danger:hover {
  background: #d13b3b;
}

.logout-btn--success {
  background: #16a34a;
  color: #ffffff;
}

.logout-btn--success:hover {
  background: #15803d;
}

.logout-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.logout-btn--danger:disabled,
.logout-btn--danger:disabled:hover {
  background: rgba(236, 65, 65, 0.45);
}

.terms-card {
  width: min(92vw, 680px);
  max-height: min(86vh, 760px);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: #1f2937;
  border-radius: 18px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.22), 0 6px 20px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.terms-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.terms-header p {
  margin: 0 0 4px;
  color: rgba(236, 65, 65, 0.9);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
}

.terms-header h3 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
}

.terms-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.05);
  color: rgba(31, 41, 55, 0.75);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.terms-close:hover {
  background: rgba(236, 65, 65, 0.1);
  color: #EC4141;
}

.terms-body {
  flex: 1;
  padding: 4px 22px 18px;
  overflow-y: auto;
  min-height: 220px;
}

.terms-content {
  white-space: pre-wrap;
  color: rgba(75, 85, 99, 0.92);
  font-size: 0.9rem;
  line-height: 1.8;
  padding: 14px 0 4px;
}

.terms-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.terms-scroll-tip {
  padding: 10px 22px 0;
  color: #EC4141;
  font-size: 0.78rem;
  text-align: right;
}

.avatar-modal-enter-active .logout-confirm-card,
.avatar-modal-leave-active .logout-confirm-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.avatar-modal-enter-from .logout-confirm-card,
.avatar-modal-leave-to .logout-confirm-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

:global(.dark) .logout-confirm-card {
  background: #262626;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .logout-confirm-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

:global(.dark) .logout-confirm-icon--success {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}

:global(.dark) .logout-confirm-title {
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .logout-confirm-desc {
  color: rgba(255, 255, 255, 0.6);
}

:global(.dark) .logout-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

:global(.dark) .logout-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .terms-card {
  background: #262626;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .terms-header,
:global(.dark) .terms-actions {
  border-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .terms-close {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.72);
}

:global(.dark) .terms-content {
  color: rgba(255, 255, 255, 0.68);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}

.auth-mode-enter-active,
.auth-mode-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease, filter 0.25s ease;
}

.auth-mode-enter-from {
  opacity: 0;
  transform: translateY(8px);
  filter: blur(4px);
}

.auth-mode-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  filter: blur(4px);
}

@media (prefers-reduced-motion: reduce) {
  .auth-mode-enter-active,
  .auth-mode-leave-active {
    transition: opacity 0.15s ease;
  }

  .auth-mode-enter-from,
  .auth-mode-leave-to {
    transform: none;
    filter: none;
  }
}

.avatar-menu-card {
  width: min(86vw, 320px);
  background: #ffffff;
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

:global(.dark) .avatar-menu-card {
  background: #262626;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

.avatar-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  font-size: 0.9rem;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

:global(.dark) .avatar-menu-header {
  border-color: rgba(255, 255, 255, 0.08);
}

.avatar-menu-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.2s, background 0.2s;
}

.avatar-menu-close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.06);
}

:global(.dark) .avatar-menu-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.avatar-menu-body {
  padding: 6px;
  display: grid;
  gap: 2px;
}

.avatar-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s;
  font: inherit;
}

.avatar-menu-item:hover {
  background: rgba(236, 65, 65, 0.08);
}

.avatar-menu-item:active {
  background: rgba(236, 65, 65, 0.14);
}

.avatar-menu-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(236, 65, 65, 0.1);
  color: #EC4141;
  flex-shrink: 0;
}

.avatar-menu-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.avatar-menu-text strong {
  font-size: 0.875rem;
  font-weight: 600;
}

.avatar-menu-text small {
  font-size: 0.7rem;
  opacity: 0.6;
  line-height: 1.3;
}

.avatar-modal-enter-active,
.avatar-modal-leave-active {
  transition: opacity 0.2s ease;
}

.avatar-menu-card {
  transform-origin: top left;
}

.avatar-modal-enter-active .avatar-menu-card,
.avatar-modal-leave-active .avatar-menu-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.avatar-modal-enter-from,
.avatar-modal-leave-to {
  opacity: 0;
}

.avatar-modal-enter-from .avatar-menu-card,
.avatar-modal-leave-to .avatar-menu-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.avatar-preview-enter-active,
.avatar-preview-leave-active {
  transition: opacity 0.25s ease;
}

.avatar-preview-enter-active > div,
.avatar-preview-leave-active > div {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;
}

.avatar-preview-enter-from,
.avatar-preview-leave-to {
  opacity: 0;
}

.avatar-preview-enter-from > div,
.avatar-preview-leave-to > div {
  opacity: 0;
  transform: scale(0.7);
}
</style>

<style>
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
    filter: blur(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

.animate-fade-in-up {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .animate-fade-in-up {
    animation: none;
    opacity: 1;
    transform: none;
    filter: none;
  }
}
</style>
