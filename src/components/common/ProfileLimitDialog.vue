<script setup lang="ts">
import { computed } from 'vue';
import { useProfileLimitDialog } from '../../composables/useProfileLimitDialog';

const { profileLimitDialogState, resolveProfileLimitDialog } = useProfileLimitDialog();

const dialogCopy = computed(() => {
  if (profileLimitDialogState.value.target === 'ban') {
    const targetName = profileLimitDialogState.value.banType === 'device' ? '设备' : '账号';
    return {
      title: `${targetName}已被封禁`,
      desc: profileLimitDialogState.value.message || `你的${targetName}已被管理员封禁，如有疑问请联系管理员。`,
      badge: '封禁通知',
      confirmText: '我知道了',
      note: '账号已无法继续使用，如有疑问请联系管理员申诉。',
    };
  }
  if (profileLimitDialogState.value.blocked) {
    const targetName = profileLimitDialogState.value.target === 'avatar' ? '头像' : '昵称';
    return {
      title: `${targetName}暂不能修改`,
      desc: profileLimitDialogState.value.message || `${targetName}今日已修改过啦，请明天再试。`,
      badge: profileLimitDialogState.value.target === 'avatar' ? '头像限制' : '改名限制',
      confirmText: '我知道了',
      note: '请确认本次修改内容无误后再继续。',
    };
  }
  if (profileLimitDialogState.value.target === 'avatar') {
    return {
      title: '更换头像提示',
      desc: '头像每日只能修改 1 次，上传后需要等待管理员审核。审核通过前会继续显示当前头像。',
      badge: '头像审核',
      confirmText: '继续选择头像',
      note: '请确认本次修改内容无误后再继续。',
    };
  }
  return {
    title: '修改昵称提示',
    desc: '昵称每日只能修改 1 次，提交后需要等待管理员审核。审核通过前会继续显示当前昵称。',
    badge: '改名审核',
    confirmText: '继续修改昵称',
    note: '请确认本次修改内容无误后再继续。',
  };
});

function confirm() {
  resolveProfileLimitDialog(!profileLimitDialogState.value.blocked);
}

function cancel() {
  resolveProfileLimitDialog(false);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="profile-limit-modal" appear>
      <div
        v-if="profileLimitDialogState.visible"
        class="profile-limit-overlay"
      >
        <div class="profile-limit-card">
          <div class="profile-limit-icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <div class="profile-limit-badge">{{ dialogCopy.badge }}</div>
          <h3 class="profile-limit-title">{{ dialogCopy.title }}</h3>
          <p class="profile-limit-desc">{{ dialogCopy.desc }}</p>

          <div class="profile-limit-note">
            <span class="profile-limit-note-dot"></span>
            <span>{{ dialogCopy.note }}</span>
          </div>

          <div class="profile-limit-actions" :class="{ 'profile-limit-actions--single': profileLimitDialogState.blocked }">
            <button type="button" class="profile-limit-btn profile-limit-btn--ghost" @click="cancel">
              {{ profileLimitDialogState.blocked ? '关闭' : '取消' }}
            </button>
            <button type="button" class="profile-limit-btn profile-limit-btn--primary" @click="confirm">
              {{ dialogCopy.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.profile-limit-overlay {
  position: fixed;
  inset: 0;
  z-index: 320;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.profile-limit-card {
  width: min(90vw, 400px);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 24px 22px 20px;
  text-align: center;
}

.profile-limit-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto 14px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
}

.profile-limit-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 10px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
  font-size: 11px;
  font-weight: 700;
}

.profile-limit-title {
  margin: 0;
  color: #1f2937;
  font-size: 1.05rem;
  font-weight: 700;
}

.profile-limit-desc {
  margin: 8px 0 0;
  color: rgba(75, 85, 99, 0.9);
  font-size: 0.85rem;
  line-height: 1.55;
}

.profile-limit-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
  font-size: 0.75rem;
}

.profile-limit-note-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.16);
}

.profile-limit-actions {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 10px;
  margin-top: 20px;
}

.profile-limit-actions--single {
  grid-template-columns: 1fr;
}

.profile-limit-actions--single .profile-limit-btn--ghost {
  display: none;
}

.profile-limit-btn {
  height: 40px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
}

.profile-limit-btn:active {
  transform: scale(0.97);
}

.profile-limit-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.profile-limit-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.profile-limit-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

.profile-limit-btn--primary:hover {
  background: #d13b3b;
}

.profile-limit-modal-enter-active,
.profile-limit-modal-leave-active {
  transition: opacity 0.2s ease;
}

.profile-limit-modal-enter-active .profile-limit-card,
.profile-limit-modal-leave-active .profile-limit-card {
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease;
}

.profile-limit-modal-enter-from,
.profile-limit-modal-leave-to {
  opacity: 0;
}

.profile-limit-modal-enter-from .profile-limit-card,
.profile-limit-modal-leave-to .profile-limit-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<!-- 深色模式使用非 scoped 选择器，避免 scoped + :global(.dark) 复合选择器构建后丢失目标元素。 -->
<style>
html.dark .profile-limit-overlay {
  background: rgba(0, 0, 0, 0.56);
}

html.dark .profile-limit-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: #262626;
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45), 0 4px 16px rgba(0, 0, 0, 0.2);
}

html.dark .profile-limit-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

html.dark .profile-limit-badge {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

html.dark .profile-limit-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .profile-limit-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .profile-limit-note {
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}

html.dark .profile-limit-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .profile-limit-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}
</style>