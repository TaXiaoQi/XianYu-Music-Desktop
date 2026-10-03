<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next';

import type { AuthMode } from '../../services/auth/authService';
import QrLoginPanel from './QrLoginPanel.vue';
import type { AuthFormState } from '../../composables/auth/useAuthForm';
import type { LoginMethod } from '../../composables/auth/useAuthFlow';

// 登录表单内容（账号密码 / 邮箱验证码 / 扫码）（自 src/views/Auth.vue 拆出，样式保持原样）
defineProps<{
  mode: AuthMode;
  loginMethod: LoginMethod;
  form: AuthFormState;
  fieldErrors: Record<string, string>;
  pwdVisible: Record<string, boolean>;
  pwdFocused: Record<string, boolean>;
  loading: boolean;
  codeLoading: boolean;
  codeCountdown: number;
  agreementAccepted: boolean;
  qrImage: string;
  qrStatus: 'loading' | 'pending' | 'scanned' | 'expired' | 'error' | 'logged';
  qrError: string;
}>();

const emit = defineEmits<{
  (e: 'switch-method', method: LoginMethod): void;
  (e: 'qr-refresh'): void;
  (e: 'validate', field: string): void;
  (e: 'clear-error', field: string): void;
  (e: 'password-input'): void;
  (e: 'send-code'): void;
  (e: 'agreement-change', event: Event): void;
  (e: 'open-terms'): void;
  (e: 'switch-mode', next: AuthMode): void;
  (e: 'enter-forgot'): void;
}>();
</script>

<template>
  <div v-if="mode === 'login'" class="flex w-fit gap-1 p-1 rounded-full bg-black/5 dark:bg-white/10">
    <button
      type="button"
      class="rounded-full px-5 py-2 text-sm font-medium transition cursor-pointer"
      :class="loginMethod === 'password'
        ? 'bg-[#EC4141] text-white shadow-sm'
        : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
      @click="emit('switch-method', 'password')"
    >
      账号密码登录
    </button>
    <button
      type="button"
      class="rounded-full px-5 py-2 text-sm font-medium transition cursor-pointer"
      :class="loginMethod === 'email'
        ? 'bg-[#EC4141] text-white shadow-sm'
        : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
      @click="emit('switch-method', 'email')"
    >
      邮箱验证码登录
    </button>
    <button
      type="button"
      class="rounded-full px-5 py-2 text-sm font-medium transition cursor-pointer"
      :class="loginMethod === 'qr'
        ? 'bg-[#EC4141] text-white shadow-sm'
        : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
      @click="emit('switch-method', 'qr')"
    >
      扫码登录
    </button>
  </div>

  <QrLoginPanel
    v-if="mode === 'login' && loginMethod === 'qr'"
    key="qr"
    :qr-image="qrImage"
    :qr-status="qrStatus"
    :qr-error="qrError"
    @refresh="emit('qr-refresh')"
  />

  <template v-else>
    <template v-if="mode === 'login' && loginMethod === 'email'">
      <label class="grid gap-3">
        <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">邮箱</span>
        <input
          v-model="form.email"
          type="email"
          placeholder="name@example.com"
          autocomplete="email"
          required
          class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
          :class="fieldErrors.email ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
          @blur="emit('validate', 'email')"
          @input="emit('clear-error', 'email')"
        />
        <span v-if="fieldErrors.email" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.email }}</span>
      </label>

      <div class="grid grid-cols-[1fr_auto] items-end gap-4">
        <label class="grid gap-3">
          <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">邮箱验证码</span>
          <input
            v-model="form.code"
            type="text"
            placeholder="填写验证码"
            autocomplete="one-time-code"
            required
            class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
            :class="fieldErrors.code ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
            @blur="emit('validate', 'code')"
            @input="emit('clear-error', 'code')"
          />
          <span v-if="fieldErrors.code" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.code }}</span>
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
    </template>

    <label v-if="loginMethod !== 'email'" class="grid gap-3">
      <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">{{ mode === 'login' ? '弦予号/邮箱' : '弦予号' }}</span>
      <input
        v-model="form.account"
        type="text"
        :placeholder="mode === 'login' ? '输入弦予号或邮箱登录' : '6-20位，支持纯数字、纯字母或组合'"
        :autocomplete="mode === 'login' ? 'off' : 'username'"
        class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
        :class="fieldErrors.account ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
        @blur="emit('validate', 'account')"
        @input="emit('clear-error', 'account')"
      />
      <span v-if="fieldErrors.account" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.account }}</span>
    </label>

    <label v-if="loginMethod !== 'email'" class="grid gap-3">
      <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">密码</span>
      <div class="relative" @focusin="pwdFocused.password = true" @focusout="pwdFocused.password = false; pwdVisible.password = false">
        <input
          v-model="form.password"
          :type="pwdVisible.password ? 'text' : 'password'"
          placeholder="请输入密码"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          required
          class="h-[clamp(2.75rem,4vw,3.5rem)] w-full bg-transparent border-b pl-1 pr-10 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
          :class="fieldErrors.password ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
          @blur="emit('validate', 'password')"
          @input="emit('password-input')"
        />
        <button
          type="button"
          v-show="pwdFocused.password && form.password.length > 0"
          class="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
          :aria-label="pwdVisible.password ? '隐藏密码' : '查看密码'"
          @mousedown.prevent
          @click="pwdVisible.password = !pwdVisible.password"
        >
          <EyeOff v-if="pwdVisible.password" class="h-5 w-5" />
          <Eye v-else class="h-5 w-5" />
        </button>
      </div>
      <span v-if="fieldErrors.password" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.password }}</span>
    </label>

    <div class="flex items-start gap-3 text-sm text-black/60 dark:text-white/60 select-none">
      <input
        :checked="agreementAccepted"
        type="checkbox"
        class="mt-1 h-4 w-4 accent-[#EC4141] cursor-pointer"
        @change="emit('agreement-change', $event)"
      />
      <span>
        我已阅读并同意
        <button
          type="button"
          class="text-[#EC4141] hover:text-[#d13b3b] underline underline-offset-4 cursor-pointer"
          @click="emit('open-terms')"
        >
          用户协议
        </button>
        ，并知悉账号系统会读取必要的本地数据用于登录、安全风控、同步和统计。
      </span>
    </div>

    <div class="pt-4 flex items-center gap-5 flex-wrap">
      <button
        type="submit"
        class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-6 py-2 rounded-full text-sm font-medium transition flex items-center gap-1 active:scale-95 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        :disabled="loading || !agreementAccepted"
      >
        {{ loading ? '提交中…' : mode === 'login' ? '登录' : '注册' }}
      </button>
      <button
        type="button"
        class="text-black/60 dark:text-white/60 hover:text-[#EC4141] text-base font-medium transition cursor-pointer"
        @click="emit('switch-mode', mode === 'login' ? 'register' : 'login')"
      >
        {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
      </button>
      <button
        v-if="mode === 'login'"
        type="button"
        class="text-black/60 dark:text-white/60 hover:text-[#EC4141] text-base font-medium transition cursor-pointer ml-auto"
        @click="emit('enter-forgot')"
      >
        忘记密码？
      </button>
    </div>
  </template>
</template>
