<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../features/auth/store';
import { useToast } from '../composables/toast';
import { useUiStore } from '../shared/stores/ui';
import {
  changePassword,
  getProfile,
  login,
  logout,
  register,
  resetPassword,
  sendEmailCode,
  updateProfile,
  uploadAvatar,
  type AuthMode,
  type ProfileStats,
  type VerifyCodeType,
} from '../services/auth/authService';

const router = useRouter();
const authStore = useAuthStore();
const { showToast } = useToast();
const uiStore = useUiStore();

const mode = ref<AuthMode>('login');
const form = ref({ username: '', email: '', password: '', code: '' });
const forgotForm = ref({ email: '', code: '', newPassword: '', confirmPassword: '' });
const message = ref('');
const messageTone = ref<'error' | 'success'>('error');
const loading = ref(false);
const codeLoading = ref(false);
const stats = ref<ProfileStats | null>(null);
const nicknameDraft = ref('');
const avatarDraft = ref('');
const avatarUploading = ref(false);
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' });
const profileSaving = ref(false);
const passwordSaving = ref(false);

type Shortcut = {
  label: string;
  desc: string;
  to: string;
  icon: 'cog' | 'theme' | 'home' | 'folder';
};

const personalShortcuts: Shortcut[] = [
  { label: '账号设置', desc: '应用通用选项', to: '/settings', icon: 'cog' },
  { label: '主题外观', desc: '换肤与界面风格', to: '/settings', icon: 'theme' },
  { label: '回到首页', desc: '统计与首页内容', to: '/', icon: 'home' },
  { label: '本地音乐', desc: '管理本地曲库', to: '/?view=all', icon: 'folder' },
];

const meterItems: Array<{ key: keyof ProfileStats; label: string }> = [
  { key: 'favorite_count', label: '收藏' },
  { key: 'playlist_count', label: '歌单' },
  { key: 'starred_count', label: '星标' },
  { key: 'history_count', label: '历史' },
];

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

function showMessage(text: string, tone: 'error' | 'success' = 'error') {
  messageTone.value = tone;
  message.value = text;
}

