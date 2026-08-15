<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { useSettingsThemeControls } from '../../composables/useSettingsThemeControls';
import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import HumanCaptchaModal from '../common/HumanCaptchaModal.vue';
import {
  areShortcutBindingsEqual,
  createDefaultShortcutSettings,
  formatShortcutBinding,
  getShortcutBindingFromEvent,
  isSystemReservedShortcutEvent,
  shortcutActionLabels,
  shortcutActionOrder,
} from '../../features/settings/shortcuts';
import type { ShortcutActionId } from '../../types';
import { useAuthStore } from '../../features/auth/store';
import {
  login,
  register,
  sendEmailCode,
  getUserAgreement,
  type AuthMode,
  type HumanCaptchaPayload,
  type VerifyCodeType,
} from '../../services/auth/authService';

type Step = 'splash' | 'theme' | 'material' | 'shortcuts' | 'plugins' | 'account';

const SettingsPlugins = defineAsyncComponent(
  () => import('../settings/SettingsPlugins.vue'),
);

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'complete'): void;
}>();

const { settings, patchSettings } = useSettings();
const { showToast } = useToast();
const authStore = useAuthStore();
const {
  colorScheme,
  materialMode,
  keepWindowMaterialOnBlur,
  setColorScheme,
  toggleWindowMaterial,
  setKeepWindowMaterialOnBlur,
  isWindowMaterialButtonDisabled,
  isWindows11,
} = useSettingsThemeControls();

const SPLASH_HINT_DELAY = 800;
const SPLASH_AUTO_ADVANCE_DELAY = 5000;

const step = ref<Step>('splash');
const splashVisible = ref(true);
const splashHintVisible = ref(false);
let splashHintTimer: ReturnType<typeof setTimeout> | null = null;
let splashAutoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
let authCompleteTimer: ReturnType<typeof setTimeout> | null = null;

// --- 快捷键录入 ---
type ShortcutScope = 'local' | 'global';
interface CapturingTarget {
  actionId: ShortcutActionId;
  scope: ShortcutScope;
}
const capturingTarget = ref<CapturingTarget | null>(null);
const showPluginManager = ref(false);
const pluginManagerVisited = ref(false);

const steps: { key: Step; label: string }[] = [
  { key: 'theme', label: '主题' },
  { key: 'material', label: '材质' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'plugins', label: '插件' },
  { key: 'account', label: '账号' },
];

const currentStepIndex = computed(() =>
  step.value === 'splash' ? 0 : steps.findIndex(s => s.key === step.value) + 1,
);

const totalSteps = steps.length;

const shortcutRows = computed(() =>
  shortcutActionOrder.map(actionId => ({
    actionId,
    label: shortcutActionLabels[actionId],
    localBinding: settings.value.shortcuts.local[actionId],
    globalBinding: settings.value.shortcuts.global[actionId],
  })),
);

const isCapturing = (scope: ShortcutScope, actionId: ShortcutActionId) =>
  capturingTarget.value?.scope === scope && capturingTarget.value.actionId === actionId;

const startCapture = (scope: ShortcutScope, actionId: ShortcutActionId) => {
  capturingTarget.value = { scope, actionId };
};

const stopCapture = () => {
  capturingTarget.value = null;
};

const stepContentHidden = ref(false);

const openPluginManager = () => {
  pluginManagerVisited.value = true;
  stepContentHidden.value = true;
  showPluginManager.value = true;
};

const closePluginManager = () => {
  showPluginManager.value = false;
  // stepContentHidden is reset in @after-leave to keep step content hidden during the leave transition
};

const onPluginManagerClosed = () => {
  stepContentHidden.value = false;
};

const restoreDefaultShortcuts = () => {
  patchSettings({ shortcuts: createDefaultShortcutSettings() });
  stopCapture();
  showToast('已恢复默认快捷键', 'success');
};

const updateShortcut = (
  scope: ShortcutScope,
  actionId: ShortcutActionId,
  nextBinding: ReturnType<typeof getShortcutBindingFromEvent>,
) => {
  patchSettings({
    shortcuts: {
      ...settings.value.shortcuts,
      [scope]: {
        ...settings.value.shortcuts[scope],
        [actionId]: nextBinding,
      },
    },
  });
};

const onboardingSurfaceClass = computed(() => {
  if (materialMode.value === 'none') {
    return 'bg-white dark:bg-[#262626]';
  }

  return materialMode.value === 'mica'
    ? 'bg-white/62 dark:bg-[#262626]/58'
    : 'bg-white/50 dark:bg-[#262626]/48';
});

const handleShortcutCapture = (
  scope: ShortcutScope,
  actionId: ShortcutActionId,
  event: KeyboardEvent,
) => {
  if (!isCapturing(scope, actionId)) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    stopCapture();
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    updateShortcut(scope, actionId, null);
    stopCapture();
    return;
  }
  if (isSystemReservedShortcutEvent(event)) {
    showToast('Win 组合键由系统保留，不能作为快捷键', 'error');
    return;
  }

  const nextBinding = getShortcutBindingFromEvent(event);
  if (!nextBinding) return;

  const conflictActionId = shortcutActionOrder.find(
    candidate =>
      candidate !== actionId &&
      areShortcutBindingsEqual(settings.value.shortcuts[scope][candidate], nextBinding),
  );

  if (conflictActionId) {
    showToast(
      `${shortcutActionLabels[conflictActionId]} 已使用 ${formatShortcutBinding(nextBinding)}`,
      'error',
    );
    return;
  }

  updateShortcut(scope, actionId, nextBinding);
  stopCapture();
};

