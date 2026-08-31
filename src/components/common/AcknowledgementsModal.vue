<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { AcknowledgementsItem } from '../../utils/aboutConfig';

const props = defineProps<{
  visible: boolean;
  items: AcknowledgementsItem[];
}>();

const emit = defineEmits(['close']);

const isClosing = ref(false);

/** 兼容缺少协议头的链接（如 "xianyumusic.cn"），自动补全为 https://，确保能正常在外部浏览器打开 */
function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function openExternal(url: string) {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return;
  try {
    await openUrl(normalized);
  } catch (error) {
    console.error('[AcknowledgementsModal] openUrl 失败，尝试 fallback', normalized, error);
    window.open(normalized, '_blank', 'noopener,noreferrer');
  }
}

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  setTimeout(() => {
    emit('close');
    isClosing.value = false;
  }, 200); // 时长匹配退出动画
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
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
      <!-- 背景盖板 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- 弹窗卡片：窄宽、毛玻璃、居中淡入淡出 -->
      <div
        class="ack-modal-card relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-white/40 shadow-2xl transition-all duration-300 dark:border-white/10"
        :class="isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0'"
      >
        <!-- 标题栏 -->
        <div class="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 class="text-lg font-bold leading-6 text-gray-900 dark:text-white">致谢名单</h3>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
            title="关闭"
            aria-label="关闭"
            @click="handleClose"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <!-- 名单区 -->
        <div class="px-6 pb-6">
          <p class="mb-4 text-center text-xs leading-relaxed text-gray-400 dark:text-white/40">
            感谢以下贡献者与项目，点击名字可跳转对应主页
          </p>

          <div v-if="items.length" class="flex flex-wrap justify-center gap-2">
            <button
              v-for="item in items"
              :key="item.name"
              type="button"
              class="ack-chip group"
              :title="item.url || item.name"
              @click="openExternal(item.url)"
            >
              <span class="ack-chip-name">{{ item.name }}</span>
            </button>
          </div>

          <p v-else class="py-6 text-center text-sm text-gray-400 dark:text-white/40">
            暂无致谢名单，由服务器后台配置下发
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ack-modal-card {
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}
html.dark .ack-modal-card,
.dark .ack-modal-card {
  background: rgba(17, 24, 39, 0.92);
}

/* 名字胶囊：点击可打开对应主页，橙色选中态轻量、符合应用风格 */
.ack-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(255, 255, 255, 0.7);
  color: #1f2937;
  font-size: 13px;
  font-weight: 500;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    transform 120ms ease;
}
.ack-chip:hover {
  border-color: rgba(236, 65, 65, 0.38);
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}
.ack-chip:active {
  transform: scale(0.94);
}
html.dark .ack-chip,
.dark .ack-chip {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.86);
}
html.dark .ack-chip:hover,
.dark .ack-chip:hover {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.12);
  color: #ff8b8b;
}
</style>