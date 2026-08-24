<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Eye, EyeOff } from 'lucide-vue-next';

import { useAuthStore } from '../features/auth/store';
import HumanCaptchaModal from '../components/common/HumanCaptchaModal.vue';
import { downloadApi } from '../services/tauri/downloadApi';
import { useCollectionsStore } from '../features/collections/store';
import { useToast } from '../composables/toast';
import { useUiStore } from '../shared/stores/ui';
import { showProfileLimitDialog, type ProfileLimitDialogTarget } from '../composables/useProfileLimitDialog';
import {
  getProfile,
  login,
  logout,
  register,
  resetPassword,
  sendEmailCode,
  updateProfile,
  uploadAvatar,
  updateCiyuanxiId,
  bindEmail,
  getAvatarStatus,
  getNicknameStatus,
  getAvatarChangeLimitStatus,
  getNicknameChangeLimitStatus,
  getUserAgreement,
  type AuthMode,
  type HumanCaptchaPayload,
  type ProfileStats,
  type VerifyCodeType,
} from '../services/auth/authService';

const router = useRouter();
const authStore = useAuthStore();
const collectionsStore = useCollectionsStore();
const { showToast } = useToast();
const uiStore = useUiStore();

const mode = ref<AuthMode>('login');
const form = ref({ account: '', nickname: '', email: '', password: '', confirmPassword: '', code: '' });
const forgotForm = ref({ email: '', code: '', newPassword: '', confirmPassword: '' });
const fieldErrors = ref<Record<string, string>>({});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 各密码输入框的明文可见状态（自定义"查看密码"按钮，替代不可靠的浏览器原生眼睛图标） */
const pwdVisible = reactive<Record<string, boolean>>({});

/** 各密码输入框的聚焦状态：小眼睛仅在"聚焦且有内容"时显示，失焦消失（可反复重现） */
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
    case 'email':
      if (mode.value === 'register') {
        const val = form.value.email.trim();
        if (!val) error = '请填写邮箱';
        else if (!EMAIL_RE.test(val)) error = '邮箱格式不正确';
      }
      break;
    case 'code':
      if (mode.value === 'register' && !form.value.code.trim()) error = '请填写验证码';
      break;
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
const agreementAccepted = ref(false);
const termsModalOpen = ref(false);
const termsScrolledToEnd = ref(false);
const termsBodyRef = ref<HTMLElement | null>(null);
const agreementTitle = ref('弦予音乐用户协议');
const captchaModalOpen = ref(false);
const captchaModalTitle = ref('人机验证');
const captchaModalDescription = ref('请先完成验证，验证通过后将继续当前操作。');
let captchaResolver: ((payload: HumanCaptchaPayload | null) => void) | null = null;
const stats = ref<ProfileStats | null>(null);
const nicknameDraft = ref('');
const avatarDraft = ref('');
const avatarUploading = ref(false);
// 头像审核状态：none 无待处理 / pending 审核中 / rejected 审核未通过
const avatarStatus = ref<'none' | 'pending' | 'rejected'>('none');
const nicknameStatus = ref<'none' | 'pending' | 'rejected'>('none');
// 头像弹窗定位
const avatarMenuPos = ref<{ top: number; left: number } | null>(null);
const avatarBtnRef = ref<HTMLElement | null>(null);

async function confirmProfileLimit(target: ProfileLimitDialogTarget): Promise<boolean> {
  const localStatus = target === 'avatar' ? avatarStatus.value : nicknameStatus.value;
  const limit = target === 'avatar'
    ? await getAvatarChangeLimitStatus()
    : await getNicknameChangeLimitStatus();
  if (target === 'avatar') {
    avatarStatus.value = limit.status;
  } else {
    nicknameStatus.value = limit.status;
  }
  const blocked = limit.todayBlocked || limit.status === 'pending' || localStatus === 'pending';
  if (blocked) {
    const fallback = target === 'avatar'
      ? (limit.status === 'pending' || localStatus === 'pending' ? '头像正在审核中哦' : '今日已修改过啦')
      : (limit.status === 'pending' || localStatus === 'pending' ? '昵称正在审核中哦' : '今日已修改过啦');
    await showProfileLimitDialog(target, {
      blocked: true,
      message: limit.blockMessage || fallback,
    });
    return false;
  }
  return showProfileLimitDialog(target);
}

function openAvatarMenu() {
  const el = avatarBtnRef.value;
  if (!el) {
    avatarMenuOpen.value = true;
    return;
  }
  const rect = el.getBoundingClientRect();
  const cardWidth = Math.min(window.innerWidth * 0.86, 320);
  const gap = 12;
  // 默认放在头像右下方
  let left = rect.right + gap;
  let top = rect.top;
  // 右侧放不下则放左侧
  if (left + cardWidth > window.innerWidth - 8) {
    left = rect.left - cardWidth - gap;
  }
  // 左侧也放不下则贴左边
  if (left < 8) {
    left = 8;
  }
  // 下方溢出则向上对齐底部
  if (top + 200 > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - 220);
  }
  avatarMenuPos.value = { top, left };
  avatarMenuOpen.value = true;
}
// 昵称弹窗修改
const showNicknameModal = ref(false);
const nicknameInputRef = ref<HTMLInputElement | null>(null);

