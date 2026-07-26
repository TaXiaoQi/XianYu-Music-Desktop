<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../../features/auth/store';
import { useToast } from '../../composables/toast';
import {
  DEFAULT_AUTH_BASE_URL,
  getAuthBaseUrl,
  setAuthBaseUrl,
} from '../../services/auth/authService';

const authStore = useAuthStore();
const { showToast } = useToast();
const router = useRouter();

const draftBaseUrl = ref(getAuthBaseUrl());
const isDirty = computed(() => draftBaseUrl.value.trim() !== getAuthBaseUrl());

watch(
  () => authStore.baseUrl,
  (value) => {
    draftBaseUrl.value = value;
  },
);

function handleSaveBaseUrl() {
  const next = draftBaseUrl.value.trim();
  setAuthBaseUrl(next);
  showToast('后端地址已更新', 'success');
}

function handleResetBaseUrl() {
  draftBaseUrl.value = DEFAULT_AUTH_BASE_URL;
  setAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
  showToast('已恢复默认后端地址', 'info');
}

function handleOpenAccount() {
  void router.push('/auth');
}

function handleLogout() {
  authStore.reset();
  showToast('已退出登录', 'info');
}
</script>

<template>
  <div class="w-full space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <!-- 登录状态 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        账号状态
      </h2>
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-black/5 dark:bg-white/10 text-[#EC4141] text-sm font-black"
          >
            <img
              v-if="authStore.isLoggedIn && authStore.user?.avatar"
              :src="authStore.user.avatar"
              alt=""
              class="h-full w-full object-cover"
            />
            <span v-else-if="authStore.isLoggedIn">
              {{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}
            </span>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
              <template v-if="authStore.isLoggedIn">
                {{ authStore.user?.nickname || authStore.user?.username }}
              </template>
              <template v-else>未登录</template>
            </div>
            <div class="text-xs text-gray-500 dark:text-white/50 truncate mt-0.5">
              <template v-if="authStore.isLoggedIn">
                @{{ authStore.user?.username }} · {{ authStore.user?.email }}
              </template>
              <template v-else>登录后可同步个人资料到云端服务器</template>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            v-if="authStore.isLoggedIn"
            type="button"
            class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-4 py-1.5 rounded-md text-xs font-medium transition cursor-pointer"
            @click="handleLogout"
          >
            退出登录
          </button>
          <button
            type="button"
            class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 py-1.5 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer"
            @click="handleOpenAccount"
          >
            {{ authStore.isLoggedIn ? '前往个人中心' : '前往登录' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 后端地址 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        后端地址
      </h2>
      <p class="text-xs text-gray-500 dark:text-white/60 m-0 leading-relaxed">
        登录、注册、个人资料等接口的根地址。默认沿用 BakaMusic 的服务端；如自建后端可在此覆盖。
      </p>
      <div class="flex items-stretch gap-2 flex-wrap">
        <input
          v-model="draftBaseUrl"
          type="text"
          placeholder="https://example.com/api"
          spellcheck="false"
          class="flex-1 min-w-[240px] h-10 px-3 bg-transparent border-b border-black/15 dark:border-white/15 text-sm font-mono text-black dark:text-white outline-none transition-all focus:border-[#EC4141] placeholder:text-black/30 dark:placeholder:text-white/30"
        />
        <button
          type="button"
          class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 h-10 rounded-full text-xs font-medium transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isDirty"
          @click="handleSaveBaseUrl"
        >
          保存
        </button>
        <button
          type="button"
          class="border border-black/15 dark:border-white/15 hover:border-[#EC4141]/40 text-black/70 dark:text-white/70 hover:text-[#EC4141] px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer"
          @click="handleResetBaseUrl"
        >
          恢复默认
        </button>
      </div>
      <p class="text-xs text-gray-500 dark:text-white/50 m-0">
        默认地址：<code class="font-mono">{{ DEFAULT_AUTH_BASE_URL }}</code>
      </p>
    </section>
  </div>
</template>
