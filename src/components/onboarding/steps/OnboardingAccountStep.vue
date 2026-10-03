<script setup lang="ts"> // 实现
// 引导流程账号步：登录/注册 UI（搬自 Auth.vue）、人机验证与用户协议弹窗。
// 登录/注册成功后发出 authorized 事件，由主组件延迟结算完成逻辑。
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';

import { useToast } from '../../../composables/toast'; // 实现
import { useAuthStore } from '../../../features/auth/store'; // 实现
import HumanCaptchaModal from '../../common/HumanCaptchaModal.vue';
import {
  login,
  register,
  sendEmailCode, // 实现
  getUserAgreement,
  type AuthMode, // 实现
  type HumanCaptchaPayload,
  type VerifyCodeType, // 实现
} from '../../../services/auth/authService'; // 实现

const emit = defineEmits<{
  (event: 'authorized'): void;
}>();

const { showToast } = useToast(); // 实现
const authStore = useAuthStore(); // 实现

// --- 账号步骤：登录/注册 UI（搬自 Auth.vue）---
const authMode = ref<AuthMode>('login'); // 实现
const authForm = ref({ account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' });
const pwdVisible = reactive<Record<string, boolean>>({});

const pwdFocused = reactive<Record<string, boolean>>({});
const authLoading = ref(false); // 实现
const codeLoading = ref(false); // 实现
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
const captchaModalOpen = ref(false);
const captchaModalTitle = ref('人机验证');
const captchaModalDescription = ref('请先完成验证，验证通过后将继续当前操作。');
let captchaResolver: ((payload: HumanCaptchaPayload | null) => void) | null = null;
const authMessage = ref(''); // 实现
const authMessageTone = ref<'error' | 'success'>('error'); // 实现

const authTitle = computed(() => // 实现
  authMode.value === 'login' ? '欢迎回来' : '创建你的账号', // 实现
);
const authSubtitle = computed(() => // 实现
  authMode.value === 'login' // 实现
    ? '登录后可同步个人资料到云端服务器。' // 实现
    : '注册需要邮箱验证码，之后即可登录使用。', // 实现
);
const authHeaderLabel = computed(() => // 实现
  authMode.value === 'login' ? '账号' : '注册账号',
);

const switchAuthMode = (m: AuthMode) => { // 实现
  authMode.value = m; // 实现
  authMessage.value = ''; // 实现
  authForm.value.password = '';
  authForm.value.confirmPassword = '';
};

const showAuthMessage = (text: string, tone: 'error' | 'success' = 'error') => { // 实现
  authMessageTone.value = tone; // 实现
  authMessage.value = text; // 实现
};

const requestHumanCaptcha = (title: string, description: string): Promise<HumanCaptchaPayload | null> => {
  captchaModalTitle.value = title;
  captchaModalDescription.value = description;
  captchaModalOpen.value = true;
  return new Promise(resolve => {
    captchaResolver = resolve;
  });
};

const resolveHumanCaptcha = (payload: HumanCaptchaPayload | null) => {
  captchaModalOpen.value = false;
  captchaResolver?.(payload);
  captchaResolver = null;
};

const handleCaptchaVerified = (payload: HumanCaptchaPayload) => {
  resolveHumanCaptcha(payload);
};

const handleCaptchaCancel = () => {
  resolveHumanCaptcha(null);
};

const handleSendCode = async () => { // 实现
  const email = authForm.value.email; // 实现
  if (!email) { // 实现
    showAuthMessage('请先填写邮箱'); // 实现
    return;
  }
  const type: VerifyCodeType = 'register'; // 实现
  const captchaPayload = await requestHumanCaptcha(
    '发送验证码前验证',
    '完成验证后将向邮箱发送验证码。',
  );
  if (!captchaPayload) return;
  codeLoading.value = true; // 实现
  authMessage.value = ''; // 实现
  try {
    const result = await sendEmailCode(email, type, captchaPayload, authForm.value.account.trim() || undefined);
    showAuthMessage(result.message || '验证码已发送到邮箱', 'success'); // 实现
    showToast(result.message || '验证码已发送到邮箱', 'success'); // 实现
    startCodeCountdown();
  } catch (error) { // 实现
    const tip = error instanceof Error ? error.message : '验证码发送失败'; // 实现
    showAuthMessage(tip); // 实现
    showToast(tip, 'error'); // 实现
  } finally {
    codeLoading.value = false; // 实现
  }
};

const handleAuthSubmit = async () => { // 实现
  if (!agreementAccepted.value) {
    showAuthMessage('请先阅读并同意用户协议');
    return;
  }
  if (authMode.value === 'register') {
    const ciyuanxi = authForm.value.account.trim();
    if (!ciyuanxi) {
      showAuthMessage('请填写弦予号');
      return;
    }
    if (!/^[a-zA-Z0-9]{6,20}$/.test(ciyuanxi)) {
      showAuthMessage('弦予号需 6-20 位，支持纯数字、纯字母或数字字母组合');
      return;
    }
    if (!authForm.value.email.trim()) {
      showAuthMessage('请填写邮箱');
      return;
    }
  }
  if (authMode.value === 'register' && authForm.value.password !== authForm.value.confirmPassword) {
    showAuthMessage('两次输入的密码不一致');
    return;
  }
  const captchaPayload = await requestHumanCaptcha(
    authMode.value === 'login' ? '登录前验证' : '注册前验证',
    authMode.value === 'login'
      ? '完成验证后将继续登录当前账号。'
      : '完成验证后将继续创建账号。',
  );
  if (!captchaPayload) return;
  authLoading.value = true; // 实现
  authMessage.value = ''; // 实现
  try {
    const result = // 实现
      authMode.value === 'login' // 实现
        ? await login(authForm.value.account, authForm.value.password, captchaPayload)
        : await register( // 实现
            authForm.value.account.trim(),
            authForm.value.nickname.trim(),
            authForm.value.password, // 实现
            authForm.value.email,
            authForm.value.code,
            captchaPayload,
          );

    authStore.setAuth(result); // 实现
    authForm.value = { account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' };
    showAuthMessage(authMode.value === 'login' ? '登录成功' : '注册成功', 'success'); // 实现
    showToast(authMode.value === 'login' ? '登录成功' : '注册成功', 'success'); // 实现
    // 登录/注册成功：延迟结算由主组件的 authorized 处理器完成
    emit('authorized');
  } catch (error) { // 实现
    const tip = error instanceof Error ? error.message : '登录/注册失败，请检查后端接口'; // 实现
    showAuthMessage(tip); // 实现
    showToast(tip, 'error'); // 实现
  } finally {
    authLoading.value = false; // 实现
  }
};

// --- 用户协议 ---
const agreementAccepted = ref(false);
const agreementTitle = ref('弦予音乐用户协议');
const agreementContent = ref('');
const termsModalOpen = ref(false);
const termsScrolledToEnd = ref(false);
const termsBodyRef = ref<HTMLElement | null>(null);

const defaultAgreementContent = `一、协议范围
本协议适用于弦予音乐客户端账号系统及相关云端同步、资料管理、统计上报、风控安全服务。用户注册、登录或继续使用账号功能，即表示已阅读并同意本协议。

二、账号注册与使用
用户应使用真实、有效的邮箱完成注册，并妥善保管账号、密码和邮箱验证码。因用户主动泄露、共享账号或使用非官方客户端造成的损失，由用户自行承担。

三、本地数据读取说明
为提供账号登录、设备安全识别、播放统计、同步和故障排查功能，账号系统可能读取或生成以下本地数据：本机设备标识、客户端版本、操作系统版本、设备型号、登录状态凭证、用户主动上传的头像、本地收藏、歌单、播放历史、听歌时长等音乐使用数据，以及软件运行错误日志。上述数据仅用于账号服务、安全风控、功能同步、异常定位和产品维护。

四、数据上报与安全
客户端启动、登录、注册、搜索、播放统计、错误反馈等行为可能向服务器上报必要信息，包括设备ID、IP地址、账号ID、客户端版本、操作系统版本、设备型号、行为时间和必要的请求参数。我们将尽合理努力保护数据安全，不会主动出售用户个人信息。

五、禁止行为
用户不得利用账号系统进行恶意攻击、批量注册、刷量、破解、逆向、绕过限制、上传违法违规内容、干扰服务器稳定性或侵犯他人权益。发现异常行为时，平台有权限制、封禁账号或设备。

六、封禁与申诉
若账号或设备因违反协议、安全风控或恶意行为被封禁，登录时将提示封禁状态及原因。用户如认为处理有误，可联系管理员并提供账号、设备ID及相关说明进行核查。

七、协议更新
平台可根据功能调整、安全要求或法律合规需要更新本协议。更新后继续使用账号功能，视为接受更新后的协议内容。`;

async function loadUserAgreement() {
  try {
    const agreement = await getUserAgreement();
    if (agreement.title.trim()) {
      agreementTitle.value = agreement.title.trim();
    }
    if (agreement.content.trim()) {
      agreementContent.value = agreement.content.trim();
    } else {
      agreementContent.value = defaultAgreementContent;
    }
  } catch {
    agreementTitle.value = '弦予音乐用户协议';
    agreementContent.value = defaultAgreementContent;
  }
}

async function openTermsModal() {
  termsScrolledToEnd.value = false;
  termsModalOpen.value = true;
  await nextTick();
  refreshTermsScrollState();
}

function closeTermsModal() {
  termsModalOpen.value = false;
}

function refreshTermsScrollState() {
  const el = termsBodyRef.value;
  if (!el) return;
  const hasScrollableContent = el.scrollHeight > el.clientHeight + 4;
  if (!hasScrollableContent) {
    termsScrolledToEnd.value = true;
    return;
  }
  termsScrolledToEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
}

function handleAgreementCheckboxChange(event: Event) {
  const checked = (event.target as HTMLInputElement | null)?.checked ?? false;
  if (!checked) {
    agreementAccepted.value = false;
    return;
  }
  agreementAccepted.value = false;
  void openTermsModal();
}

function acceptTerms() {
  if (!termsScrolledToEnd.value) {
    showToast('请先阅读并滚动到用户协议底部', 'error');
    return;
  }
  agreementAccepted.value = true;
  termsModalOpen.value = false;
}

onMounted(() => {
  void loadUserAgreement();
});
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-[clamp(2rem,5vw,5rem)] items-start lg:items-stretch lg:h-full lg:overflow-hidden">
    <header class="lg:flex lg:flex-col lg:justify-center">
      <p
        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
        style="font-size: clamp(14px, 1.2vw, 18px);"
      >
        账号
      </p>
      <h2
        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
        style="font-size: clamp(40px, 6vw, 80px);"
      >
        <template v-if="authStore.isLoggedIn">我的<br />账号</template>
        <template v-else>账号</template>
      </h2>
      <p
        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-sm"
        style="font-size: clamp(14px, 1.1vw, 17px);"
      >
        {{ authStore.isLoggedIn
          ? '账号已登录，歌单与插件将在多设备间保持同步。'
          : '登录账号可将您的歌单、插件实时同步，多设备无缝切换。' }}
      </p>
    </header>

    <div class="w-full lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:flex lg:flex-col lg:justify-center">
      <div v-if="authStore.isLoggedIn" class="w-full">
        <div class="mb-6">
          <p
            class="text-black/70 dark:text-white/70 font-light tracking-wider mb-3"
            style="font-size: clamp(13px, 1.1vw, 16px);"
          >
            当前账号
          </p>
          <h3
            class="text-black dark:text-white font-black tracking-tight leading-none"
            style="font-size: clamp(28px, 3.5vw, 44px);"
          >
            已登录
          </h3>
          <p
            class="mt-3 text-black/60 dark:text-white/60 font-light max-w-xl"
            style="font-size: clamp(13px, 1vw, 15px);"
          >
            您的歌单与插件将自动同步，可直接完成初始化设置。
          </p>
        </div>

        <div
          class="flex items-center gap-5 border-b border-black/10 dark:border-white/10 pb-6"
        >
          <img
            v-if="authStore.user?.avatar"
            :src="authStore.user.avatar"
            alt=""
            class="h-[clamp(56px,6vw,80px)] w-[clamp(56px,6vw,80px)] shrink-0 rounded-full object-cover"
          />
          <div
            v-else
            class="flex h-[clamp(56px,6vw,80px)] w-[clamp(56px,6vw,80px)] shrink-0 items-center justify-center rounded-full bg-[#EC4141]/10 font-black text-[#EC4141]"
            style="font-size: clamp(20px, 2.4vw, 32px);"
          >
            {{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}
          </div>

          <div class="min-w-0 flex-1">
            <div
              class="truncate font-bold text-black dark:text-white"
              style="font-size: clamp(18px, 1.8vw, 26px);"
            >
              {{ authStore.user?.nickname || authStore.user?.username }}
            </div>
            <div
              class="mt-1 truncate text-black/55 dark:text-white/55 font-light"
              style="font-size: clamp(12px, 1vw, 15px);"
            >
              @{{ authStore.user?.ciyuanxi_id || authStore.user?.username || '未设置弦予号' }}
            </div>
            <div
              v-if="authStore.user?.email"
              class="mt-0.5 truncate text-black/45 dark:text-white/45 font-light"
              style="font-size: clamp(12px, 1vw, 15px);"
            >
              {{ authStore.user.email }}
            </div>
          </div>
        </div>
      </div>

      <template v-else>
        <div class="mb-6">
          <p
            class="text-black/70 dark:text-white/70 font-light tracking-wider mb-3"
            style="font-size: clamp(13px, 1.1vw, 16px);"
          >
            {{ authHeaderLabel }}
          </p>
          <h3
            class="text-black dark:text-white font-black tracking-tight leading-none"
            style="font-size: clamp(28px, 3.5vw, 44px);"
          >
            {{ authTitle }}
          </h3>
          <p
            class="mt-3 text-black/60 dark:text-white/60 font-light max-w-xl"
            style="font-size: clamp(13px, 1vw, 15px);"
          >
            {{ authSubtitle }}
          </p>
        </div>

        <nav class="mb-6">
          <div class="flex items-center gap-2 border-b border-black/10 dark:border-white/10">
            <button
              type="button"
              class="relative px-7 py-3 font-medium tracking-wide transition-colors cursor-pointer"
              :class="authMode === 'login'
                ? 'text-[#EC4141]'
                : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
              style="font-size: clamp(15px, 1.3vw, 18px);"
              @click="switchAuthMode('login')"
            >
              登录
              <span
                class="absolute left-1/2 -translate-x-1/2 -bottom-px h-1 w-12 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
                :class="authMode === 'login' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
              ></span>
            </button>
            <button
              type="button"
              class="relative px-7 py-3 font-medium tracking-wide transition-colors cursor-pointer"
              :class="authMode === 'register'
                ? 'text-[#EC4141]'
                : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
              style="font-size: clamp(15px, 1.3vw, 18px);"
              @click="switchAuthMode('register')"
            >
              注册
              <span
                class="absolute left-1/2 -translate-x-1/2 -bottom-px h-1 w-12 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
                :class="authMode === 'register' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
              ></span>
            </button>
          </div>
        </nav>

        <Transition name="auth-mode" mode="out-in">
          <form
            :key="authMode"
            class="grid gap-7 max-w-xl"
            @submit.prevent="handleAuthSubmit"
          >
            <label class="grid gap-3">
              <span
                class="text-black/70 dark:text-white/70 font-light tracking-wider"
                style="font-size: clamp(13px, 1.1vw, 16px);"
              >{{ authMode === 'login' ? '弦予号/邮箱' : '弦予号' }}</span>
              <input
                v-model="authForm.account"
                type="text"
                :placeholder="authMode === 'login' ? '输入弦予号或邮箱登录' : '6-20位，支持纯数字、纯字母或组合'"
                autocomplete="username"
                required
                class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                style="font-size: clamp(15px, 1.3vw, 18px);"
              />
            </label>

            <template v-if="authMode === 'register'">
              <label class="grid gap-3">
                <span
                  class="text-black/70 dark:text-white/70 font-light tracking-wider"
                  style="font-size: clamp(13px, 1.1vw, 16px);"
                >昵称（选填）</span>
                <input
                  v-model="authForm.nickname"
                  type="text"
                  placeholder='留空则默认"弦予+弦予号"'
                  autocomplete="nickname"
                  class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  style="font-size: clamp(15px, 1.3vw, 18px);"
                />
              </label>
              <label class="grid gap-3">
                <span
                  class="text-black/70 dark:text-white/70 font-light tracking-wider"
                  style="font-size: clamp(13px, 1.1vw, 16px);"
                >邮箱</span>
                <input
                  v-model="authForm.email"
                  type="email"
                  placeholder="name@example.com"
                  autocomplete="email"
                  required
                  class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  style="font-size: clamp(15px, 1.3vw, 18px);"
                />
              </label>

              <div class="grid grid-cols-[1fr_auto] items-end gap-4">
                <label class="grid gap-3">
                  <span
                    class="text-black/70 dark:text-white/70 font-light tracking-wider"
                    style="font-size: clamp(13px, 1.1vw, 16px);"
                  >邮箱验证码</span>
                  <input
                    v-model="authForm.code"
                    type="text"
                    placeholder="填写验证码"
                    autocomplete="one-time-code"
                    required
                    class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                    style="font-size: clamp(15px, 1.3vw, 18px);"
                  />
                </label>
                <button
                  type="button"
                  class="h-[clamp(2.75rem,4vw,3.5rem)] px-6 whitespace-nowrap font-medium text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style="font-size: clamp(14px, 1.1vw, 16px);"
                  :disabled="codeLoading || codeCountdown > 0"
                  @click="handleSendCode"
                >
                  {{ codeLoading ? '发送中…' : codeCountdown > 0 ? `重新发送 (${codeCountdown}s)` : '发送验证码' }}
                </button>
              </div>
            </template>

            <label class="grid gap-3">
              <span
                class="text-black/70 dark:text-white/70 font-light tracking-wider"
                style="font-size: clamp(13px, 1.1vw, 16px);"
              >密码</span>
              <div class="relative" @focusin="pwdFocused.password = true" @focusout="pwdFocused.password = false; pwdVisible.password = false">
                <input
                  v-model="authForm.password"
                  :type="pwdVisible.password ? 'text' : 'password'"
                  placeholder="请输入密码"
                  :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
                  required
                  class="h-[clamp(2.75rem,4vw,3.5rem)] w-full bg-transparent border-b border-black/15 dark:border-white/15 pl-1 pr-10 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  style="font-size: clamp(15px, 1.3vw, 18px);"
                />
                <button
                  type="button"
                  v-show="pwdFocused.password && authForm.password.length > 0"
                  class="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.password ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.password = !pwdVisible.password"
                >
                  <EyeOff v-if="pwdVisible.password" class="h-5 w-5" />
                  <Eye v-else class="h-5 w-5" />
                </button>
              </div>
            </label>

            <label v-if="authMode === 'register'" class="grid gap-3">
              <span
                class="text-black/70 dark:text-white/70 font-light tracking-wider"
                style="font-size: clamp(13px, 1.1vw, 16px);"
              >确认密码</span>
              <div class="relative" @focusin="pwdFocused.confirmPassword = true" @focusout="pwdFocused.confirmPassword = false; pwdVisible.confirmPassword = false">
                <input
                  v-model="authForm.confirmPassword"
                  :type="pwdVisible.confirmPassword ? 'text' : 'password'"
                  placeholder="再次输入密码"
                  autocomplete="new-password"
                  required
                  class="h-[clamp(2.75rem,4vw,3.5rem)] w-full bg-transparent border-b border-black/15 dark:border-white/15 pl-1 pr-10 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  style="font-size: clamp(15px, 1.3vw, 18px);"
                />
                <button
                  type="button"
                  v-show="pwdFocused.confirmPassword && authForm.confirmPassword.length > 0"
                  class="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.confirmPassword ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.confirmPassword = !pwdVisible.confirmPassword"
                >
                  <EyeOff v-if="pwdVisible.confirmPassword" class="h-5 w-5" />
                  <Eye v-else class="h-5 w-5" />
                </button>
              </div>
            </label>

            <div class="flex items-start gap-3 text-black/60 dark:text-white/60 select-none" style="font-size: clamp(12px, 1vw, 14px);">
              <input
                v-model="agreementAccepted"
                type="checkbox"
                class="mt-1 h-4 w-4 accent-[#EC4141] cursor-pointer"
                @change="handleAgreementCheckboxChange"
              />
              <span>
                我已阅读并同意
                <button
                  type="button"
                  class="text-[#EC4141] hover:text-[#d13b3b] underline underline-offset-4 cursor-pointer"
                  @click="openTermsModal"
                >
                  用户协议
                </button>
                ，并知悉账号系统会读取必要的本地数据用于登录、安全风控、同步和统计。
              </span>
            </div>

            <div
              v-if="authMessage"
              class="px-4 py-2 rounded-md text-sm font-medium"
              :class="authMessageTone === 'error'
                ? 'bg-red-50 dark:bg-red-500/10 text-[#EC4141]'
                : 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400'"
              style="font-size: clamp(12px, 1vw, 14px);"
            >
              {{ authMessage }}
            </div>

            <div class="pt-2 flex items-center gap-5 flex-wrap">
              <button
                type="submit"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-10 py-3 rounded-full font-medium transition flex items-center gap-1 active:scale-95 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                style="font-size: clamp(14px, 1.1vw, 16px);"
                :disabled="authLoading || !agreementAccepted"
              >
                {{ authLoading ? '提交中…' : authMode === 'login' ? '登录' : '注册' }}
              </button>
              <button
                type="button"
                class="text-black/60 dark:text-white/60 hover:text-[#EC4141] font-medium transition cursor-pointer"
                style="font-size: clamp(13px, 1vw, 15px);"
                @click="switchAuthMode(authMode === 'login' ? 'register' : 'login')"
              >
                {{ authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
              </button>
            </div>
          </form>
        </Transition>
      </template>
    </div>

    <!-- 用户协议弹窗：Teleport 到 body，层级与拆分前一致 -->
    <Teleport to="body">
      <Transition name="avatar-modal">
        <div
          v-if="termsModalOpen"
          class="fixed inset-0 z-[12000] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm"
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
              <button type="button" class="terms-btn terms-btn--ghost" @click="closeTermsModal">关闭</button>
              <button
                type="button"
                class="terms-btn terms-btn--danger"
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

<style scoped> /* 样式 */
.custom-scrollbar::-webkit-scrollbar { /* 样式 */
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track { /* 样式 */
  background: transparent; /* 样式 */
}
.custom-scrollbar::-webkit-scrollbar-thumb { /* 样式 */
  background: rgba(0, 0, 0, 0.1); /* 样式 */
  border-radius: 10px; /* 样式 */
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb { /* 样式 */
  background: rgba(255, 255, 255, 0.1); /* 样式 */
}

.auth-mode-enter-active, /* 样式 */
.auth-mode-leave-active { /* 样式 */
  transition: opacity 0.3s ease, transform 0.3s ease; /* 样式 */
}
.auth-mode-enter-from { /* 样式 */
  opacity: 0;
  transform: translateX(10px); /* 样式 */
}
.auth-mode-leave-to { /* 样式 */
  opacity: 0;
  transform: translateX(-10px); /* 样式 */
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

.terms-btn {
  flex: 1;
  height: 38px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
  border: 1px solid transparent;
  max-width: 160px;
}

.terms-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent; /* 样式 */
  color: rgba(100, 116, 139, 0.9);
}

.terms-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31 41 55);
}

.terms-btn--danger {
  background: #EC4141;
  color: #ffffff;
}

.terms-btn--danger:hover {
  background: #d13b3b;
}

.terms-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.terms-btn--danger:disabled,
.terms-btn--danger:disabled:hover {
  background: rgba(236, 65, 65, 0.45);
}

.avatar-modal-enter-active .terms-card,
.avatar-modal-leave-active .terms-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.avatar-modal-enter-from .terms-card,
.avatar-modal-leave-to .terms-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
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

:global(.dark) .terms-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

:global(.dark) .terms-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .terms-content {
  color: rgba(255, 255, 255, 0.68);
}
</style>
