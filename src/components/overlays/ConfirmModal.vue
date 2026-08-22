<script setup lang="ts">
defineProps<{
  visible: boolean;
  title: string;
  content: string;
}>();

const emit = defineEmits(['confirm', 'cancel']);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div
        v-if="visible"
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm select-none"
        @click.self="emit('cancel')"
      >
        <div class="modal-content w-80 overflow-hidden">
          <div class="px-6 pt-6 pb-2 text-center">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white">{{ title }}</h3>
          </div>

          <div class="px-6 pb-6 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-300 leading-relaxed">{{ content }}</p>
          </div>

          <div class="flex border-t border-black/5 dark:border-white/10">
            <button
              @click="emit('cancel')"
              class="flex-1 py-3 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus:outline-none"
            >
              取消
            </button>
            <div class="w-[1px] bg-black/5 dark:bg-white/10"></div>
            <button
              @click="emit('confirm')"
              class="flex-1 py-3 text-sm text-[#EC4141] font-medium hover:bg-red-50 dark:hover:bg-[#EC4141]/10 transition-colors focus:outline-none"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>