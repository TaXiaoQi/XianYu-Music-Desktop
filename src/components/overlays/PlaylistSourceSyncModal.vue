<script setup lang="ts">
defineProps<{
  visible: boolean;
  addCount: number;
  removeCount: number;
}>();
const emit = defineEmits<{
  (event: 'choice', value: 'add' | 'full'): void;
  (event: 'cancel'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div
        v-if="visible"
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm select-none"
        @click.self="emit('cancel')"
      >
        <div class="modal-content w-96 overflow-hidden">
          <div class="px-6 pt-6 pb-3 text-center">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white">检测到源端歌单更新</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-300">新增 {{ addCount }} 首，源端已移除 {{ removeCount }} 首</p>
          </div>

          <div class="px-6 pb-4">
            <button
              class="w-full rounded-lg px-4 py-3 text-left transition-colors focus:outline-none hover:bg-black/5 dark:hover:bg-white/5"
              @click="emit('choice', 'add')"
            >
              <div class="text-sm font-medium text-gray-800 dark:text-white">仅添加新歌曲</div>
              <div class="text-xs text-gray-500 dark:text-gray-300 mt-0.5">保留本机现有歌曲不变</div>
            </button>
            <button
              class="w-full rounded-lg px-4 py-3 text-left transition-colors focus:outline-none hover:bg-black/5 dark:hover:bg-white/5"
              @click="emit('choice', 'full')"
            >
              <div class="text-sm font-medium text-gray-800 dark:text-white">完全同步</div>
              <div class="text-xs text-gray-500 dark:text-gray-300 mt-0.5">删除本机 {{ removeCount }} 首源端已移除的歌曲，并添加新歌曲</div>
            </button>
          </div>

          <div class="flex border-t border-black/5 dark:border-white/10">
            <button
              @click="emit('cancel')"
              class="flex-1 py-3 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus:outline-none"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
