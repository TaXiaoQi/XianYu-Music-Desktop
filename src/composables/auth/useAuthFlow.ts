// 登录/注册/找回密码/发送验证码/扫码登录流程编排（自 src/views/Auth.vue 拆出，逻辑保持原样）
import { onUnmounted, ref, watch, type Ref } from 'vue';
import QRCode from 'qrcode';

import { useAuthStore } from '../../features/auth/store';
import { useToast } from '../toast';
import {
  createQrLoginCode,
  getProfile,
  login,
  loginByEmail,
  pollQrLoginStatus,
  register,
  resetPassword,
  sendEmailCode,
  type AuthMode,
  type HumanCaptchaPayload,
  type ProfileStats,
  type QrPollResult,
  type VerifyCodeType,
} from '../../services/auth/authService';
import { EMAIL_RE, type AuthFormState, type ForgotFormState } from './useAuthForm';

export type LoginMethod = 'password' | 'email' | 'qr';

export interface UseAuthFlowOptions {
  mode: Ref<AuthMode>;
  loginMethod: Ref<LoginMethod>;
  form: Ref<AuthFormState>;
  forgotForm: Ref<ForgotFormState>;
  fieldErrors: Ref<Record<string, string>>;
  validateField: (field: string) => boolean;
  requestHumanCaptcha: (title: string, description: string) => Promise<HumanCaptchaPayload | null>;
  agreementAccepted: Ref<boolean>;
  stats: Ref<ProfileStats | null>;
  nicknameDraft: Ref<string>;
  avatarDraft: Ref<string>;
}

