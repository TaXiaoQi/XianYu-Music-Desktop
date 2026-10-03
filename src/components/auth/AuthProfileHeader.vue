<script setup lang="ts">
import { ref } from 'vue';

import type { AuthUser, ProfileAuditStatus, ProfileStats } from '../../services/auth/authService';

// 已登录区头部（头像/昵称/弦予号/统计）与快捷入口（自 src/views/Auth.vue 拆出，样式保持原样）
defineProps<{
  user: AuthUser | null;
  avatarDraft: string;
  avatarStatus: ProfileAuditStatus;
  nicknameStatus: ProfileAuditStatus;
  avatarUploading: boolean;
  refreshingAvatarStatus: boolean;
  loading: boolean;
  displayStats: ProfileStats;
}>();

const emit = defineEmits<{
  (e: 'open-avatar-menu'): void;
  (e: 'avatar-file-change', event: Event): void;
  (e: 'refresh-status'): void;
  (e: 'edit-nickname'): void;
  (e: 'open-ciyuanxi'): void;
  (e: 'open-bind-email'): void;
  (e: 'logout'): void;
  (e: 'navigate-shortcut', to: string): void;
}>();

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

const avatarBtnRef = ref<HTMLElement | null>(null);
const avatarInputRef = ref<HTMLInputElement | null>(null);

defineExpose({ avatarBtnRef, avatarInputRef });
</script>

<template>
  <header class="px-[clamp(1.5rem,2.8vw,3.5rem)] pt-[clamp(1.25rem,1.8vw,2rem)] pb-[clamp(0.5rem,1vw,1rem)] flex items-center justify-between gap-6 flex-wrap animate-fade-in-up">
    <div class="flex items-center gap-[clamp(0.75rem,1.2vw,1.25rem)] min-w-0">
      <div class="flex flex-col items-center gap-1 shrink-0">
        <div class="relative shrink-0">
          <button
            ref="avatarBtnRef"
            type="button"
            class="grid h-[clamp(6rem,7vw,7rem)] w-[clamp(6rem,7vw,7rem)] place-items-center overflow-hidden rounded-full bg-black/5 dark:bg-white/10 text-[#EC4141] text-[clamp(1.25rem,2vw,1.75rem)] font-black ring-2 ring-transparent hover:ring-[#EC4141]/30 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            :disabled="avatarUploading || loading"
            :title="avatarUploading ? '上传中…' : '点击管理头像'"
            @click="emit('open-avatar-menu')"
          >
            <img v-if="avatarDraft || user?.avatar" :src="avatarDraft || user?.avatar || ''" alt="" class="h-full w-full object-cover" />
            <span v-else>{{ (user?.nickname || user?.username || '?').slice(0, 1).toUpperCase() }}</span>
          </button>
          <input
            ref="avatarInputRef"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            class="hidden"
            :disabled="avatarUploading || loading"
            @change="emit('avatar-file-change', $event)"
          />
        </div>
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
            @click="emit('refresh-status')"
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
      <div class="min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <h2
            class="text-black dark:text-white text-[clamp(1.1rem,2.2vw,1.7rem)] font-black tracking-tight leading-none truncate cursor-pointer hover:text-[#EC4141] transition"
            :title="user?.nickname || user?.username || '点击修改昵称'"
            @click="emit('edit-nickname')"
          >
            {{ user?.nickname || user?.username }}
          </h2>
        </div>
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
            @click="emit('refresh-status')"
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
          <p
            v-if="user?.ciyuanxi_id"
            class="text-black/60 dark:text-white/60 text-[clamp(0.7rem,0.95vw,0.825rem)] font-light truncate cursor-pointer hover:text-[#EC4141] transition"
            title="点击修改弦予号"
            @click="emit('open-ciyuanxi')"
          >
            弦予号：{{ user.ciyuanxi_id }}
          </p>
          <p
            v-else-if="user?.email"
            class="text-black/60 dark:text-white/60 text-[clamp(0.7rem,0.95vw,0.825rem)] font-light truncate"
          >
            {{ user.email }}
          </p>
          <p
            v-else
            class="text-black/60 dark:text-white/60 text-[clamp(0.7rem,0.95vw,0.825rem)] font-light truncate"
          >
            未设置
          </p>
          <button
            v-if="!user?.email"
            type="button"
            class="shrink-0 text-[#EC4141] hover:text-[#d13b3b] text-[clamp(0.65rem,0.85vw,0.75rem)] font-medium transition cursor-pointer px-1.5 py-0.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
            title="绑定邮箱"
            @click="emit('open-bind-email')"
          >
            绑定邮箱
          </button>
        </div>
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
        @click="emit('logout')"
      >
        {{ loading ? '退出中…' : '退出登录' }}
      </button>
    </div>
  </header>

  <section class="px-[clamp(1.5rem,2.8vw,3.5rem)] py-[clamp(0.75rem,1.2vw,1.25rem)] animate-fade-in-up" style="animation-delay: 340ms;">
    <p class="text-black dark:text-white text-[clamp(0.95rem,1.4vw,1.125rem)] font-medium tracking-wider mb-4">快捷入口</p>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <button
        v-for="item in personalShortcuts"
        :key="item.label"
        type="button"
        class="grid gap-2 p-4 rounded-xl border border-black/10 dark:border-white/10 hover:border-[#EC4141]/40 hover:bg-red-50/40 dark:hover:bg-red-500/5 text-left transition-colors cursor-pointer"
        @click="emit('navigate-shortcut', item.to)"
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
</template>
