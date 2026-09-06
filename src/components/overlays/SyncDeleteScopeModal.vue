<script setup lang="ts">
export type SyncDeleteScope = 'local' | 'all' | 'cloud';

defineProps<{
  visible: boolean;
  title: string;
  description?: string;
  canDeleteCloud?: boolean;
}>();
const emit = defineEmits([
  'update:visible',
  'scope',
  'cancel',
]);

const options: Array<{ value: SyncDeleteScope; label: string; subtitle: string }> = [
  { value: 'local', label: '删除本地（云端保留）', subtitle: '仅删除本机，云端与其他设备保留' },
  { value: 'all', label: '删除全部', subtitle: '本机、云端、其他设备一起删除' },
  { value: 'cloud', label: '仅保留本地', subtitle: '云端与其他设备删除，本机保留' },
];
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
            <h3 class="text-lg font-bold text-gray-800 dark:text-white">{{ title }}</h3>
            <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-300">{{ description }}</p>
          </div>

          <div class="px-6 pb-4">
            <button
              v-for="opt in options"
              :key="opt.value"
              :disabled="opt.value !== 'local' && !canDeleteCloud"
              class="w-full rounded-lg px-4 py-3 text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-black/5 dark:enabled:hover:bg-white/5"
              @click="emit('scope', opt.value)"
            >
              <div class="text-sm font-medium text-gray-800 dark:text-white">{{ opt.label }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-300 mt-0.5">{{ opt.subtitle }}</div>
              <div v-if="opt.value !== 'local' && !canDeleteCloud" class="text-xs text-amber-600 dark:text-amber-400 mt-0.5">该歌单暂无云端副本，此选项不可用</div>
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