// --- 步骤切换 ---
const goToStep = (next: Step) => {
  if (next === step.value) return;
  step.value = next;
};

const nextStep = () => {
  const order: Step[] = ['splash', 'theme', 'material', 'shortcuts', 'plugins', 'account'];
  const idx = order.indexOf(step.value);
  if (idx < order.length - 1) {
    goToStep(order[idx + 1]);
  } else {
    handleComplete();
  }
};

const prevStep = () => {
  const order: Step[] = ['theme', 'material', 'shortcuts', 'plugins', 'account'];
  const idx = order.indexOf(step.value);
  if (idx > 0) goToStep(order[idx - 1]);
};

const skipRest = () => handleComplete();

// --- 完成时的未登录二次确认 ---
const showLoginConfirm = ref(false);

const handleComplete = () => {
  // 账号步骤：检测是否已登录，未登录弹出二次确认
  if (step.value === 'account' && !authStore.isLoggedIn) {
    showLoginConfirm.value = true;
    return;
  }
  emit('complete');
  emit('update:visible', false);
};

const confirmSkipLogin = () => {
  showLoginConfirm.value = false;
  emit('complete');
  emit('update:visible', false);
};

const cancelSkipLogin = () => {
  showLoginConfirm.value = false;
};

// --- 默认材质按钮：切回 none ---
const setMaterialToNone = () => {
  if (materialMode.value !== 'none') {
    toggleWindowMaterial(materialMode.value as 'acrylic' | 'mica' | 'blur');
  }
};

type OnboardingWindowMaterial = 'none' | 'mica' | 'acrylic' | 'blur';

const selectWindowMaterial = (mode: OnboardingWindowMaterial) => {
  if (materialMode.value === mode) return;
  if (mode === 'none') {
    setMaterialToNone();
    return;
  }
  if (isWindowMaterialButtonDisabled(mode)) return;
  toggleWindowMaterial(mode);
};

// --- 点击"自定义"主题：暂不支持，弹提示 ---
const showCustomUnsupported = ref(false);

const handleCustomThemeClick = () => {
  showCustomUnsupported.value = true;
};

