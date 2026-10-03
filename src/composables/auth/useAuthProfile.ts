// 已登录状态的资料管理：头像/昵称/弦予号/绑定邮箱/退出登录与审核状态轮询（自 src/views/Auth.vue 拆出，逻辑保持原样）
import { computed, nextTick, onUnmounted, ref, type Ref } from 'vue';

import { useAuthStore } from '../../features/auth/store';
import { useCollectionsStore } from '../../features/collections/store';
import { useToast } from '../toast';
import { showProfileLimitDialog, type ProfileLimitDialogTarget } from '../useProfileLimitDialog';
import { downloadApi } from '../../services/tauri/downloadApi';
import {
  bindEmail,
  getAvatarChangeLimitStatus,
  getAvatarStatus,
  getNicknameChangeLimitStatus,
  getNicknameStatus,
  getProfile,
  logout,
  sendEmailCode,
  updateCiyuanxiId,
  updateProfile,
  uploadAvatar,
  type AuthMode,
  type HumanCaptchaPayload,
  type ProfileStats,
} from '../../services/auth/authService';
import { EMAIL_RE } from './useAuthForm';
import type { LoginMethod } from './useAuthFlow';

export interface UseAuthProfileOptions {
  mode: Ref<AuthMode>;
  loginMethod: Ref<LoginMethod>;
  loading: Ref<boolean>;
  message: Ref<string>;
  showMessage: (text: string, tone?: 'error' | 'success') => void;
  stats: Ref<ProfileStats | null>;
  nicknameDraft: Ref<string>;
  avatarDraft: Ref<string>;
  requestHumanCaptcha: (title: string, description: string) => Promise<HumanCaptchaPayload | null>;
}

export function useAuthProfile(options: UseAuthProfileOptions) {
  const {
    mode,
    loginMethod,
    loading,
    message,
    showMessage,
    stats,
    nicknameDraft,
    avatarDraft,
    requestHumanCaptcha,
  } = options;

  const authStore = useAuthStore();
  const collectionsStore = useCollectionsStore();
  const { showToast } = useToast();

  const avatarUploading = ref(false);
  const avatarStatus = ref<'none' | 'pending' | 'rejected'>('none');
  const nicknameStatus = ref<'none' | 'pending' | 'rejected'>('none');
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
    let left = rect.right + gap;
    let top = rect.top;
    if (left + cardWidth > window.innerWidth - 8) {
      left = rect.left - cardWidth - gap;
    }
    if (left < 8) {
      left = 8;
    }
    if (top + 200 > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 220);
    }
    avatarMenuPos.value = { top, left };
    avatarMenuOpen.value = true;
  }
  const showNicknameModal = ref(false);
  const nicknameInputRef = ref<HTMLInputElement | null>(null);

  async function openNicknameEditModal() {
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
    if (!showNicknameModal.value) return;
    const next = nicknameDraft.value.trim();
    const current = authStore.user?.nickname || authStore.user?.username || '';
    if (!next || next === current) {
      cancelNicknameEdit();
    }
  }
  const profileSaving = ref(false);

  const avatarMenuOpen = ref(false);
  const avatarPreviewOpen = ref(false);
  const avatarInputRef = ref<HTMLInputElement | null>(null);

  const displayStats = computed((): ProfileStats => ({
    favorite_count: collectionsStore.favoritePaths.length,
    playlist_count: collectionsStore.playlists.length,
    starred_count: stats.value?.starred_count ?? 0,
    history_count: collectionsStore.recentSongs.length,
    listening_count: stats.value?.listening_count ?? 0,
    revision: stats.value?.revision ?? 0,
    updated_at: stats.value?.updated_at ?? null,
  }));

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
        avatarDraft.value = result.user.avatar || '';
      }
      if (result?.nicknamePending) {
        nicknameStatus.value = 'pending';
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
      avatarStatus.value = 'pending';
      showToast('头像已上传，等待管理员审核', 'success');
    } catch (error) {
      const tip = error instanceof Error ? error.message : '头像上传失败';
      showToast(tip, 'error');
    } finally {
      avatarUploading.value = false;
    }
  }

  const refreshingAvatarStatus = ref(false);
  async function refreshAvatarStatus() {
    if (refreshingAvatarStatus.value) return;
    refreshingAvatarStatus.value = true;
    try {
      const [avatarSt, nicknameSt] = await Promise.all([getAvatarStatus(), getNicknameStatus().catch(() => 'none' as const)]);
      avatarStatus.value = avatarSt;
      nicknameStatus.value = nicknameSt;
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
      const image = await downloadApi.fetchImageBytes(url);
      const ext = image.mime.includes('png') ? 'png'
        : image.mime.includes('webp') ? 'webp'
        : image.mime.includes('gif') ? 'gif'
        : image.mime.includes('jpeg') || image.mime.includes('jpg') ? 'jpg'
        : 'png';
      const defaultName = `avatar_${authStore.user?.username || 'user'}.${ext}`;
      const savedPath = await downloadApi.saveBytesViaDialog(
        defaultName,
        { name: '图片', extensions: [ext] },
        image.data,
      );
      if (savedPath === null) return;
      showToast('头像已保存到本地', 'success');
    } catch (error) {
      const tip = error instanceof Error ? error.message : '保存失败';
      showToast(tip, 'error');
    } finally {
      avatarUploading.value = false;
    }
  }

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
      loginMethod.value = 'password';
      message.value = '';
      showToast('已退出登录', 'info');
    } finally {
      loading.value = false;
    }
  }

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

  async function loadLoggedInProfile() {
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
    avatarStatus.value = await getAvatarStatus();
    try {
      nicknameStatus.value = await getNicknameStatus();
    } catch {
      nicknameStatus.value = 'none';
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const POLL_INTERVAL = 30000;

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!authStore.isLoggedIn) return;
      if (avatarStatus.value !== 'pending' && nicknameStatus.value !== 'pending') {
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

  onUnmounted(() => {
    stopPolling();
    if (bindCodeTimer) {
      clearInterval(bindCodeTimer);
      bindCodeTimer = null;
    }
  });

  return {
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
    confirmProfileLimit,
    openAvatarMenu,
    openNicknameEditModal,
    submitNicknameEdit,
    cancelNicknameEdit,
    onNicknameBlur,
    handleSaveProfile,
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
    stopPolling,
  };
}
