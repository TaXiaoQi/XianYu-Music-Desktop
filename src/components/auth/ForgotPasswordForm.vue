<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next';

import type { AuthMode } from '../../services/auth/authService';
import type { ForgotFormState } from '../../composables/auth/useAuthForm';

// 找回密码表单内容（自 src/views/Auth.vue 拆出，样式保持原样）
defineProps<{
  forgotForm: ForgotFormState;
  pwdVisible: Record<string, boolean>;
  pwdFocused: Record<string, boolean>;
  loading: boolean;
  codeLoading: boolean;
  codeCountdown: number;
}>();

const emit = defineEmits<{
  (e: 'send-code'): void;
  (e: 'switch-mode', next: AuthMode): void;
}>();
</script>

<template>
  <label class="grid gap-3">
    <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">注册邮箱</span>
    <input
      v-model="forgotForm.email"
      type="email"
      placeholder="name@example.com"
      autocomplete="email"
      required
      class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
    />
  </label>
  <div class="grid grid-cols-[1fr_auto] items-end gap-4">
    <label class="grid gap-3">
      <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">邮箱验证码</span>
      <input
        v-model="forgotForm.code"
        type="text"
        placeholder="填写验证码"
        autocomplete="one-time-code"
        required
        class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
      />
    </label>
    <button
      type="button"
      class="h-14 px-6 whitespace-nowrap text-base font-medium text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="codeLoading || codeCountdown > 0"
      @click="emit('send-code')"
    >
      {{ codeLoading ? '发送中…' : codeCountdown > 0 ? `重新发送 (${codeCountdown}s)` : '发送验证码' }}
    </button>
  </div>
  <label class="grid gap-3">
    <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">新密码</span>
    <div class="relative" @focusin="pwdFocused.newPassword = true" @focusout="pwdFocused.newPassword = false; pwdVisible.newPassword = false">
      <input
        v-model="forgotForm.newPassword"
        :type="pwdVisible.newPassword ? 'text' : 'password'"
        placeholder="至少 6 位"
        autocomplete="new-password"
        required
        class="h-[clamp(2.75rem,4vw,3.5rem)] w-full bg-transparent border-b border-black/15 dark:border-white/15 pl-1 pr-10 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
      />
      <button
        type="button"
        v-show="pwdFocused.newPassword && forgotForm.newPassword.length > 0"
        class="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
        :aria-label="pwdVisible.newPassword ? '隐藏密码' : '查看密码'"
        @mousedown.prevent
        @click="pwdVisible.newPassword = !pwdVisible.newPassword"
      >
        <EyeOff v-if="pwdVisible.newPassword" class="h-5 w-5" />
        <Eye v-else class="h-5 w-5" />
      </button>
    </div>
  </label>
  <label class="grid gap-3">
    <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">确认新密码</span>
    <div class="relative" @focusin="pwdFocused.confirmNewPassword = true" @focusout="pwdFocused.confirmNewPassword = false; pwdVisible.confirmNewPassword = false">
      <input
        v-model="forgotForm.confirmPassword"
        :type="pwdVisible.confirmNewPassword ? 'text' : 'password'"
        placeholder="再次输入新密码"
        autocomplete="new-password"
        required
        class="h-[clamp(2.75rem,4vw,3.5rem)] w-full bg-transparent border-b border-black/15 dark:border-white/15 pl-1 pr-10 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
      />
      <button
        type="button"
        v-show="pwdFocused.confirmNewPassword && forgotForm.confirmPassword.length > 0"
        class="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
        :aria-label="pwdVisible.confirmNewPassword ? '隐藏密码' : '查看密码'"
        @mousedown.prevent
        @click="pwdVisible.confirmNewPassword = !pwdVisible.confirmNewPassword"
      >
        <EyeOff v-if="pwdVisible.confirmNewPassword" class="h-5 w-5" />
        <Eye v-else class="h-5 w-5" />
      </button>
    </div>
  </label>
  <div class="pt-4 flex items-center gap-5 flex-wrap">
    <button
      type="submit"
      class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-6 py-2 rounded-full text-sm font-medium transition flex items-center gap-1 active:scale-95 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
      :disabled="loading"
    >
      {{ loading ? '提交中…' : '重置密码' }}
    </button>
    <button
      type="button"
      class="text-black/60 dark:text-white/60 hover:text-[#EC4141] text-base font-medium transition cursor-pointer"
      @click="emit('switch-mode', 'login')"
    >
      返回登录
    </button>
  </div>
</template>
