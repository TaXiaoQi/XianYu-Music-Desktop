<script setup lang="ts">
import { computed } from 'vue';
import { useProfileLimitDialog } from '../../composables/useProfileLimitDialog';

const { profileLimitDialogState, resolveProfileLimitDialog } = useProfileLimitDialog();

const dialogCopy = computed(() => {
  if (profileLimitDialogState.value.target === 'avatar') {
    return {
      title: '更换头像提示',
      desc: '头像每日只能修改 1 次，上传后需要等待管理员审核。审核通过前会继续显示当前头像。',
      badge: '头像审核',
      confirmText: '继续选择头像',
    };
  }
  return {
    title: '修改昵称提示',
    desc: '昵称每日只能修改 1 次，提交后需要等待管理员审核。审核通过前会继续显示当前昵称。',
    badge: '改名审核',
    confirmText: '继续修改昵称',
  };
});

function confirm() {
  resolveProfileLimitDialog(true);
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
        @click.self="cancel"
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
            <span>请确认本次修改内容无误后再继续。</span>
          </div>

          <div class="profile-limit-actions">
            <button type="button" class="profile-limit-btn profile-limit-btn--ghost" @click="cancel">
              取消
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
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(10px);
}

.profile-limit-card {
  width: min(92vw, 390px);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.26), 0 8px 24px rgba(236, 65, 65, 0.12);
  padding: 26px 24px 22px;
  text-align: center;
  color: #1f2937;
}

.profile-limit-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  margin: 0 auto 12px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
  box-shadow: inset 0 0 0 1px rgba(236, 65, 65, 0.12);
}

.profile-limit-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 10px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
  font-size: 12px;
  font-weight: 700;
}

.profile-limit-title {
  margin: 0;
  color: #111827;
  font-size: 19px;
  font-weight: 850;
  letter-spacing: -0.02em;
}

.profile-limit-desc {
  margin: 10px 0 0;
  color: rgba(31, 41, 55, 0.68);
  font-size: 14px;
  line-height: 1.7;
}

.profile-limit-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
  font-size: 12px;
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

.profile-limit-btn {
  height: 40px;
  border: 0;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
}

.profile-limit-btn:active {
  transform: scale(0.97);
}

.profile-limit-btn--ghost {
  background: rgba(17, 24, 39, 0.06);
  color: rgba(31, 41, 55, 0.72);
}

.profile-limit-btn--ghost:hover {
  background: rgba(17, 24, 39, 0.1);
  color: #111827;
}

.profile-limit-btn--primary {
  background: #ec4141;
  color: #fff;
  box-shadow: 0 14px 28px rgba(236, 65, 65, 0.24);
}

.profile-limit-btn--primary:hover {
  background: #d83a3a;
  box-shadow: 0 18px 34px rgba(236, 65, 65, 0.3);
}

.profile-limit-modal-enter-active,
.profile-limit-modal-leave-active {
  transition: opacity 0.24s ease;
}

.profile-limit-modal-enter-active .profile-limit-card,
.profile-limit-modal-leave-active .profile-limit-card {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease;
}

.profile-limit-modal-enter-from,
.profile-limit-modal-leave-to {
  opacity: 0;
}

.profile-limit-modal-enter-from .profile-limit-card,
.profile-limit-modal-leave-to .profile-limit-card {
  opacity: 0;
  transform: translateY(14px) scale(0.96);
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
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(236, 65, 65, 0.1);
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
  background: rgba(255, 255, 255, 0.08);
  color: rgba(244, 244, 245, 0.72);
}

html.dark .profile-limit-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
</style>