async function onSubmit() {
  if (mode.value === 'forgot') {
    await handleResetPassword();
    return;
  }
  loading.value = true;
  message.value = '';
  try {
    const result =
      mode.value === 'login'
        ? await login(form.value.username, form.value.password)
        : await register(
            form.value.username || form.value.email.split('@')[0] || '用户',
            form.value.password,
            form.value.email,
            form.value.code,
          );

    authStore.setAuth(result);
    form.value = { username: '', email: '', password: '', code: '' };
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
  loading.value = true;
  message.value = '';
  try {
    const result = await resetPassword(email, code, newPassword);
    forgotForm.value = { email: '', code: '', newPassword: '', confirmPassword: '' };
    showMessage(result.message || '密码修改成功', 'success');
    showToast(result.message || '密码修改成功，请使用新密码登录', 'success');
    mode.value = 'login';
    form.value.username = email;
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
  const type: VerifyCodeType = isForgot ? 'reset_password' : 'register';
  codeLoading.value = true;
  message.value = '';
  try {
    const result = await sendEmailCode(email, type);
    showMessage(result.message || '验证码已发送到邮箱', 'success');
    showToast(result.message || '验证码已发送到邮箱', 'success');
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
      nicknameDraft.value = result.user.nickname || result.user.username;
      avatarDraft.value = result.user.avatar || '';
    }
    showToast('个人信息已保存', 'success');
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
  if (file.size > 2 * 1024 * 1024) {
    const tip = '头像不能超过 2MB';
    showToast(tip, 'error');
    return;
  }

  avatarUploading.value = true;
  try {
    const result = await uploadAvatar(file, file.name || 'avatar.jpg');
    if (result?.user) authStore.setUser(result.user);
    avatarDraft.value = result.user.avatar || result.avatar || '';
    showToast('头像已上传', 'success');
  } catch (error) {
    const tip = error instanceof Error ? error.message : '头像上传失败';
    showToast(tip, 'error');
  } finally {
    avatarUploading.value = false;
  }
}

async function handleChangePassword() {
  if (!passwordForm.value.oldPassword || !passwordForm.value.newPassword || !passwordForm.value.confirmPassword) {
    showToast('请填写完整的密码信息', 'error');
    return;
  }
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    showToast('两次新密码不一致', 'error');
    return;
  }
  passwordSaving.value = true;
  try {
    await changePassword(
      passwordForm.value.oldPassword,
      passwordForm.value.newPassword,
    );
    await logout();
    authStore.reset();
    stats.value = null;
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' };
    mode.value = 'login';
    showToast('密码已修改，请重新登录', 'success');
  } catch (error) {
    const tip = error instanceof Error ? error.message : '修改密码失败';
    showToast(tip, 'error');
  } finally {
    passwordSaving.value = false;
  }
}

async function handleLogout() {
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

function goBackToMain() {
  void router.push('/');
}

function navigateShortcut(to: string) {
  void router.push(to);
}

function switchMode(next: AuthMode) {
  mode.value = next;
  message.value = '';
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
});
</script>

<template>
  <div class="auth-page h-full w-full overflow-y-auto custom-scrollbar text-gray-800 dark:text-gray-200">
    <div class="px-6 py-12 md:px-10 md:py-16 max-w-6xl mx-auto">

      <!-- 未登录：登录/注册 -->
      <div v-if="!authStore.isLoggedIn" class="animate-fade-in-up">
        <!-- 顶部标题区 -->
        <header class="px-8 py-8 md:px-14 md:py-12">
          <p class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider mb-3">{{ headerLabel }}</p>
          <h2 class="text-black dark:text-white text-4xl md:text-5xl font-black tracking-tight leading-none">{{ title }}</h2>
          <p class="text-black/60 dark:text-white/60 text-base md:text-lg font-light mt-4 max-w-xl">{{ subtitle }}</p>
        </header>

        <!-- 模式切换 -->
        <nav class="px-8 md:px-14">
          <div
            v-if="mode !== 'forgot'"
            class="flex items-center gap-2 mb-4 border-b border-black/10 dark:border-white/10"
          >
            <button
              type="button"
              class="relative px-7 py-3 text-lg font-medium tracking-wide transition-colors cursor-pointer"
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
              class="relative px-7 py-3 text-lg font-medium tracking-wide transition-colors cursor-pointer"
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
            class="px-8 md:px-14 py-8 grid gap-7 max-w-2xl"
            @submit.prevent="onSubmit"
          >
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">注册邮箱</span>
              <input
                v-model="forgotForm.email"
                type="email"
                placeholder="name@example.com"
                autocomplete="email"
                required
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>

            <div class="grid grid-cols-[1fr_auto] items-end gap-4">
              <label class="grid gap-3">
                <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">邮箱验证码</span>
                <input
                  v-model="forgotForm.code"
                  type="text"
                  placeholder="填写验证码"
                  autocomplete="one-time-code"
                  required
                  class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                />
              </label>
              <button
                type="button"
                class="h-14 px-6 whitespace-nowrap text-base font-medium text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="codeLoading"
                @click="handleSendCode"
              >
                {{ codeLoading ? '发送中…' : '发送验证码' }}
              </button>
            </div>

            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">新密码</span>
              <input
                v-model="forgotForm.newPassword"
                type="password"
                placeholder="至少 6 位"
                autocomplete="new-password"
                required
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>

            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">确认新密码</span>
              <input
                v-model="forgotForm.confirmPassword"
                type="password"
                placeholder="再次输入新密码"
                autocomplete="new-password"
                required
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>

            <div class="pt-4 flex items-center gap-5 flex-wrap">
              <button
                type="submit"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-10 py-3 rounded-full text-base font-medium transition flex items-center gap-1 active:scale-95 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
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
            class="px-8 md:px-14 py-8 grid gap-7 max-w-2xl"
            @submit.prevent="onSubmit"
          >
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">用户名</span>
              <input
                v-model="form.username"
                type="text"
                placeholder="输入用户名"
                autocomplete="username"
                required
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>

            <template v-if="mode === 'register'">
              <label class="grid gap-3">
                <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">邮箱</span>
                <input
                  v-model="form.email"
                  type="email"
                  placeholder="name@example.com"
                  autocomplete="email"
                  required
                  class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                />
              </label>

              <div class="grid grid-cols-[1fr_auto] items-end gap-4">
                <label class="grid gap-3">
                  <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">邮箱验证码</span>
                  <input
                    v-model="form.code"
                    type="text"
                    placeholder="填写验证码"
                    autocomplete="one-time-code"
                    required
                    class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
                  />
                </label>
                <button
                  type="button"
                  class="h-14 px-6 whitespace-nowrap text-base font-medium text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="codeLoading"
                  @click="handleSendCode"
                >
                  {{ codeLoading ? '发送中…' : '发送验证码' }}
                </button>
              </div>
            </template>

            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">密码</span>
              <input
                v-model="form.password"
                type="password"
                placeholder="请输入密码"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                required
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>

            <div class="pt-4 flex items-center gap-5 flex-wrap">
              <button
                type="submit"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-10 py-3 rounded-full text-base font-medium transition flex items-center gap-1 active:scale-95 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                :disabled="loading"
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
          class="px-8 md:px-14 mt-4"
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
      <div v-else class="space-y-8 md:space-y-12">
        <!-- 顶部标题区 -->
        <header class="px-8 py-8 md:px-14 md:py-12 flex items-center justify-between gap-6 flex-wrap animate-fade-in-up">
          <div>
            <p class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider mb-3">个人中心</p>
            <h2 class="text-black dark:text-white text-4xl md:text-5xl font-black tracking-tight leading-none">
              {{ authStore.user?.nickname || authStore.user?.username }}
            </h2>
            <p class="text-black/60 dark:text-white/60 text-base md:text-lg font-light mt-4">
              @{{ authStore.user?.username }} · {{ authStore.user?.email }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white px-5 py-2 rounded-md text-base font-medium transition cursor-pointer"
              @click="goBackToMain"
            >
              返回主界面
            </button>
            <button
              type="button"
              class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-5 py-2 rounded-md text-base font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="loading"
              @click="handleLogout"
            >
              {{ loading ? '退出中…' : '退出登录' }}
            </button>
          </div>
        </header>

        <!-- 头像 + 统计 -->
        <section class="px-8 py-8 md:px-14 md:py-10 animate-fade-in-up" style="animation-delay: 100ms;">
          <div class="flex items-end justify-between gap-8 md:gap-14 flex-wrap">
            <!-- 左：头像 -->
            <div class="shrink-0 grid gap-4">
              <p class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">头像</p>
              <div class="flex items-center gap-5">
                <div class="grid h-24 w-24 md:h-28 md:w-28 shrink-0 place-items-center overflow-hidden rounded-full bg-black/5 dark:bg-white/10 text-[#EC4141] text-4xl md:text-5xl font-black">
                  <img v-if="avatarDraft || authStore.user?.avatar" :src="avatarDraft || authStore.user?.avatar || ''" alt="" class="h-full w-full object-cover" />
                  <span v-else>{{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}</span>
                </div>
                <label class="inline-flex items-center h-11 px-5 rounded-full border border-black/15 dark:border-white/15 text-base font-medium text-black/70 dark:text-white/70 hover:text-[#EC4141] hover:border-[#EC4141]/40 cursor-pointer transition-colors">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                    class="hidden"
                    :disabled="avatarUploading || loading"
                    @change="handleAvatarFileChange"
                  />
                  <span>{{ avatarUploading ? '上传中…' : '更换头像' }}</span>
                </label>
              </div>
            </div>

            <!-- 右：统计 -->
            <div class="flex-1 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 min-w-0">
              <div v-for="item in meterItems" :key="item.key">
                <p class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider mb-2">{{ item.label }}</p>
                <p class="text-black dark:text-white text-3xl md:text-4xl font-black tracking-tight leading-none">{{ stats?.[item.key] ?? '—' }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 个人信息 -->
        <section class="px-8 py-8 md:px-14 md:py-10 animate-fade-in-up" style="animation-delay: 200ms;">
          <p class="text-black dark:text-white text-xl md:text-2xl font-light tracking-wider mb-6">个人信息</p>
          <div class="grid gap-7 max-w-2xl">
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">昵称</span>
              <input
                v-model="nicknameDraft"
                type="text"
                placeholder="显示名称"
                maxlength="64"
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>
            <div>
              <button
                type="button"
                class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-10 py-3 rounded-full text-base font-medium transition active:scale-95 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                :disabled="profileSaving || loading"
                @click="handleSaveProfile"
              >
                {{ profileSaving ? '保存中…' : '保存资料' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 修改密码 -->
        <section class="px-8 py-8 md:px-14 md:py-10 animate-fade-in-up" style="animation-delay: 300ms;">
          <p class="text-black dark:text-white text-xl md:text-2xl font-light tracking-wider mb-3">修改密码</p>
          <p class="text-black/60 dark:text-white/60 text-base md:text-lg font-light mb-6">修改成功后需要重新登录</p>
          <div class="grid gap-7 max-w-2xl">
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">当前密码</span>
              <input
                v-model="passwordForm.oldPassword"
                type="password"
                placeholder="输入当前密码"
                autocomplete="current-password"
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">新密码</span>
              <input
                v-model="passwordForm.newPassword"
                type="password"
                placeholder="输入新密码"
                autocomplete="new-password"
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>
            <label class="grid gap-3">
              <span class="text-black/70 dark:text-white/70 text-base md:text-lg font-light tracking-wider">确认新密码</span>
              <input
                v-model="passwordForm.confirmPassword"
                type="password"
                placeholder="再次输入新密码"
                autocomplete="new-password"
                class="h-14 bg-transparent border-b border-black/15 dark:border-white/15 px-1 text-lg text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </label>
            <div>
              <button
                type="button"
                class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-10 py-3 rounded-full text-base font-medium transition active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                :disabled="passwordSaving || loading"
                @click="handleChangePassword"
              >
                {{ passwordSaving ? '提交中…' : '更新密码' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 快捷入口 -->
        <section class="px-8 py-8 md:px-14 md:py-10 animate-fade-in-up" style="animation-delay: 400ms;">
          <p class="text-black dark:text-white text-xl md:text-2xl font-light tracking-wider mb-6">快捷入口</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-5">
            <button
              v-for="item in personalShortcuts"
              :key="item.label"
              type="button"
              class="grid gap-3 p-6 rounded-2xl border border-black/10 dark:border-white/10 hover:border-[#EC4141]/40 hover:bg-red-50/40 dark:hover:bg-red-500/5 text-left transition-colors cursor-pointer"
              @click="navigateShortcut(item.to)"
            >
              <span class="grid h-11 w-11 place-items-center rounded-xl bg-black/5 dark:bg-white/10 text-[#EC4141]">
                <svg v-if="item.icon === 'cog'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <svg v-else-if="item.icon === 'theme'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
                <svg v-else-if="item.icon === 'home'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
              </span>
              <span class="grid gap-1 min-w-0">
                <strong class="text-base font-medium text-black dark:text-white truncate">{{ item.label }}</strong>
                <small class="text-sm text-black/60 dark:text-white/60 truncate">{{ item.desc }}</small>
              </span>
            </button>
          </div>
        </section>
      </div>

    </div>
  </div>
</template>

<style scoped>
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