export function useAuthFlow(options: UseAuthFlowOptions) {
  const {
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
  } = options;

  const authStore = useAuthStore();
  const { showToast } = useToast();

  const message = ref('');
  const messageTone = ref<'error' | 'success'>('error');
  const loading = ref(false);
  const codeLoading = ref(false);
  const codeCountdown = ref(0);
  let codeCountdownTimer: ReturnType<typeof setInterval> | null = null;
  function startCodeCountdown() {
    codeCountdown.value = 60;
    if (codeCountdownTimer) clearInterval(codeCountdownTimer);
    codeCountdownTimer = setInterval(() => {
      codeCountdown.value--;
      if (codeCountdown.value <= 0) {
        codeCountdown.value = 0;
        if (codeCountdownTimer) { clearInterval(codeCountdownTimer); codeCountdownTimer = null; }
      }
    }, 1000);
  }

  function showMessage(text: string, tone: 'error' | 'success' = 'error') {
    messageTone.value = tone;
    message.value = text;
  }

  async function onSubmit() {
    if (mode.value === 'forgot') {
      await handleResetPassword();
      return;
    }
    if (!agreementAccepted.value) {
      showMessage('请先勾选同意用户协议');
      showToast('请先勾选同意用户协议', 'error');
      return;
    }
    if (mode.value === 'login') {
      if (loginMethod.value === 'email') {
        if (!validateField('email') || !validateField('code')) {
          const first = fieldErrors.value.email || fieldErrors.value.code;
          showMessage(first);
          showToast(first, 'error');
          return;
        }
      } else if (!validateField('account')) {
        showMessage(fieldErrors.value.account);
        showToast(fieldErrors.value.account, 'error');
        return;
      }
    } else if (mode.value === 'register') {
      const fields = ['account', 'nickname', 'email', 'code', 'password', 'confirmPassword'] as const;
      let allValid = true;
      for (const f of fields) {
        if (!validateField(f)) allValid = false;
      }
      if (!allValid) {
        const firstError = Object.values(fieldErrors.value)[0];
        if (firstError) {
          showMessage(firstError);
          showToast(firstError, 'error');
        }
        return;
      }
    }
    const captchaPayload = await requestHumanCaptcha(
      mode.value === 'login' ? '登录前验证' : '注册前验证',
      mode.value === 'login'
        ? '完成验证后将继续登录当前账号。'
        : '完成验证后将继续创建账号。',
    );
    if (!captchaPayload) return;
    loading.value = true;
    message.value = '';
    try {
      const result =
        mode.value === 'login'
          ? (loginMethod.value === 'email'
              ? await loginByEmail(form.value.email.trim(), form.value.code.trim(), captchaPayload)
              : await login(form.value.account, form.value.password, captchaPayload))
          : await register(
              form.value.account.trim(),
              form.value.nickname.trim(),
              form.value.password,
              form.value.email,
              form.value.code,
              captchaPayload,
            );

      authStore.setAuth(result);
      form.value = { account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' };
      nicknameDraft.value = result.user.nickname || result.user.username;
      avatarDraft.value = result.user.avatar || '';
      showMessage(mode.value === 'login' ? '登录成功' : '注册成功', 'success');
      showToast(mode.value === 'login' ? '登录成功' : '注册成功', 'success');

      try {
        const profile = await getProfile();
        if (profile) {
          authStore.setAuth({ token: result.token, user: profile.user });
          stats.value = profile.stats;
          nicknameDraft.value = profile.user.nickname || profile.user.username;
          avatarDraft.value = profile.user.avatar || '';
        }
      } catch {
        stats.value = null;
      }
    } catch (error) {
      const tip = error instanceof Error ? error.message : '登录/注册失败，请检查后端接口';
      showMessage(tip);
      showToast(tip, 'error');
      if (tip.includes('封禁') || tip.includes('禁用')) {
        window.alert(tip);
      }
    } finally {
      loading.value = false;
    }
  }

  async function handleResetPassword() {
    const { email, code, newPassword, confirmPassword } = forgotForm.value;
    if (!email) {
      showMessage('请先填写注册邮箱');
      return;
    }
    if (!code) {
      showMessage('请输入邮箱验证码');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      showMessage('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage('两次输入的新密码不一致');
      return;
    }
    const captchaPayload = await requestHumanCaptcha(
      '重置密码前验证',
      '完成验证后将继续提交密码重置请求。',
    );
    if (!captchaPayload) return;
    loading.value = true;
    message.value = '';
    try {
      const result = await resetPassword(email, code, newPassword, captchaPayload);
      forgotForm.value = { email: '', code: '', newPassword: '', confirmPassword: '' };
      showMessage(result.message || '密码修改成功', 'success');
      showToast(result.message || '密码修改成功，请使用新密码登录', 'success');
      mode.value = 'login';
      form.value.account = '';
      form.value.password = '';
    } catch (error) {
      const tip = error instanceof Error ? error.message : '重置密码失败';
      showMessage(tip);
      showToast(tip, 'error');
    } finally {
      loading.value = false;
    }
  }

  async function handleSendCode() {
    const isForgot = mode.value === 'forgot';
    const isEmailLogin = mode.value === 'login' && loginMethod.value === 'email';
    const email = isForgot ? forgotForm.value.email : form.value.email;
    if (!email) {
      showMessage('请先填写邮箱');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      showMessage('邮箱格式不正确');
      return;
    }
    const type: VerifyCodeType = isForgot ? 'reset_password' : (isEmailLogin ? 'login' : 'register');
    const captchaPayload = await requestHumanCaptcha(
      '发送验证码前验证',
      '完成验证后将向邮箱发送验证码。',
    );
    if (!captchaPayload) return;
    codeLoading.value = true;
    message.value = '';
    try {
      const ciyuanxiId = isForgot || isEmailLogin ? undefined : form.value.account.trim() || undefined;
      const result = await sendEmailCode(email, type, captchaPayload, ciyuanxiId);
      showMessage(result.message || '验证码已发送到邮箱', 'success');
      showToast(result.message || '验证码已发送到邮箱', 'success');
      startCodeCountdown();
    } catch (error) {
      const tip = error instanceof Error ? error.message : '验证码发送失败';
      showMessage(tip);
      showToast(tip, 'error');
    } finally {
      codeLoading.value = false;
    }
  }

  function switchMode(next: AuthMode) {
    mode.value = next;
    message.value = '';
    form.value.password = '';
    form.value.confirmPassword = '';
    if (next === 'forgot') {
      agreementAccepted.value = false;
    }
    if (next !== 'forgot') {
      forgotForm.value = { email: '', code: '', newPassword: '', confirmPassword: '' };
    }
  }
  function enterForgot() {
    switchMode('forgot');
  }

  // ------- 扫码登录（桌面端二维码 / 手机 App 扫码确认） -------
  const qrStatus = ref<'loading' | 'pending' | 'scanned' | 'expired' | 'error' | 'logged'>('loading');
  const qrCode = ref('');
  const qrImage = ref('');
  const qrExpireAt = ref(0);
  const qrError = ref('');

  let qrPollTimer: ReturnType<typeof setInterval> | null = null;

  function stopQrPolling() {
    if (qrPollTimer) {
      clearInterval(qrPollTimer);
      qrPollTimer = null;
    }
  }

  async function startQrLogin() {
    stopQrPolling();
    qrStatus.value = 'loading';
    qrCode.value = '';
    qrImage.value = '';
    qrError.value = '';
    try {
      const { code, expireSeconds } = await createQrLoginCode();
      if (!code) throw new Error('二维码内容为空');
      qrCode.value = code;
      qrExpireAt.value = Date.now() + expireSeconds * 1000;
      qrImage.value = await QRCode.toDataURL(`xianyumusic://tvlogin/${code}`, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      qrStatus.value = 'pending';
      startQrPolling();
    } catch (error) {
      qrStatus.value = 'error';
      qrError.value = error instanceof Error ? error.message : '二维码获取失败，请重试';
    }
  }

  function startQrPolling() {
    stopQrPolling();
    qrPollTimer = setInterval(async () => {
      if (qrStatus.value === 'logged') return;
      if (Date.now() > qrExpireAt.value) {
        qrStatus.value = 'expired';
        stopQrPolling();
        return;
      }
      if (!qrCode.value) return;
      let result: QrPollResult;
      try {
        result = await pollQrLoginStatus(qrCode.value);
      } catch {
        return;
      }
      if (result.status === 'logged_in' && result.token) {
        await handleQrLoggedIn(result);
      } else if (result.status === 'scanned' && qrStatus.value === 'pending') {
        qrStatus.value = 'scanned';
      } else if (result.status === 'invalid') {
        qrStatus.value = 'expired';
        stopQrPolling();
      }
    }, 2000);
  }

  async function handleQrLoggedIn(result: QrPollResult) {
    stopQrPolling();
    qrStatus.value = 'logged';
    const token = result.token || '';
    const user = result.user ?? {
      id: '',
      username: '',
      nickname: '',
      email: '',
      avatar: '',
      ciyuanxi_id: undefined,
    };
    authStore.setAuth({ token, user });
    nicknameDraft.value = user.nickname || user.username;
    avatarDraft.value = user.avatar || '';
    showMessage('登录成功', 'success');
    showToast('登录成功', 'success');
    try {
      const profile = await getProfile();
      if (profile) {
        authStore.setAuth({ token, user: profile.user });
        stats.value = profile.stats;
        nicknameDraft.value = profile.user.nickname || profile.user.username;
        avatarDraft.value = profile.user.avatar || '';
      }
    } catch {
      stats.value = null;
    }
  }

  watch(loginMethod, (m) => {
    if (m === 'qr' && mode.value === 'login') {
      void startQrLogin();
    } else {
      stopQrPolling();
    }
  });

  watch(mode, () => {
    if (mode.value === 'login' && loginMethod.value === 'qr') {
      void startQrLogin();
    } else {
      stopQrPolling();
    }
  });

  onUnmounted(() => {
    stopQrPolling();
  });

  return {
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
  };
}
