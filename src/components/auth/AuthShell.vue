<script setup lang="ts">
import type { AuthMode } from '../../services/auth/authService';

// 未登录区布局壳：标题头、模式切换导航、表单过渡与消息提示（自 src/views/Auth.vue 拆出，样式保持原样）
defineProps<{
  mode: AuthMode;
  headerLabel: string;
  title: string;
  subtitle: string;
  message: string;
  messageTone: 'error' | 'success';
}>();

const emit = defineEmits<{
  (e: 'switch-mode', next: AuthMode): void;
}>();
</script>

<template>
  <div class="animate-fade-in-up">
    <header class="pb-[clamp(0.25rem,0.5vw,0.5rem)]">
      <p class="text-black/70 dark:text-white/70 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider mb-2">{{ headerLabel }}</p>
      <h2 class="text-black dark:text-white text-[clamp(1.75rem,4vw,3rem)] font-black tracking-tight leading-none">{{ title }}</h2>
      <p class="text-black/60 dark:text-white/60 text-[clamp(0.875rem,1.2vw,1.125rem)] font-light mt-2 max-w-xl">{{ subtitle }}</p>
    </header>

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
          @click="emit('switch-mode', 'login')"
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
          @click="emit('switch-mode', 'register')"
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
          @click="emit('switch-mode', 'login')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
          返回登录
        </button>
      </div>
    </nav>

    <Transition name="auth-mode" mode="out-in">
      <slot />
    </Transition>

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
</template>