// --- 账号步骤：登录/注册 UI（搬自 Auth.vue）---
const authMode = ref<AuthMode>('login');
const authForm = ref({ account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' });
const authLoading = ref(false);
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
const captchaModalOpen = ref(false);
const captchaModalTitle = ref('人机验证');
const captchaModalDescription = ref('请先完成验证，验证通过后将继续当前操作。');
let captchaResolver: ((payload: HumanCaptchaPayload | null) => void) | null = null;
const authMessage = ref('');
const authMessageTone = ref<'error' | 'success'>('error');

const authTitle = computed(() =>
  authMode.value === 'login' ? '欢迎回来' : '创建你的账号',
);
const authSubtitle = computed(() =>
  authMode.value === 'login'
    ? '登录后可同步个人资料到云端服务器。'
    : '注册需要邮箱验证码，之后即可登录使用。',
);
const authHeaderLabel = computed(() =>
  authMode.value === 'login' ? '账号' : '注册账号',
);

const switchAuthMode = (m: AuthMode) => {
  authMode.value = m;
  authMessage.value = '';
  // 切换模式时清空密码相关字段，防止登录与注册页之间密码同步
  authForm.value.password = '';
  authForm.value.confirmPassword = '';
};

const showAuthMessage = (text: string, tone: 'error' | 'success' = 'error') => {
  authMessageTone.value = tone;
  authMessage.value = text;
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

const handleSendCode = async () => {
  const email = authForm.value.email;
  if (!email) {
    showAuthMessage('请先填写邮箱');
    return;
  }
  const type: VerifyCodeType = 'register';
  const captchaPayload = await requestHumanCaptcha(
    '发送验证码前验证',
    '完成验证后将向邮箱发送验证码。',
  );
  if (!captchaPayload) return;
  codeLoading.value = true;
  authMessage.value = '';
  try {
    const result = await sendEmailCode(email, type, captchaPayload, authForm.value.account.trim() || undefined);
    showAuthMessage(result.message || '验证码已发送到邮箱', 'success');
    showToast(result.message || '验证码已发送到邮箱', 'success');
    startCodeCountdown();
  } catch (error) {
    const tip = error instanceof Error ? error.message : '验证码发送失败';
    showAuthMessage(tip);
    showToast(tip, 'error');
  } finally {
    codeLoading.value = false;
  }
};

const handleAuthSubmit = async () => {
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
  authLoading.value = true;
  authMessage.value = '';
  try {
    const result =
      authMode.value === 'login'
        ? await login(authForm.value.account, authForm.value.password, captchaPayload)
        : await register(
            authForm.value.account.trim(),
            authForm.value.nickname.trim(),
            authForm.value.password,
            authForm.value.email,
            authForm.value.code,
            captchaPayload,
          );

    authStore.setAuth(result);
    authForm.value = { account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' };
    showAuthMessage(authMode.value === 'login' ? '登录成功' : '注册成功', 'success');
    showToast(authMode.value === 'login' ? '登录成功' : '注册成功', 'success');
    // 登录成功后稍作停留再完成
    if (authCompleteTimer) {
      clearTimeout(authCompleteTimer);
    }
    authCompleteTimer = setTimeout(() => {
      authCompleteTimer = null;
      handleComplete();
    }, 600);
  } catch (error) {
    const tip = error instanceof Error ? error.message : '登录/注册失败，请检查后端接口';
    showAuthMessage(tip);
    showToast(tip, 'error');
  } finally {
    authLoading.value = false;
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

const clearSplashTimers = () => {
  if (splashHintTimer) {
    clearTimeout(splashHintTimer);
    splashHintTimer = null;
  }
  if (splashAutoAdvanceTimer) {
    clearTimeout(splashAutoAdvanceTimer);
    splashAutoAdvanceTimer = null;
  }
};

const clearAuthCompleteTimer = () => {
  if (authCompleteTimer) {
    clearTimeout(authCompleteTimer);
    authCompleteTimer = null;
  }
};

const continueFromSplash = () => {
  if (step.value !== 'splash') return;
  clearSplashTimers();
  nextStep();
};

// --- 启动画面计时 ---
const startSplashTimers = () => {
  clearSplashTimers();
  splashHintTimer = setTimeout(() => {
    splashHintVisible.value = true;
  }, SPLASH_HINT_DELAY);
  splashAutoAdvanceTimer = setTimeout(continueFromSplash, SPLASH_AUTO_ADVANCE_DELAY);
};

watch(
  () => props.visible,
  val => {
    if (val) {
      step.value = 'splash';
      showPluginManager.value = false;
      pluginManagerVisited.value = false;
      stepContentHidden.value = false;
      splashVisible.value = true;
      splashHintVisible.value = false;
      startSplashTimers();
    } else {
      clearSplashTimers();
    }
  },
);

onMounted(() => {
  if (props.visible) startSplashTimers();
  void loadUserAgreement();
});

onUnmounted(() => {
  clearSplashTimers();
  clearAuthCompleteTimer();
});
</script>

<template>
  <Teleport to="body">
    <transition name="onboarding-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9998] flex flex-col overflow-hidden transition-colors duration-300"
        :class="onboardingSurfaceClass"
      >
        <!-- 初始化流程会覆盖主标题栏，因此在顶部中央保留独立的原生窗口拖动区域。 -->
        <div
          data-tauri-drag-region
          class="absolute left-1/4 right-1/4 top-0 z-[70] h-10"
          aria-hidden="true"
          @click.stop
        ></div>

        <!-- 启动画面 -->
        <transition name="splash-fade">
          <div
            v-if="step === 'splash'"
            class="absolute inset-0 flex cursor-pointer select-none flex-col items-center justify-center text-center px-[clamp(1.5rem,4vw,4rem)]"
            @click="continueFromSplash"
          >
            <transition name="splash-title">
              <div v-if="splashVisible" class="flex flex-col items-center">
                <h1
                  class="font-black tracking-tight text-black dark:text-white leading-none"
                  style="font-size: clamp(64px, 10vw, 160px);"
                >
                  弦予音乐
                </h1>
                <div
                  class="mt-6 font-light tracking-[0.5em] text-black/50 dark:text-white/50 uppercase"
                  style="font-size: clamp(28px, 3.5vw, 48px);"
                >
                  XY Music
                </div>
                <div
                  class="mt-[clamp(2.5rem,5vh,4rem)] font-light text-black/75 dark:text-white/75"
                  style="font-size: clamp(28px, 2.8vw, 40px);"
                >
                  将音乐给予你
                </div>
              </div>
            </transition>

            <transition name="splash-hint">
              <div
                v-if="splashHintVisible"
                class="absolute flex flex-col items-center gap-3"
                style="bottom: clamp(40px, 8vh, 80px);"
              >
                <div
                  class="text-black/60 dark:text-white/60 font-light tracking-wide"
                  style="font-size: clamp(20px, 1.6vw, 26px);"
                >
                  点击任意位置以继续
                </div>
              </div>
            </transition>
          </div>
        </transition>

        <!-- 步骤内容 -->
        <transition name="step-fade" mode="out-in">
          <div
            v-if="step !== 'splash'"
            :key="step"
            class="relative w-full h-full flex flex-col"
            :class="{ 'invisible pointer-events-none': stepContentHidden }"
          >
            <!-- 顶部栏：左上角品牌 + 右上角进度 -->
            <header
              class="flex items-center justify-between px-[clamp(2rem,4vw,4rem)] py-[clamp(1.5rem,3vh,2.5rem)]"
            >
              <div class="flex items-center gap-3">
                <span
                  class="font-black tracking-tight text-black dark:text-white"
                  style="font-size: clamp(18px, 1.5vw, 22px);"
                >
                  弦予音乐
                </span>
                <span class="text-black/20 dark:text-white/20">/</span>
                <span
                  class="text-black/50 dark:text-white/50 font-light tracking-wide"
                  style="font-size: clamp(13px, 1vw, 15px);"
                >
                  初次设置
                </span>
              </div>
              <div class="flex items-center gap-2">
                <template v-for="s in steps" :key="s.key">
                  <div
                    class="rounded-full transition-all duration-500"
                    :class="s.key === step
                      ? 'w-8 bg-[#EC4141]'
                      : steps.findIndex(x => x.key === step) > steps.findIndex(x => x.key === s.key)
                        ? 'w-3 bg-[#EC4141]/40'
                        : 'w-3 bg-black/10 dark:bg-white/10'"
                    style="height: 3px;"
                  ></div>
                </template>
                <span
                  class="ml-3 text-black/40 dark:text-white/40 tabular-nums font-light"
                  style="font-size: clamp(11px, 0.9vw, 13px);"
                >
                  {{ currentStepIndex }} / {{ totalSteps }}
                </span>
              </div>
            </header>

            <!-- 主内容区：垂直居中 -->
            <main class="flex-1 overflow-y-auto lg:overflow-hidden custom-scrollbar">
              <div class="max-w-6xl mx-auto min-h-full lg:h-full px-[clamp(2rem,5vw,5rem)] py-[clamp(1rem,3vh,3rem)] flex flex-col justify-center lg:block">

                <!-- 步骤 1: 主题 -->
                <transition name="step-content" mode="out-in">
                  <div v-if="step === 'theme'" key="theme" class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-[clamp(2rem,5vw,5rem)] items-center lg:items-stretch lg:h-full lg:overflow-hidden">
                    <header class="lg:flex lg:flex-col lg:justify-center">
                      <p
                        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
                        style="font-size: clamp(14px, 1.2vw, 18px);"
                      >
                        外观主题
                      </p>
                      <h2
                        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
                        style="font-size: clamp(48px, 7vw, 96px);"
                      >
                        主题
                      </h2>
                      <p
                        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-md"
                        style="font-size: clamp(14px, 1.1vw, 17px);"
                      >
                        可在设置中随时更改。浅色模式明亮清新，深色模式护眼沉浸，跟随系统自动适应，自定义支持个性化皮肤。
                      </p>
                    </header>

                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-[clamp(0.75rem,1.5vw,1.5rem)] lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:content-center">
                      <button
                        v-for="opt in [
                          { value: 'light', label: '浅色模式', desc: '明亮清新' },
                          { value: 'dark', label: '深色模式', desc: '护眼沉浸' },
                          { value: 'system', label: '跟随系统', desc: '自动适应' },
                          { value: 'custom', label: '自定义', desc: '个性化皮肤' },
                        ]"
                        :key="opt.value"
                        type="button"
                        class="group relative flex flex-col items-start gap-[clamp(1rem,2vh,1.5rem)] pb-[clamp(1rem,2vh,1.5rem)] transition-all text-left"
                        :class="colorScheme === opt.value
                          ? 'border-b-2 border-[#EC4141]'
                          : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50'"
                        @click="opt.value === 'custom' ? handleCustomThemeClick() : setColorScheme(opt.value as 'dark' | 'light' | 'system')"
                      >
                        <div
                          class="w-[clamp(56px,7vw,84px)] h-[clamp(56px,7vw,84px)] rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 border border-black/10 dark:border-white/10"
                          :class="opt.value === 'dark'
                            ? 'bg-black dark:bg-white'
                            : opt.value === 'light'
                              ? 'bg-white dark:bg-black'
                              : opt.value === 'system'
                                ? 'bg-gray-100 dark:bg-gray-800'
                                : 'bg-black dark:bg-white'"
                        >
                          <svg
                            v-if="opt.value === 'dark'"
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-white dark:text-black"
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          ><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                          <svg
                            v-else-if="opt.value === 'system'"
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-black/70 dark:text-white/70"
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          ><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                          <svg
                            v-else-if="opt.value === 'light'"
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-black dark:text-white"
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          ><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                          <svg
                            v-else
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-[clamp(28px,3.5vw,42px)] w-[clamp(28px,3.5vw,42px)] text-white dark:text-black"
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          ><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"></path></svg>
                        </div>
                        <div>
                          <div
                            class="font-semibold"
                            :class="colorScheme === opt.value ? 'text-[#EC4141]' : 'text-black dark:text-white'"
                            style="font-size: clamp(16px, 1.4vw, 22px);"
                          >
                            {{ opt.label }}
                          </div>
                          <div
                            class="text-black/40 dark:text-white/40 font-light mt-1"
                            style="font-size: clamp(11px, 0.9vw, 14px);"
                          >
                            {{ opt.desc }}
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <!-- 步骤 2: 窗口材质 -->
                  <div v-else-if="step === 'material'" key="material" class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-[clamp(2rem,5vw,5rem)] items-center lg:items-stretch lg:h-full lg:overflow-hidden">
                    <header class="lg:flex lg:flex-col lg:justify-center">
                      <p
                        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
                        style="font-size: clamp(14px, 1.2vw, 18px);"
                      >
                        窗口材质
                      </p>
                      <h2
                        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
                        style="font-size: clamp(48px, 7vw, 96px);"
                      >
                        材质
                      </h2>
                      <p
                        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-md"
                        style="font-size: clamp(14px, 1.1vw, 17px);"
                      >
                        影响窗口背景的视觉效果，可在设置中随时更改。Mica 与 Acrylic 仅 Windows 11 可用。
                      </p>
                    </header>

                    <div class="grid grid-cols-2 gap-[clamp(1rem,2vw,2rem)] lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:content-center">
                      <button
                        type="button"
                        class="group relative flex cursor-pointer items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
                        :class="materialMode === 'none'
                          ? 'border-b-2 border-[#EC4141]'
                          : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50'"
                        @click="selectWindowMaterial('none')"
                      >
                        <div
                          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-transform group-hover:scale-105"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/60 dark:text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect></svg>
                        </div>
                        <div>
                          <div
                            class="font-semibold"
                            :class="materialMode === 'none' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
                            style="font-size: clamp(18px, 1.5vw, 24px);"
                          >
                            默认
                          </div>
                          <div
                            class="text-black/40 dark:text-white/40 font-light mt-1"
                            style="font-size: clamp(12px, 1vw, 14px);"
                          >
                            无透明效果
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        class="group relative flex items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
                        :class="[
                          materialMode === 'mica'
                            ? 'border-b-2 border-[#EC4141]'
                            : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50',
                          isWindowMaterialButtonDisabled('mica') ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
                        ]"
                        :disabled="isWindowMaterialButtonDisabled('mica')"
                        @click="selectWindowMaterial('mica')"
                      >
                        <div
                          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur flex items-center justify-center border border-black/10 dark:border-white/10 transition-transform group-hover:scale-105"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/70 dark:text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>
                        </div>
                        <div>
                          <div
                            class="font-semibold"
                            :class="materialMode === 'mica' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
                            style="font-size: clamp(18px, 1.5vw, 24px);"
                          >
                            Mica
                          </div>
                          <div
                            class="text-black/40 dark:text-white/40 font-light mt-1"
                            style="font-size: clamp(12px, 1vw, 14px);"
                          >
                            {{ isWindows11 ? '云母材质' : '仅 Win11' }}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        class="group relative flex items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
                        :class="[
                          materialMode === 'acrylic'
                            ? 'border-b-2 border-[#EC4141]'
                            : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50',
                          isWindowMaterialButtonDisabled('acrylic') ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
                        ]"
                        :disabled="isWindowMaterialButtonDisabled('acrylic')"
                        @click="selectWindowMaterial('acrylic')"
                      >
                        <div
                          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur-md flex items-center justify-center border border-black/10 dark:border-white/10 transition-transform group-hover:scale-105"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/70 dark:text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </div>
                        <div>
                          <div
                            class="font-semibold"
                            :class="materialMode === 'acrylic' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
                            style="font-size: clamp(18px, 1.5vw, 24px);"
                          >
                            Acrylic
                          </div>
                          <div
                            class="text-black/40 dark:text-white/40 font-light mt-1"
                            style="font-size: clamp(12px, 1vw, 14px);"
                          >
                            {{ isWindows11 ? '亚克力半透明' : '仅 Win11' }}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        class="group relative flex items-center gap-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(1.25rem,2vh,1.75rem)] transition-all text-left"
                        :class="[
                          materialMode === 'blur'
                            ? 'border-b-2 border-[#EC4141]'
                            : 'border-b border-black/10 dark:border-white/10 hover:border-[#EC4141]/50',
                          isWindowMaterialButtonDisabled('blur') ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
                        ]"
                        :disabled="isWindowMaterialButtonDisabled('blur')"
                        @click="selectWindowMaterial('blur')"
                      >
                        <div
                          class="w-[clamp(48px,6vw,72px)] h-[clamp(48px,6vw,72px)] rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur-lg flex items-center justify-center border border-black/10 dark:border-white/10 transition-transform group-hover:scale-105"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-[clamp(24px,3vw,36px)] w-[clamp(24px,3vw,36px)] text-black/70 dark:text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>
                        </div>
                        <div>
                          <div
                            class="font-semibold"
                            :class="materialMode === 'blur' ? 'text-[#EC4141]' : 'text-black dark:text-white'"
                            style="font-size: clamp(18px, 1.5vw, 24px);"
                          >
                            Blur
                          </div>
                          <div
                            class="text-black/40 dark:text-white/40 font-light mt-1"
                            style="font-size: clamp(12px, 1vw, 14px);"
                          >
                            高斯模糊背景
                          </div>
                        </div>
                      </button>
                    </div>

                    <label
                      class="mt-[clamp(0.75rem,1.5vw,1.25rem)] flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-black/8 dark:border-white/8 px-[clamp(0.75rem,1.5vw,1rem)] py-[clamp(0.625rem,1vw,0.875rem)] transition-all"
                      :class="materialMode === 'none'
                        ? 'cursor-not-allowed opacity-40'
                        : 'hover:border-[#EC4141]/30 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'"
                    >
                      <div class="flex flex-col gap-1">
                        <span
                          class="font-medium text-black/80 dark:text-white/80"
                          style="font-size: clamp(14px, 1.1vw, 16px);"
                        >保持材质</span>
                        <span
                          class="text-black/40 dark:text-white/40 font-light"
                          style="font-size: clamp(11px, 0.9vw, 13px);"
                        >开启后窗口失焦时不会卸载材质，避免切换时的闪烁</span>
                      </div>
                      <span class="flex items-center shrink-0">
                        <input
                          type="checkbox"
                          class="sr-only"
                          :checked="keepWindowMaterialOnBlur"
                          :disabled="materialMode === 'none'"
                          @change="setKeepWindowMaterialOnBlur(($event.target as HTMLInputElement).checked)"
                        />
                        <span
                          class="relative h-6 w-11 rounded-full transition-colors"
                          :class="keepWindowMaterialOnBlur && materialMode !== 'none' ? 'bg-[#EC4141]' : 'bg-black/15 dark:bg-white/20'"
                        >
                          <span
                            class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                            :class="keepWindowMaterialOnBlur && materialMode !== 'none' ? 'translate-x-5' : ''"
                          ></span>
                        </span>
                      </span>
                    </label>
                  </div>

                  <!-- 步骤 3: 快捷键 -->
                  <div v-else-if="step === 'shortcuts'" key="shortcuts" class="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-[clamp(2rem,5vw,5rem)] items-start lg:items-stretch lg:h-full lg:overflow-hidden">
                    <header class="lg:flex lg:flex-col lg:justify-center">
                      <p
                        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
                        style="font-size: clamp(14px, 1.2vw, 18px);"
                      >
                        快捷键
                      </p>
                      <h2
                        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
                        style="font-size: clamp(40px, 6vw, 80px);"
                      >
                        快捷键
                      </h2>
                      <p
                        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-sm"
                        style="font-size: clamp(13px, 1vw, 16px);"
                      >
                        点击按钮后按键录入，Esc 取消，Backspace 清空。
                      </p>
                      <button
                        type="button"
                        class="mt-6 text-black/50 dark:text-white/50 hover:text-[#EC4141] font-medium tracking-wide transition"
                        style="font-size: clamp(12px, 1vw, 14px);"
                        @click="restoreDefaultShortcuts"
                      >
                        恢复默认
                      </button>
                    </header>

                    <div class="border-t border-black/10 dark:border-white/10 lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:flex lg:flex-col lg:justify-center">
                      <div
                        class="py-3 grid grid-cols-[minmax(0,1.2fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-4 text-black/40 dark:text-white/40 font-light uppercase tracking-wider border-b border-black/10 dark:border-white/10"
                        style="font-size: clamp(10px, 0.85vw, 12px);"
                      >
                        <div>功能</div>
                        <div>窗口内</div>
                        <div>全局</div>
                      </div>

                      <div
                        v-for="row in shortcutRows"
                        :key="row.actionId"
                        class="py-[clamp(0.75rem,1.5vh,1.25rem)] border-b border-black/5 dark:border-white/5 last:border-0 grid grid-cols-[minmax(0,1.2fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-4 items-center"
                      >
                        <div
                          class="font-medium text-black dark:text-white truncate"
                          style="font-size: clamp(14px, 1.1vw, 17px);"
                        >
                          {{ row.label }}
                        </div>
                        <button
                          type="button"
                          @click="startCapture('local', row.actionId)"
                          @blur="isCapturing('local', row.actionId) && stopCapture()"
                          @keydown="handleShortcutCapture('local', row.actionId, $event)"
                          class="w-full text-left border-b transition-all bg-transparent"
                          :class="isCapturing('local', row.actionId)
                            ? 'border-[#EC4141] text-[#EC4141]'
                            : 'border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 hover:border-[#EC4141]/50'"
                          style="font-size: clamp(13px, 1vw, 15px); padding: 8px 4px;"
                        >
                          {{ isCapturing('local', row.actionId) ? '按下新键…' : (formatShortcutBinding(row.localBinding) || '未设置') }}
                        </button>
                        <button
                          type="button"
                          @click="startCapture('global', row.actionId)"
                          @blur="isCapturing('global', row.actionId) && stopCapture()"
                          @keydown="handleShortcutCapture('global', row.actionId, $event)"
                          class="w-full text-left border-b transition-all bg-transparent"
                          :class="isCapturing('global', row.actionId)
                            ? 'border-[#EC4141] text-[#EC4141]'
                            : 'border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 hover:border-[#EC4141]/50'"
                          style="font-size: clamp(13px, 1vw, 15px); padding: 8px 4px;"
                        >
                          {{ isCapturing('global', row.actionId) ? '按下新键…' : (formatShortcutBinding(row.globalBinding) || '未设置') }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 步骤 4: 插件管理 -->
                  <div v-else-if="step === 'plugins'" key="plugins" class="grid grid-cols-1 lg:grid-cols-[1fr_1.45fr] gap-[clamp(2rem,5vw,5rem)] items-center lg:items-stretch lg:h-full lg:overflow-hidden">
                    <header class="lg:flex lg:flex-col lg:justify-center">
                      <p
                        class="text-black/60 dark:text-white/60 font-light tracking-wider mb-4"
                        style="font-size: clamp(14px, 1.2vw, 18px);"
                      >
                        插件管理
                      </p>
                      <h2
                        class="text-black dark:text-white font-black tracking-tight leading-[0.95]"
                        style="font-size: clamp(40px, 6vw, 80px);"
                      >
                        音乐来源
                      </h2>
                      <p
                        class="mt-6 text-black/50 dark:text-white/50 font-light max-w-sm"
                        style="font-size: clamp(13px, 1vw, 16px);"
                      >
                        安装插件后，可以搜索和播放更多在线音乐。也可以稍后前往设置中的插件管理添加。
                      </p>
                    </header>

                    <div class="border-t border-black/10 dark:border-white/10 lg:overflow-y-auto lg:custom-scrollbar lg:min-h-0 lg:flex lg:flex-col lg:justify-center">
                      <div class="grid grid-cols-1 sm:grid-cols-3 border-b border-black/10 dark:border-white/10">
                        <div class="py-5 sm:pr-5">
                          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
                          </div>
                          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(14px, 1.1vw, 17px);">本地文件</div>
                          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(11px, 0.9vw, 13px);">导入 JS 或 JSON 插件</div>
                        </div>
                        <div class="py-5 sm:px-5">
                          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>
                          </div>
                          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(14px, 1.1vw, 17px);">网络链接</div>
                          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(11px, 0.9vw, 13px);">通过插件地址安装</div>
                        </div>
                        <div class="py-5 sm:pl-5">
                          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="m15 5-3 3-3-3"/><rect width="18" height="12" x="3" y="10" rx="2"/><path d="M7 14h.01"/><path d="M11 14h6"/></svg>
                          </div>
                          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(14px, 1.1vw, 17px);">订阅管理</div>
                          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(11px, 0.9vw, 13px);">批量同步多个来源</div>
                        </div>
                      </div>

                      <div class="flex items-center justify-between gap-5 py-6">
                        <div>
                          <div class="font-semibold text-black dark:text-white" style="font-size: clamp(15px, 1.2vw, 18px);">添加或管理插件</div>
                          <div class="mt-1 text-black/45 dark:text-white/45 font-light" style="font-size: clamp(12px, 0.9vw, 14px);">安装、启停、更新或移除已有插件</div>
                        </div>
                        <button
                          type="button"
                          class="shrink-0 rounded-full bg-[#EC4141] px-[clamp(1.5rem,2.5vw,2.5rem)] py-3 font-medium text-white transition hover:bg-red-600 active:scale-95"
                          style="font-size: clamp(13px, 1vw, 15px);"
                          @click="openPluginManager"
                        >
                          添加或管理插件
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 步骤 5: 账号（搬自 Auth.vue 登录注册 UI）-->
                  <div v-else-if="step === 'account'" key="account" class="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-[clamp(2rem,5vw,5rem)] items-start lg:items-stretch lg:h-full lg:overflow-hidden">
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
                      <!-- 已登录：直接展示当前账号信息，不再显示登录/注册表单 -->
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
                      <!-- 顶部标签 -->
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

                      <!-- 模式切换 -->
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

                      <!-- 表单 -->
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
                            <input
                              v-model="authForm.password"
                              type="password"
                              placeholder="请输入密码"
                              :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
                              required
                              class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                              style="font-size: clamp(15px, 1.3vw, 18px);"
                            />
                          </label>

                          <label v-if="authMode === 'register'" class="grid gap-3">
                            <span
                              class="text-black/70 dark:text-white/70 font-light tracking-wider"
                              style="font-size: clamp(13px, 1.1vw, 16px);"
                            >确认密码</span>
                            <input
                              v-model="authForm.confirmPassword"
                              type="password"
                              placeholder="再次输入密码"
                              autocomplete="new-password"
                              required
                              class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                              style="font-size: clamp(15px, 1.3vw, 18px);"
                            />
                          </label>

                          <!-- 用户协议勾选 -->
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

                          <!-- 消息条 -->
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
                  </div>
                </transition>
              </div>
            </main>

            <!-- 底部操作栏 -->
            <footer
              class="flex items-center justify-between px-[clamp(2rem,4vw,4rem)] py-[clamp(1.25rem,2.5vh,2rem)]"
            >
              <!-- 左下角：始终是"暂不进行初始化设置" -->
              <button
                type="button"
                class="text-black/70 dark:text-white/70 hover:text-[#EC4141] font-medium tracking-wide transition"
                style="font-size: clamp(14px, 1.1vw, 17px);"
                @click="skipRest"
              >
                暂不进行初始化设置
              </button>

              <!-- 右下角：上一步 + 下一步/完成 -->
              <div class="flex items-center gap-[clamp(1rem,2vw,2rem)]">
                <button
                  v-if="step !== 'theme'"
                  type="button"
                  class="text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white font-semibold tracking-wide transition px-2 py-1"
                  style="font-size: clamp(14px, 1.1vw, 17px);"
                  @click="prevStep"
                >
                  上一步
                </button>
                <button
                  v-if="step !== 'account'"
                  type="button"
                  class="px-[clamp(1.75rem,2.5vw,2.75rem)] py-[clamp(0.75rem,1.2vh,1rem)] bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition"
                  style="font-size: clamp(14px, 1.1vw, 17px); border-radius: 999px;"
                  @click="nextStep"
                >
                  {{ step === 'plugins' ? (pluginManagerVisited ? '继续' : '稍后添加') : '下一步' }}
                </button>
                <button
                  v-else
                  type="button"
                  class="px-[clamp(2.25rem,3vw,3.25rem)] py-[clamp(0.75rem,1.2vh,1rem)] bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition"
                  style="font-size: clamp(15px, 1.2vw, 18px); border-radius: 999px;"
                  @click="handleComplete"
                >
                  完成
                </button>
              </div>
            </footer>

            <!-- 未登录二次确认对话框 -->
            <transition name="confirm-fade">
              <div
                v-if="showLoginConfirm"
                class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                @click.self="cancelSkipLogin"
              >
                <div
                  class="bg-white/80 dark:bg-gray-900/90 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 px-8 py-7 max-w-sm w-[90%] text-center"
                >
                  <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EC4141]/10 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#EC4141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3
                    class="font-bold text-black dark:text-white mb-2"
                    style="font-size: clamp(17px, 1.4vw, 21px);"
                  >
                    您尚未登陆账号，是否继续？
                  </h3>
                  <p
                    class="text-black/50 dark:text-white/50 font-light mb-6"
                    style="font-size: clamp(12px, 1vw, 14px);"
                  >
                    未登录将无法同步您的歌单和插件配置
                  </p>
                  <div class="flex gap-3 justify-center">
                    <button
                      type="button"
                      class="px-6 py-2.5 rounded-full border border-black/15 dark:border-white/15 text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 font-medium tracking-wide transition"
                      style="font-size: clamp(13px, 1vw, 15px);"
                      @click="confirmSkipLogin"
                    >
                      暂不登录
                    </button>
                    <button
                      type="button"
                      class="px-7 py-2.5 rounded-full bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition shadow-sm"
                      style="font-size: clamp(13px, 1vw, 15px);"
                      @click="cancelSkipLogin"
                    >
                      登录
                    </button>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </transition>

        <!-- 初始化期间的插件管理层：按需加载并复用设置中的完整插件管理能力 -->
        <transition name="step-fade" @after-leave="onPluginManagerClosed">
          <div
            v-if="showPluginManager"
            data-onboarding-plugin-manager-surface
            class="absolute inset-0 z-[60] flex flex-col overflow-hidden"
            :class="onboardingSurfaceClass"
          >
            <header class="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-[clamp(2rem,4vw,4rem)] py-[clamp(1.25rem,2.5vh,2rem)]">
              <div>
                <div class="text-black/45 dark:text-white/45 font-light tracking-wider" style="font-size: clamp(11px, 0.9vw, 13px);">初次设置</div>
                <h2 class="mt-1 font-black tracking-tight text-black dark:text-white" style="font-size: clamp(22px, 2.2vw, 32px);">插件管理</h2>
              </div>
              <button
                type="button"
                class="rounded-full bg-[#EC4141] px-[clamp(1.5rem,2.5vw,2.5rem)] py-3 font-medium text-white transition hover:bg-red-600 active:scale-95"
                style="font-size: clamp(13px, 1vw, 15px);"
                @click="closePluginManager"
              >
                完成管理
              </button>
            </header>
            <main class="custom-scrollbar flex-1 overflow-y-auto">
              <div class="mx-auto w-full max-w-6xl px-[clamp(2rem,5vw,5rem)] py-[clamp(1.5rem,4vh,3.5rem)]">
                <Suspense>
                  <SettingsPlugins overlay-z-class="z-[10000]" />
                  <template #fallback>
                    <div class="flex min-h-64 items-center justify-center text-black/45 dark:text-white/45 font-light">正在加载插件管理…</div>
                  </template>
                </Suspense>
              </div>
            </main>
          </div>
        </transition>

        <!-- "暂不支持自定义"提示弹窗 -->
        <transition name="confirm-fade">
          <div
            v-if="showCustomUnsupported"
            class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            @click.self="showCustomUnsupported = false"
          >
            <div
              class="bg-white/80 dark:bg-gray-900/90 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 px-8 py-7 max-w-sm w-[90%] text-center"
            >
              <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EC4141]/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#EC4141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3
                class="font-bold text-black dark:text-white mb-2"
                style="font-size: clamp(17px, 1.4vw, 21px);"
              >
                暂不支持此选项
              </h3>
              <p
                class="text-black/50 dark:text-white/50 font-light mb-6"
                style="font-size: clamp(13px, 1vw, 15px);"
              >
                请前往 设置 → 外观 自行修改
              </p>
              <div class="flex gap-3 justify-center">
                <button
                  type="button"
                  class="px-7 py-2.5 rounded-full bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition shadow-sm"
                  style="font-size: clamp(13px, 1vw, 15px);"
                  @click="showCustomUnsupported = false"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </Teleport>

  <!-- 用户协议弹窗 -->
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
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
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

/* 整体淡入 */
.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
  transition: opacity 0.4s ease;
}
.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}