async function openNicknameEditModal() {
  // 改名审核中时禁止再次编辑
  if (nicknameStatus.value === 'pending') {
    await showProfileLimitDialog('nickname', {
      blocked: true,
      message: '昵称正在审核中哦',
    });
    return;
  }
  nicknameDraft.value = authStore.user?.nickname || authStore.user?.username || '';
  showNicknameModal.value = true;
  await nextTick();
  nicknameInputRef.value?.focus();
  nicknameInputRef.value?.select();
}

async function submitNicknameEdit() {
  const next = nicknameDraft.value.trim();
  const current = authStore.user?.nickname || authStore.user?.username || '';
  if (!next || next === current) {
    showNicknameModal.value = false;
    return;
  }
  if (next.length > 20) {
    showToast('昵称最多 20 个字符', 'error');
    return;
  }
  if (!/^[a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+$/.test(next)) {
    showToast('昵称仅支持字母、数字、汉字', 'error');
    return;
  }
  if (!await confirmProfileLimit('nickname')) return;
  await handleSaveProfile();
  showNicknameModal.value = false;
}

function cancelNicknameEdit() {
  if (!showNicknameModal.value) return;
  showNicknameModal.value = false;
  nicknameDraft.value = authStore.user?.nickname || authStore.user?.username || '';
}

function onNicknameBlur() {
  // 弹窗内输入框失焦：未修改内容则关闭弹窗
  if (!showNicknameModal.value) return;
  const next = nicknameDraft.value.trim();
  const current = authStore.user?.nickname || authStore.user?.username || '';
  if (!next || next === current) {
    cancelNicknameEdit();
  }
}
const profileSaving = ref(false);

// 头像弹窗
const avatarMenuOpen = ref(false);
const avatarPreviewOpen = ref(false);
const avatarInputRef = ref<HTMLInputElement | null>(null);

type Shortcut = {
  label: string;
  desc: string;
  to: string;
  icon: 'cog' | 'theme' | 'home' | 'folder' | 'plugin';
};

const personalShortcuts: Shortcut[] = [
  { label: '账号设置', desc: '管理账号信息', to: '/settings?tab=account', icon: 'cog' },
  { label: '插件管理', desc: '管理已安装插件', to: '/settings?tab=plugins', icon: 'plugin' },
  { label: '主题外观', desc: '换肤与界面风格', to: '/settings?tab=theme', icon: 'theme' },
  { label: '本地音乐', desc: '管理本地曲库', to: '/?view=all', icon: 'folder' },
];

const meterItems: Array<{ key: keyof ProfileStats; label: string }> = [
  { key: 'favorite_count', label: '收藏' },
  { key: 'playlist_count', label: '歌单' },
  { key: 'history_count', label: '历史' },
];

const displayStats = computed((): ProfileStats => ({
  // 收藏、歌单、播放历史均为本地管理的数据，直接使用本地统计
  favorite_count: collectionsStore.favoritePaths.length,
  playlist_count: collectionsStore.playlists.length,
  starred_count: stats.value?.starred_count ?? 0,
  history_count: collectionsStore.recentSongs.length,
  listening_count: stats.value?.listening_count ?? 0,
  revision: stats.value?.revision ?? 0,
  updated_at: stats.value?.updated_at ?? null,
}));

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

const agreementContent = ref(defaultAgreementContent);

async function loadUserAgreement() {
  try {
    const agreement = await getUserAgreement();
    if (agreement.title.trim()) {
      agreementTitle.value = agreement.title.trim();
    }
    if (agreement.content.trim()) {
      agreementContent.value = agreement.content.trim();
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

function showMessage(text: string, tone: 'error' | 'success' = 'error') {
  messageTone.value = tone;
  message.value = text;
}

function requestHumanCaptcha(title: string, description: string): Promise<HumanCaptchaPayload | null> {
  captchaModalTitle.value = title;
  captchaModalDescription.value = description;
  captchaModalOpen.value = true;
  return new Promise(resolve => {
    captchaResolver = resolve;
  });
}

function resolveHumanCaptcha(payload: HumanCaptchaPayload | null) {
  captchaModalOpen.value = false;
  captchaResolver?.(payload);
  captchaResolver = null;
}

function handleCaptchaVerified(payload: HumanCaptchaPayload) {
  resolveHumanCaptcha(payload);
}

function handleCaptchaCancel() {
  resolveHumanCaptcha(null);
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
    if (!validateField('account')) {
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
        ? await login(form.value.account, form.value.password, captchaPayload)
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
  const email = isForgot ? forgotForm.value.email : form.value.email;
  if (!email) {
    showMessage('请先填写邮箱');
    return;
  }
  if (!EMAIL_RE.test(email.trim())) {
    showMessage('邮箱格式不正确');
    return;
  }
  const type: VerifyCodeType = isForgot ? 'reset_password' : 'register';
  const captchaPayload = await requestHumanCaptcha(
    '发送验证码前验证',
    '完成验证后将向邮箱发送验证码。',
  );
  if (!captchaPayload) return;
  codeLoading.value = true;
  message.value = '';
  try {
    // 注册模式下传入弦予号，服务端在发码前预检查邮箱和弦予号唯一性
    const ciyuanxiId = isForgot ? undefined : form.value.account.trim() || undefined;
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

async function handleSaveProfile() {
  const nickname = nicknameDraft.value.trim();
  if (!nickname) {
    showMessage('昵称不能为空');
    return;
  }
  profileSaving.value = true;
  message.value = '';
  try {
    const result = await updateProfile(nickname);
    if (result?.user) {
      authStore.setUser(result.user);
      // 改名走审核：不更新 nicknameDraft（保持旧名字直到审核通过）
      avatarDraft.value = result.user.avatar || '';
    }
    if (result?.nicknamePending) {
      nicknameStatus.value = 'pending';
      // 恢复显示旧名字（审核通过后才会真正更新）
      nicknameDraft.value = authStore.user?.nickname || authStore.user?.username || '';
      showToast('改名申请已提交，等待管理员审核', 'success');
    } else {
      showToast('个人信息已保存', 'success');
    }
  } catch (error) {
    const tip = error instanceof Error ? error.message : '保存失败';
    showToast(tip, 'error');
  } finally {
    profileSaving.value = false;
  }
}

async function handleAvatarFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    const tip = '请选择图片文件';
    showToast(tip, 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    const tip = '头像不能超过 5MB';
    showToast(tip, 'error');
    return;
  }

  avatarUploading.value = true;
  try {
    await uploadAvatar(file);
    // 头像已上传但需审核，不更新本地头像（保持旧头像）
    avatarStatus.value = 'pending';
    showToast('头像已上传，等待管理员审核', 'success');
  } catch (error) {
    const tip = error instanceof Error ? error.message : '头像上传失败';
    showToast(tip, 'error');
  } finally {
    avatarUploading.value = false;
  }
}

// 刷新头像审核状态：若审核已通过则重新拉取用户信息更新头像
const refreshingAvatarStatus = ref(false);
async function refreshAvatarStatus() {
  if (refreshingAvatarStatus.value) return;
  refreshingAvatarStatus.value = true;
  try {
    // 同时查询头像和改名审核状态
    const [avatarSt, nicknameSt] = await Promise.all([getAvatarStatus(), getNicknameStatus().catch(() => 'none' as const)]);
    avatarStatus.value = avatarSt;
    nicknameStatus.value = nicknameSt;

    // 如果任一审核已通过（status=none），重新拉取用户信息以获取最新数据
    if (avatarSt === 'none' || nicknameSt === 'none') {
      const profile = await getProfile();
      if (profile) {
        authStore.setUser(profile.user);
        avatarDraft.value = profile.user.avatar || '';
        nicknameDraft.value = profile.user.nickname || profile.user.username || '';
      }
      if (avatarSt === 'none' && avatarStatus.value !== 'none') {
        showToast('头像已更新', 'success');
      }
      if (nicknameSt === 'none' && nicknameStatus.value !== 'none') {
        showToast('用户名已更新', 'success');
      }
    } else if (avatarSt === 'pending' && nicknameSt === 'pending') {
      showToast('头像和改名均在审核中', 'info');
    } else if (avatarSt === 'pending') {
      showToast('头像仍在审核中', 'info');
    } else if (nicknameSt === 'pending') {
      showToast('改名仍在审核中', 'info');
    }
  } catch {
    showToast('查询审核状态失败', 'error');
  } finally {
    refreshingAvatarStatus.value = false;
  }
}

async function openAvatarPicker() {
  avatarMenuOpen.value = false;
  if (!await confirmProfileLimit('avatar')) {
    return;
  }
  // 下一帧触发点击，避免弹窗关闭动画与文件对话框冲突
  requestAnimationFrame(() => {
    avatarInputRef.value?.click();
  });
}

async function saveAvatarToLocal() {
  const url = avatarDraft.value || authStore.user?.avatar;
  if (!url) {
    showToast('暂无头像可保存', 'error');
    return;
  }
  avatarMenuOpen.value = false;
  avatarUploading.value = true;
  try {
    // 通过 Rust 后端拉取头像二进制，避免为渲染进程放开任意 connect-src。
    const image = await downloadApi.fetchImageBytes(url);
    // 从 MIME 推断扩展名
    const ext = image.mime.includes('png') ? 'png'
      : image.mime.includes('webp') ? 'webp'
      : image.mime.includes('gif') ? 'gif'
      : image.mime.includes('jpeg') || image.mime.includes('jpg') ? 'jpg'
      : 'png';
    const defaultName = `avatar_${authStore.user?.username || 'user'}.${ext}`;
    // 让用户选择保存位置
    const destPath = await saveDialog({
      defaultPath: defaultName,
      filters: [{ name: '图片', extensions: [ext] }],
    });
    if (!destPath) return; // 用户取消
    await downloadApi.saveDownloadBytes(image.data, destPath);
    showToast('头像已保存到本地', 'success');
  } catch (error) {
    const tip = error instanceof Error ? error.message : '保存失败';
    showToast(tip, 'error');
  } finally {
    avatarUploading.value = false;
  }
}

// 退出登录二次确认
const showLogoutConfirm = ref(false);

function handleLogout() {
  showLogoutConfirm.value = true;
}

async function confirmLogout() {
  showLogoutConfirm.value = false;
  loading.value = true;
  try {
    await logout();
    authStore.reset();
    stats.value = null;
    mode.value = 'login';
    message.value = '';
    showToast('已退出登录', 'info');
  } finally {
    loading.value = false;
  }
}

// 修改弦予号（参考微信号设计：登录唯一标识，每月可修改一次）
const showCiyuanxiModal = ref(false);
const ciyuanxiForm = ref({ oldId: '', newId: '', password: '' });
const ciyuanxiLoading = ref(false);

function openCiyuanxiModal() {
  ciyuanxiForm.value = {
    oldId: authStore.user?.ciyuanxi_id || authStore.user?.username || '',
    newId: '',
    password: '',
  };
  showCiyuanxiModal.value = true;
}

async function submitCiyuanxi() {
  const oldId = ciyuanxiForm.value.oldId.trim();
  const newId = ciyuanxiForm.value.newId.trim();
  const password = ciyuanxiForm.value.password;
  if (!oldId) {
    showToast('未获取到当前弦予号，请重新登录', 'error');
    return;
  }
  if (newId.length < 6 || newId.length > 20) {
    showToast('弦予号需 6-20 位', 'error');
    return;
  }
  if (!/^[a-zA-Z0-9]{6,20}$/.test(newId)) {
    showToast('弦予号仅支持纯数字、纯字母或数字字母组合', 'error');
    return;
  }
  if (!password) {
    showToast('请输入登录密码', 'error');
    return;
  }
  ciyuanxiLoading.value = true;
  try {
    const res = await updateCiyuanxiId(oldId, newId, password);
    showToast(res.message || '弦予号修改成功', 'success');
    showCiyuanxiModal.value = false;
    const user = authStore.user;
    if (user) {
      authStore.setUser({ ...user, ciyuanxi_id: res.ciyuanxi_id });
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '弦予号修改失败', 'error');
  } finally {
    ciyuanxiLoading.value = false;
  }
}

// 绑定邮箱（仅无邮箱账号显示入口）
const showBindEmailModal = ref(false);
const bindEmailForm = ref({ email: '', code: '' });
const bindEmailLoading = ref(false);
const bindCodeLoading = ref(false);
const bindCodeCountdown = ref(0);
let bindCodeTimer: ReturnType<typeof setInterval> | null = null;

function startBindCodeCountdown() {
  bindCodeCountdown.value = 60;
  if (bindCodeTimer) clearInterval(bindCodeTimer);
  bindCodeTimer = setInterval(() => {
    bindCodeCountdown.value--;
    if (bindCodeCountdown.value <= 0) {
      bindCodeCountdown.value = 0;
      if (bindCodeTimer) {
        clearInterval(bindCodeTimer);
        bindCodeTimer = null;
      }
    }
  }, 1000);
}

function openBindEmailModal() {
  bindEmailForm.value = { email: '', code: '' };
  bindCodeCountdown.value = 0;
  showBindEmailModal.value = true;
}

async function sendBindCode() {
  const email = bindEmailForm.value.email.trim();
  if (!email) {
    showToast('请输入邮箱', 'error');
    return;
  }
  if (!EMAIL_RE.test(email)) {
    showToast('邮箱格式不正确', 'error');
    return;
  }
  const captchaPayload = await requestHumanCaptcha('发送验证码前验证', '完成验证后将向邮箱发送绑定验证码。');
  if (!captchaPayload) return;
  bindCodeLoading.value = true;
  try {
    const ciyuanxiId = authStore.user?.ciyuanxi_id || authStore.user?.username || '';
    const result = await sendEmailCode(email, 'bind', captchaPayload, ciyuanxiId || undefined);
    showToast(result.message || '验证码已发送到邮箱', 'success');
    startBindCodeCountdown();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '验证码发送失败', 'error');
  } finally {
    bindCodeLoading.value = false;
  }
}

async function submitBindEmail() {
  const ciyuanxiId = authStore.user?.ciyuanxi_id || authStore.user?.username || '';
  const email = bindEmailForm.value.email.trim();
  const code = bindEmailForm.value.code.trim();
  if (!ciyuanxiId) {
    showToast('未获取到当前账号，请重新登录', 'error');
    return;
  }
  if (!email) {
    showToast('请输入邮箱', 'error');
    return;
  }
  if (!EMAIL_RE.test(email)) {
    showToast('邮箱格式不正确', 'error');
    return;
  }
  if (!code) {
    showToast('请输入邮箱验证码', 'error');
    return;
  }
  bindEmailLoading.value = true;
  try {
    const res = await bindEmail(ciyuanxiId, email, code);
    showToast(res.message || '邮箱绑定成功', 'success');
    showBindEmailModal.value = false;
    const user = authStore.user;
    if (user) {
      authStore.setUser({ ...user, email: res.email });
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '邮箱绑定失败', 'error');
  } finally {
    bindEmailLoading.value = false;
  }
}

function navigateShortcut(to: string) {
  void router.push(to);
}

function switchMode(next: AuthMode) {
  mode.value = next;
  message.value = '';
  // 切换模式时清空密码相关字段，防止登录与注册页之间密码同步
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

onMounted(async () => {
  // 进入账号页面时强制关闭播放器详情页：PlayerDetail 是 fixed + h-[100vh] 全屏覆盖层，
  // 当 showPlayerDetail=true 时会拦截整个视口的鼠标事件（包括滚轮），导致页面无法滚动
  uiStore.showPlayerDetail = false;
  void loadUserAgreement();
  if (!authStore.initialized) {
    await authStore.restoreSession();
  }
  if (!authStore.isLoggedIn) {
    return;
  }
  nicknameDraft.value = authStore.user?.nickname || authStore.user?.username || '';
  avatarDraft.value = authStore.user?.avatar || '';
  try {
    const profile = await getProfile();
    if (profile) {
      authStore.setUser(profile.user);
      stats.value = profile.stats;
      nicknameDraft.value = profile.user.nickname || profile.user.username;
      avatarDraft.value = profile.user.avatar || '';
    }
  } catch {
    stats.value = null;
  }
  // 查询头像和改名审核状态
  avatarStatus.value = await getAvatarStatus();
  try {
    nicknameStatus.value = await getNicknameStatus();
  } catch {
    nicknameStatus.value = 'none';
  }
  // 启动定时轮询审核状态
  startPolling();
});

onUnmounted(() => {
  stopPolling();
  if (bindCodeTimer) {
    clearInterval(bindCodeTimer);
    bindCodeTimer = null;
  }
});

// 定时轮询审核状态：当头像/昵称审核通过后自动更新
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = 30000; // 30秒

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    // 用户未登录或不在审核中则跳过
    if (!authStore.isLoggedIn) return;
    if (avatarStatus.value !== 'pending' && nicknameStatus.value !== 'pending') {
      // 没有待审核项，降低轮询频率（每120秒一次）
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = setInterval(silentPoll, 120000);
      }
      return;
    }
    await silentPoll();
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function silentPoll() {
  try {
    const [avatarSt, nicknameSt] = await Promise.all([
      getAvatarStatus().catch(() => 'none' as const),
      getNicknameStatus().catch(() => 'none' as const),
    ]);
    const prevAvatar = avatarStatus.value;
    const prevNickname = nicknameStatus.value;
    avatarStatus.value = avatarSt;
    nicknameStatus.value = nicknameSt;

    // 检测状态变化：从 pending 变为 approved
    if (prevAvatar === 'pending' && avatarSt === 'none') {
      const profile = await getProfile();
      if (profile) {
        authStore.setUser(profile.user);
        avatarDraft.value = profile.user.avatar || '';
      }
      showToast('头像已更新', 'success');
    }
    if (prevNickname === 'pending' && nicknameSt === 'none') {
      const profile = await getProfile();
      if (profile) {
        authStore.setUser(profile.user);
        nicknameDraft.value = profile.user.nickname || profile.user.username || '';
      }
      showToast('用户名已更新', 'success');
    }
    // 如果两边都变为 none，只拉一次 profile
    if (prevAvatar === 'pending' && prevNickname === 'pending' && avatarSt === 'none' && nicknameSt === 'none') {
      const profile = await getProfile();
      if (profile) {
        authStore.setUser(profile.user);
        avatarDraft.value = profile.user.avatar || '';
        nicknameDraft.value = profile.user.nickname || profile.user.username || '';
      }
      showToast('头像和用户名已更新', 'success');
    }
  } catch {
    // 静默失败，不影响用户体验
  }
}
</script>

<template>
  <div class="auth-page h-full w-full overflow-y-auto custom-scrollbar text-gray-800 dark:text-gray-200">
    <div class="px-[clamp(1rem,1.5vw,1.75rem)] pt-[clamp(1rem,1.5vw,1.75rem)] pb-[clamp(2rem,4vw,4rem)] max-w-6xl mx-auto">

      <!-- 未登录：登录/注册 -->
      <div v-if="!authStore.isLoggedIn" class="animate-fade-in-up">
        <!-- 顶部标题区 -->
        <header class="pb-[clamp(0.25rem,0.5vw,0.5rem)]">
          <p class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider mb-2">{{ headerLabel }}</p>
          <h2 class="text-black dark:text-white text-[clamp(1.75rem,4vw,3rem)] font-black tracking-tight leading-none">{{ title }}</h2>
          <p class="text-black/60 dark:text-white/60 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light mt-2 max-w-xl">{{ subtitle }}</p>
        </header>

        <!-- 模式切换 -->
        <nav class="mt-[clamp(1rem,1.5vw,1.75rem)]">
          <div
            v-if="mode !== 'forgot'"
            class="flex items-center gap-2 border-b border-black/10 dark:border-white/10"
          >
            <button
              type="button"
              class="relative px-7 py-3 text-[clamp(1rem,1.3vw,1.125rem)] font-medium tracking-wide transition-colors cursor-pointer"
              :class="mode === 'login'
                ? 'text-[#EC4141]'
                : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
              @click="switchMode('login')"
            >
              登录
              <span
                class="absolute left-1/2 -translate-x-1/2 -bottom-px h-1 w-12 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
                :class="mode === 'login' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
              ></span>
            </button>
            <button
              type="button"
              class="relative px-7 py-3 text-[clamp(1rem,1.3vw,1.125rem)] font-medium tracking-wide transition-colors cursor-pointer"
              :class="mode === 'register'
                ? 'text-[#EC4141]'
                : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
              @click="switchMode('register')"
            >
              注册
              <span
                class="absolute left-1/2 -translate-x-1/2 -bottom-px h-1 w-12 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
                :class="mode === 'register' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
              ></span>
            </button>
          </div>
          <div v-else class="flex items-center mb-4">
            <button
              type="button"
              class="inline-flex items-center gap-1 text-black/60 dark:text-white/60 hover:text-[#EC4141] text-base font-medium transition cursor-pointer"
              @click="switchMode('login')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
              返回登录
            </button>
          </div>
        </nav>

        <!-- 表单区（带切换动画） -->
        <Transition name="auth-mode" mode="out-in">
          <!-- 找回密码表单 -->
          <form
            v-if="mode === 'forgot'"
            key="forgot"
            class="pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-8 grid gap-7 max-w-2xl"
            @submit.prevent="onSubmit"
          >
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
                @click="handleSendCode"
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
                @click="switchMode('login')"
              >
                返回登录
              </button>
            </div>
          </form>

          <!-- 登录 / 注册表单 -->
          <form
            v-else
            :key="mode"
            class="pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-8 grid gap-7 max-w-2xl"
            @submit.prevent="onSubmit"
          >
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">{{ mode === 'login' ? '弦予号/邮箱' : '弦予号' }}</span>
              <input
                v-model="form.account"
                type="text"
                :placeholder="mode === 'login' ? '输入弦予号或邮箱登录' : '6-20位，支持纯数字、纯字母或组合'"
                :autocomplete="mode === 'login' ? 'off' : 'username'"
                class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                :class="fieldErrors.account ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
                @blur="validateField('account')"
                @input="clearFieldError('account')"
              />
              <span v-if="fieldErrors.account" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.account }}</span>
            </label>

            <template v-if="mode === 'register'">
              <label class="grid gap-3">
                <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">昵称（选填）</span>
                <input
                  v-model="form.nickname"
                  type="text"
                  placeholder='留空则默认"弦予+弦予号"'
                  autocomplete="nickname"
                  class="h-[clamp(2.75rem,4vw,3.5rem)] bg-transparent border-b px-1 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  :class="fieldErrors.nickname ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
                  @blur="validateField('nickname')"
                  @input="clearFieldError('nickname')"
                />
                <span v-if="fieldErrors.nickname" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.nickname }}</span>
              </label>
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
                  @blur="validateField('email')"
                  @input="clearFieldError('email')"
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
                    @blur="validateField('code')"
                    @input="clearFieldError('code')"
                  />
                  <span v-if="fieldErrors.code" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.code }}</span>
                </label>
                <button
                  type="button"
                  class="h-14 px-6 whitespace-nowrap text-base font-medium text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="codeLoading || codeCountdown > 0"
                  @click="handleSendCode"
                >
                  {{ codeLoading ? '发送中…' : codeCountdown > 0 ? `重新发送 (${codeCountdown}s)` : '发送验证码' }}
                </button>
              </div>
            </template>

            <label class="grid gap-3">
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
                  @blur="validateField('password')"
                  @input="onPasswordInput"
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

            <label v-if="mode === 'register'" class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider">确认密码</span>
              <div class="relative" @focusin="pwdFocused.confirmPassword = true" @focusout="pwdFocused.confirmPassword = false; pwdVisible.confirmPassword = false">
                <input
                  v-model="form.confirmPassword"
                  :type="pwdVisible.confirmPassword ? 'text' : 'password'"
                  placeholder="再次输入密码"
                  autocomplete="new-password"
                  required
                  class="h-[clamp(2.75rem,4vw,3.5rem)] w-full bg-transparent border-b pl-1 pr-10 text-[clamp(1rem,1.3vw,1.125rem)] text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  :class="fieldErrors.confirmPassword ? '!border-[#EC4141]' : 'border-black/15 dark:border-white/15'"
                  @blur="validateField('confirmPassword')"
                  @input="clearFieldError('confirmPassword')"
                />
                <button
                  type="button"
                  v-show="pwdFocused.confirmPassword && form.confirmPassword.length > 0"
                  class="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                  :aria-label="pwdVisible.confirmPassword ? '隐藏密码' : '查看密码'"
                  @mousedown.prevent
                  @click="pwdVisible.confirmPassword = !pwdVisible.confirmPassword"
                >
                  <EyeOff v-if="pwdVisible.confirmPassword" class="h-5 w-5" />
                  <Eye v-else class="h-5 w-5" />
                </button>
              </div>
              <span v-if="fieldErrors.confirmPassword" class="text-[#EC4141] text-sm -mt-1">{{ fieldErrors.confirmPassword }}</span>
            </label>

            <div class="flex items-start gap-3 text-sm text-black/60 dark:text-white/60 select-none">
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
                @click="switchMode(mode === 'login' ? 'register' : 'login')"
              >
                {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
              </button>
              <button
                v-if="mode === 'login'"
                type="button"
                class="text-black/60 dark:text-white/60 hover:text-[#EC4141] text-base font-medium transition cursor-pointer ml-auto"
                @click="enterForgot"
              >
                忘记密码？
              </button>
            </div>
          </form>
        </Transition>

        <!-- 消息条 -->
        <div
          v-if="message"
          class="mt-4"
        >
          <p
            class="text-base font-medium"
            :class="messageTone === 'error'
              ? 'text-[#EC4141]'
              : 'text-emerald-600 dark:text-emerald-400'"
          >
            {{ message }}
          </p>
        </div>
      </div>

      <!-- 已登录：个人中心 -->
      <div v-else class="space-y-[clamp(1rem,1.8vw,1.5rem)]">
        <!-- 顶部标题区（含头像） -->
        <header class="px-[clamp(1.5rem,2.8vw,3.5rem)] pt-[clamp(1.25rem,1.8vw,2rem)] pb-[clamp(0.5rem,1vw,1rem)] flex items-center justify-between gap-6 flex-wrap animate-fade-in-up">
          <div class="flex items-center gap-[clamp(0.75rem,1.2vw,1.25rem)] min-w-0">
            <!-- 头像 + 审核状态（垂直排列） -->
            <div class="flex flex-col items-center gap-1 shrink-0">
              <!-- 头像（可点击） -->
              <div class="relative shrink-0">
                <button
                  ref="avatarBtnRef"
                  type="button"
                  class="grid h-[clamp(6rem,7vw,7rem)] w-[clamp(6rem,7vw,7rem)] place-items-center overflow-hidden rounded-full bg-black/5 dark:bg-white/10 text-[#EC4141] text-[clamp(1.25rem,2vw,1.75rem)] font-black ring-2 ring-transparent hover:ring-[#EC4141]/30 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  :disabled="avatarUploading || loading"
                  :title="avatarUploading ? '上传中…' : '点击管理头像'"
                  @click="openAvatarMenu"
                >
                  <img v-if="avatarDraft || authStore.user?.avatar" :src="avatarDraft || authStore.user?.avatar || ''" alt="" class="h-full w-full object-cover" />
                  <span v-else>{{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}</span>
                </button>
                <!-- 隐藏的文件输入 -->
                <input
                  ref="avatarInputRef"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                  class="hidden"
                  :disabled="avatarUploading || loading"
                  @change="handleAvatarFileChange"
                />
              </div>
              <!-- 头像审核状态提示（头像下方） -->
              <div
                v-if="avatarStatus === 'pending'"
                class="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-300 w-fit"
              >
                <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                审核中
                <button
                  type="button"
                  class="ml-0.5 flex items-center gap-0.5 underline-offset-2 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="refreshingAvatarStatus"
                  @click="refreshAvatarStatus"
                >
                  <svg v-if="refreshingAvatarStatus" class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  刷新
                </button>
              </div>
              <div
                v-else-if="avatarStatus === 'rejected'"
                class="flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-600 dark:text-rose-300 w-fit"
              >
                <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                未通过
              </div>
            </div>
            <!-- 昵称 + 副信息 -->
            <div class="min-w-0">
              <!-- 昵称：点击弹窗修改 -->
              <div class="flex items-center gap-2 min-w-0">
                <h2
                  class="text-black dark:text-white text-[clamp(1.1rem,2.2vw,1.7rem)] font-black tracking-tight leading-none truncate cursor-pointer hover:text-[#EC4141] transition"
                  :title="authStore.user?.nickname || authStore.user?.username || '点击修改昵称'"
                  @click="openNicknameEditModal"
                >
                  {{ authStore.user?.nickname || authStore.user?.username }}
                </h2>
              </div>
              <!-- 改名审核状态提示 -->
              <div
                v-if="nicknameStatus === 'pending'"
                class="mt-1.5 flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-300 w-fit"
              >
                <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                改名审核中
                <button
                  type="button"
                  class="ml-0.5 flex items-center gap-0.5 underline-offset-2 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="refreshingAvatarStatus"
                  @click="refreshAvatarStatus"
                >
                  <svg v-if="refreshingAvatarStatus" class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  刷新
                </button>
              </div>
              <div
                v-else-if="nicknameStatus === 'rejected'"
                class="mt-1.5 flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-600 dark:text-rose-300 w-fit"
              >
                <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                改名审核未通过
              </div>
              <div class="flex items-center gap-2 mt-1.5 min-w-0 flex-wrap">
                <!-- 弦予号：点击本体修改 -->
                <p
                  v-if="authStore.user?.ciyuanxi_id"
                  class="text-black/60 dark:text-white/60 text-[clamp(0.7rem,0.95vw,0.825rem)] font-light truncate cursor-pointer hover:text-[#EC4141] transition"
                  title="点击修改弦予号"
                  @click="openCiyuanxiModal"
                >
                  弦予号：{{ authStore.user.ciyuanxi_id }}
                </p>
                <p
                  v-else-if="authStore.user?.email"
                  class="text-black/60 dark:text-white/60 text-[clamp(0.7rem,0.95vw,0.825rem)] font-light truncate"
                >
                  {{ authStore.user.email }}
                </p>
                <p
                  v-else
                  class="text-black/60 dark:text-white/60 text-[clamp(0.7rem,0.95vw,0.825rem)] font-light truncate"
                >
                  未设置
                </p>
                <!-- 无邮箱时显示绑定邮箱入口 -->
                <button
                  v-if="!authStore.user?.email"
                  type="button"
                  class="shrink-0 text-[#EC4141] hover:text-[#d13b3b] text-[clamp(0.65rem,0.85vw,0.75rem)] font-medium transition cursor-pointer px-1.5 py-0.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
                  title="绑定邮箱"
                  @click="openBindEmailModal"
                >
                  绑定邮箱
                </button>
              </div>
              <!-- 数据统计 -->
              <div class="flex items-center gap-[clamp(1rem,1.5vw,1.5rem)] flex-wrap mt-3">
                <div v-for="item in meterItems" :key="item.key" class="flex items-baseline gap-1.5">
                  <span class="text-black dark:text-white text-[clamp(1rem,1.4vw,1.2rem)] font-bold tracking-tight leading-none">{{ displayStats[item.key] }}</span>
                  <span class="text-black/50 dark:text-white/50 text-[clamp(0.7rem,0.9vw,0.8rem)] font-light tracking-wide">{{ item.label }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-4 py-1.5 rounded-md text-sm font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="loading"
              @click="handleLogout"
            >
              {{ loading ? '退出中…' : '退出登录' }}
            </button>
          </div>
        </header>

        <!-- 头像操作弹窗（定位在头像附近） -->
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

          <!-- 头像放大查看 -->
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

        <!-- 快捷入口 -->
        <section class="px-[clamp(1.5rem,2.8vw,3.5rem)] py-[clamp(0.75rem,1.2vw,1.25rem)] animate-fade-in-up" style="animation-delay: 340ms;">
          <p class="text-black dark:text-white text-[clamp(0.95rem,1.4vw,1.125rem)] font-medium tracking-wider mb-4">快捷入口</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              v-for="item in personalShortcuts"
              :key="item.label"
              type="button"
              class="grid gap-2 p-4 rounded-xl border border-black/10 dark:border-white/10 hover:border-[#EC4141]/40 hover:bg-red-50/40 dark:hover:bg-red-500/5 text-left transition-colors cursor-pointer"
              @click="navigateShortcut(item.to)"
            >
              <span class="grid h-9 w-9 place-items-center rounded-lg bg-black/5 dark:bg-white/10 text-[#EC4141]">
                <svg v-if="item.icon === 'cog'" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <svg v-else-if="item.icon === 'theme'" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
                <svg v-else-if="item.icon === 'home'" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                <svg v-else-if="item.icon === 'plugin'" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
              </span>
              <span class="grid gap-0.5 min-w-0">
                <strong class="text-[clamp(0.8rem,1vw,0.9rem)] font-medium text-black dark:text-white truncate">{{ item.label }}</strong>
                <small class="text-[clamp(0.65rem,0.8vw,0.75rem)] text-black/55 dark:text-white/55 truncate">{{ item.desc }}</small>
              </span>
            </button>
          </div>
        </section>
      </div>

    </div>

    <!-- 退出登录确认弹窗 -->
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

    <!-- 修改弦予号弹窗 -->
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

    <!-- 绑定邮箱弹窗 -->
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

    <!-- 修改昵称弹窗 -->
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

    <!-- 用户协议弹窗 -->
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
/* 退出登录确认弹窗 */
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

/* 弹窗过渡动画（复用 avatar-modal） */
.avatar-modal-enter-active .logout-confirm-card,
.avatar-modal-leave-active .logout-confirm-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.avatar-modal-enter-from .logout-confirm-card,
.avatar-modal-leave-to .logout-confirm-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

/* 深色模式 */
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

/* 登录/注册模式切换动画 */
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

/* 头像管理弹窗 */
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

/* 弹窗过渡动画 */
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

/* 放大查看过渡 */
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
