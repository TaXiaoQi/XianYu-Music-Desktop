// 登录/注册/找回密码表单的字段校验规则与错误提示（自 src/views/Auth.vue 拆出，逻辑保持原样）
import { reactive, ref, watch, type Ref } from 'vue';

import type { AuthMode } from '../../services/auth/authService';

export interface AuthFormState {
  account: string;
  nickname: string;
  email: string;
  password: string;
  confirmPassword: string;
  code: string;
}

export interface ForgotFormState {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UseAuthFormOptions {
  mode: Ref<AuthMode>;
  loginMethod: Ref<'password' | 'email' | 'qr'>;
}

export function useAuthForm({ mode, loginMethod }: UseAuthFormOptions) {
  const form = ref<AuthFormState>({ account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' });
  const forgotForm = ref<ForgotFormState>({ email: '', code: '', newPassword: '', confirmPassword: '' });
  const fieldErrors = ref<Record<string, string>>({});

  const pwdVisible = reactive<Record<string, boolean>>({});

  const pwdFocused = reactive<Record<string, boolean>>({});

  function validateField(field: string): boolean {
    let error = '';
    switch (field) {
      case 'account': {
        const val = form.value.account.trim();
        if (mode.value === 'register') {
          if (!val) error = '请填写弦予号';
          else if (!/^[a-zA-Z0-9]{6,20}$/.test(val)) error = '弦予号需 6-20 位，支持纯数字、纯字母或数字字母组合';
        } else {
          if (!val) error = '请输入弦予号或邮箱';
        }
        break;
      }
      case 'nickname':
        if (mode.value === 'register') {
          const val = form.value.nickname.trim();
          if (val && val.length > 20) error = '昵称最多 20 个字符';
          else if (val && !/^[a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+$/.test(val)) error = '昵称仅支持字母、数字、汉字';
        }
        break;
      case 'email': {
        if (mode.value === 'register' ||
            (mode.value === 'login' && loginMethod.value === 'email')) {
          const val = form.value.email.trim();
          if (!val) error = '请填写邮箱';
          else if (!EMAIL_RE.test(val)) error = '邮箱格式不正确';
        }
        break;
      }
      case 'code': {
        if (mode.value === 'register' ||
            (mode.value === 'login' && loginMethod.value === 'email')) {
          if (!form.value.code.trim()) error = '请填写验证码';
        }
        break;
      }
      case 'password': {
        const val = form.value.password;
        if (!val) error = '请输入密码';
        else if (mode.value === 'register' && val.length < 6) error = '密码至少 6 位';
        break;
      }
      case 'confirmPassword':
        if (mode.value === 'register') {
          const val = form.value.confirmPassword;
          if (!val) error = '请再次输入密码';
          else if (val !== form.value.password) error = '两次输入的密码不一致';
        }
        break;
    }
    if (error) fieldErrors.value[field] = error;
    else delete fieldErrors.value[field];
    return !error;
  }

  function clearFieldError(field: string) {
    if (fieldErrors.value[field]) delete fieldErrors.value[field];
  }

  function onPasswordInput() {
    clearFieldError('password');
    if (form.value.confirmPassword) validateField('confirmPassword');
  }

  watch(mode, () => { fieldErrors.value = {}; });

  return {
    form,
    forgotForm,
    fieldErrors,
    pwdVisible,
    pwdFocused,
    validateField,
    clearFieldError,
    onPasswordInput,
  };
}