/* 启动画面淡入淡出 */
.splash-fade-enter-active,
.splash-fade-leave-active {
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.splash-fade-enter-from,
.splash-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.splash-title-enter-active {
  transition: opacity 0.8s ease, transform 0.8s cubic-bezier(0.22, 1, 0.36, 1);
}
.splash-title-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.splash-hint-enter-active {
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.splash-hint-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

/* 步骤切换 */
.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.step-fade-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.step-fade-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* 步骤内容切换 */
.step-content-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.step-content-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.step-content-leave-active {
  transition: opacity 0.2s ease;
}
.step-content-leave-to {
  opacity: 0;
}

/* 登录/注册表单切换动画 */
.auth-mode-enter-active,
.auth-mode-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.auth-mode-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.auth-mode-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* 未登录二次确认对话框 */
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.25s ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
.confirm-fade-enter-active > div,
.confirm-fade-leave-active > div {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;
}
.confirm-fade-enter-from > div,
.confirm-fade-leave-to > div {
  opacity: 0;
  transform: scale(0.92);
}

/* 用户协议弹窗 */
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
  background: transparent;
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

/* 弹窗过渡动画 */
.avatar-modal-enter-active .terms-card,
.avatar-modal-leave-active .terms-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.avatar-modal-enter-from .terms-card,
.avatar-modal-leave-to .terms-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

/* 深色模式 */
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
