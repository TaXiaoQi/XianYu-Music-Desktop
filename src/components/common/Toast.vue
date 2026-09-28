<script setup lang="ts">
import { useToast as useToastCenter } from '../../composables/toast';
import ToastStatusIcon from './toast/ToastStatusIcon.vue';

const { toasts } = useToastCenter();
</script>

<template>
  <div class="pointer-events-none fixed bottom-20 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2">
    <TransitionGroup
      enter-active-class="duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] transition-all"
      enter-from-class="translate-y-5 scale-90 opacity-0"
      enter-to-class="translate-y-0 scale-100 opacity-100"
      leave-active-class="duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] transition-all"
      leave-from-class="translate-y-0 scale-100 opacity-100"
      leave-to-class="translate-y-5 scale-90 opacity-0"
    >
      <div v-for="toast in toasts" :key="toast.id"
        class="pointer-events-auto flex border border-white/10 bg-black/80 text-sm font-medium text-white shadow-lg backdrop-blur-md"
        :class="toast.progress != null
          ? 'min-w-[240px] flex-col gap-1.5 rounded-2xl px-4 py-2.5'
          : 'items-center gap-2 rounded-full px-4 py-2'"
      >
        <div class="flex items-center gap-2">
          <ToastStatusIcon :busy="toast.progress != null" :kind="toast.type" />
          <span class="max-w-[320px] truncate">{{ toast.text }}</span>
        </div>
        <div v-if="toast.progress != null" class="h-1 w-full overflow-hidden rounded-full bg-white/15">
          <div class="h-full rounded-full bg-[#EC4141] transition-all duration-300 ease-out" :style="{ width: `${toast.progress}%` }"></div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>
