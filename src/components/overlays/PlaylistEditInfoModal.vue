<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

const props = defineProps<{
  visible: boolean;
  playlistId: string;
  initialName: string;
  initialCoverPath?: string;
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'confirm', payload: { name: string; coverPath: string | null }): void;
  (event: 'cancel'): void;
}>();

const isClosing = ref(false);
const nameInput = ref('');
const nameInputRef = ref<HTMLInputElement | null>(null);
const coverPath = ref<string | null>(null);
const coverPreviewUrl = ref<string>('');

watch(() => props.visible, async (val) => {
  if (val) {
    nameInput.value = props.initialName || '';
    coverPath.value = props.initialCoverPath ?? null;
    coverPreviewUrl.value = coverPath.value ? convertFileSrc(coverPath.value) : '';
    await nextTick();
    if (nameInputRef.value) nameInputRef.value.focus();
  } else {
    isClosing.value = false;
  }
});

const handleSelectCover = async () => {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    title: '选择歌单封面',
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
      },
    ],
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  coverPath.value = selected as string;
  coverPreviewUrl.value = convertFileSrc(selected as string);
};

const handleRemoveCover = () => {
  coverPath.value = null;
  coverPreviewUrl.value = '';
};

const handleClose = () => {
  isClosing.value = true;
  setTimeout(() => {
    emit('cancel');
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const hasNameChanged = computed(() => nameInput.value.trim() !== props.initialName.trim());
const hasCoverChanged = computed(() => (coverPath.value ?? null) !== (props.initialCoverPath ?? null));
const canConfirm = computed(() => nameInput.value.trim().length > 0 && (hasNameChanged.value || hasCoverChanged.value));

const handleConfirm = () => {
  if (!nameInput.value.trim() || !canConfirm.value) return;
  isClosing.value = true;
  setTimeout(() => {
    emit('confirm', {
      name: nameInput.value.trim(),
      coverPath: coverPath.value,
    });
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  if (e.key === 'Escape') {
    handleClose();
  } else if (e.key === 'Enter') {
    handleConfirm();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{ 'pointer-events-none': isClosing }"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- Modal Card -->
      <div
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-300"
        style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Header -->
        <div class="px-6 pt-6 pb-2 text-center">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white leading-6">修改信息</h3>
        </div>

        <!-- Body -->
        <div class="px-6 pb-6 space-y-5">
          <!-- 封面 -->
          <div class="flex flex-col items-center gap-3">
            <div
              class="relative w-28 h-28 rounded-xl overflow-hidden flex items-center justify-center bg-gray-100 dark:bg-black/20 border border-gray-200 dark:border-gray-700 shadow-sm shrink-0"
            >
              <img
                v-if="coverPreviewUrl"
                :src="coverPreviewUrl"
                alt="封面预览"
                class="w-full h-full object-cover animate-in fade-in duration-300"
              />
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-10 h-10 text-gray-300 dark:text-white/20"
              >
                <path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="handleSelectCover"
                class="px-4 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 transition active:scale-95"
              >
                {{ coverPath ? '更换封面' : '选择封面' }}
              </button>
              <button
                v-if="coverPath"
                type="button"
                @click="handleRemoveCover"
                class="px-3 py-1.5 rounded-full text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition active:scale-95"
              >
                移除
              </button>
            </div>
            <p class="text-xs text-gray-400 dark:text-gray-500 text-center m-0">
              不设置则使用歌单内首支歌曲的封面
            </p>
          </div>

          <!-- 名称 -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单名称</label>
            <input
              ref="nameInputRef"
              v-model="nameInput"
              type="text"
              placeholder="请输入歌单名称"
              class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button
            @click="handleConfirm"
            :disabled="!canConfirm"
            class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
          <button
            @click="handleClose"
            class="w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm transition-all duration-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
