<script setup lang="ts">
import { computed } from 'vue';
import { Download } from 'lucide-vue-next';
import SettingHint from '../SettingHint.vue';

const props = defineProps<{
  visible: boolean;
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'install'): void;
  (e: 'cancel'): void;
}>();

const installUrl = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
});
</script>

<template>
  <Transition name="settings-pop-panel">
    <div v-if="visible" class="px-4 pb-4">
      <div class="settings-plugin-inline-panel">
        <div class="flex items-center justify-between gap-4">
          <div class="shrink-0 text-sm font-medium text-gray-800 dark:text-gray-200">插件地址</div>
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <SettingHint severity="warning" text="粘贴插件的 JS 文件直链或 JSON 索引地址" />
            <input
              v-model="installUrl"
              type="text"
              class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10 flex-1"
              @keydown.enter="$emit('install')"
            />
            <button
              type="button"
              class="settings-plugin-button"
              @click="$emit('install')"
            >
              <Download class="h-4 w-4" />
              安装
            </button>
            <button
              type="button"
              class="settings-plugin-button settings-plugin-button--ghost"
              @click="$emit('cancel')"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
