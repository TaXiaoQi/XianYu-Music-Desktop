<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Loader2, Plus, X } from 'lucide-vue-next';
import { useBanDialog } from '../../composables/useBanDialog';
import { submitAppeal } from '../../services/domain/usageStats';
import { submitFeedback } from '../../services/domain/usageStatsReport';
import { useToast } from '../../composables/toast';

const { showToast } = useToast();

const { banDialogState, resolveBanDialog } = useBanDialog();

const mode = computed(() => banDialogState.value.mode);

const isBetaMode = computed(
  () => mode.value === 'beta' || mode.value === 'betaPending' || mode.value === 'betaUnverified',
);

const APPEAL_MAX = 1000;
const appealing = ref(false);
const appealText = ref('');
const submitting = ref(false);
const betaSubmitted = ref(false);
const BETA_MAX_IMAGES = 6;
const betaImages = ref<string[]>([]);
const betaImageInput = ref<HTMLInputElement | null>(null);
const compressingImage = ref(false);

watch(
  () => banDialogState.value.visible,
  (visible) => {
    if (!visible) {
      appealing.value = false;
      appealText.value = '';
      submitting.value = false;
      betaSubmitted.value = false;
      betaImages.value = [];
      compressingImage.value = false;
    }
  },
);

const title = computed(() => {
  if (banDialogState.value.mode === 'session') return '登录验证失败';
  if (banDialogState.value.mode === 'login') return '请先登录';
  if (banDialogState.value.mode === 'beta') return '未获得内测资格';
  if (banDialogState.value.mode === 'betaPending') return '内测申请审核中';
  if (banDialogState.value.mode === 'betaUnverified') return '无法验证内测资格';
  return banDialogState.value.banType === 'device' ? '设备已被封禁' : '账号已被封禁';
});

const reasonText = computed(() => {
  if (banDialogState.value.mode === 'session') {
    return banDialogState.value.reason || '登录状态已失效，请重新登录账号以继续使用。';
  }
  if (banDialogState.value.mode === 'login') {
    return banDialogState.value.reason || '请先登录账号，登录后即可查看该用户的收藏与歌单。';
  }
  if (banDialogState.value.mode === 'beta') {
    return '当前设备未申请内测资格，无法使用内测版本。\n点击「申请资格」填写申请理由，管理员同意后即可继续使用。';
  }
  if (banDialogState.value.mode === 'betaPending') {
    return '该设备的内测申请正在审核中，请耐心等待管理员审核，审核结果将以反馈回复通知。';
  }
  if (banDialogState.value.mode === 'betaUnverified') {
    return '请连接网络后重试。若持续失败，请联系管理员。';
  }
  return banDialogState.value.reason || '你的账号已被管理员封禁，如有疑问请联系管理员。';
});

function confirm() {
  resolveBanDialog(true);
}

function confirmClose() {
  resolveBanDialog(false);
}

function goLogin() {
  resolveBanDialog(true);
}

function cancelAppeal() {
  appealing.value = false;
}

function startAppeal() {
  appealText.value = '';
  appealing.value = true;
}

async function submitAppealHandler() {
  const content = appealText.value.trim();
  if (!content) {
    showToast('请填写申诉内容', 'error');
    return;
  }
  if (content.length > APPEAL_MAX) {
    showToast(`申诉内容不能超过 ${APPEAL_MAX} 字`, 'error');
    return;
  }
  if (!banDialogState.value.ciyuanxiId && !banDialogState.value.debug) {
    showToast('登录信息已失效，无法提交申诉，请重新登录账号', 'error');
    return;
  }
  submitting.value = true;
  try {
    if (banDialogState.value.debug) {
      await new Promise((r) => setTimeout(r, 600));
      showToast('（调试）申诉已提交，请耐心等待处理', 'success');
    } else {
      await submitAppeal(
        banDialogState.value.ciyuanxiId,
        banDialogState.value.nickname,
        content,
      );
      showToast('申诉已提交，请耐心等待处理', 'success');
    }
    resolveBanDialog(false);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '申诉提交失败', 'error');
  } finally {
    submitting.value = false;
  }
}

function exitApp() {
  resolveBanDialog(true);
}

function retryVerify() {
  resolveBanDialog(true);
}

function exitUnverified() {
  resolveBanDialog(false);
}

function startBetaApply() {
  appealText.value = '';
  appealing.value = true;
}

const compressImageToDataUrl = (file: File, maxWidth = 1600, quality = 0.82): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.width = 0;
        canvas.height = 0;
        img.onload = null;
        img.onerror = null;
        img.src = '';
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
};

const triggerBetaImageSelect = () => {
  betaImageInput.value?.click();
};

const onBetaImageChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  if (betaImages.value.length + files.length > BETA_MAX_IMAGES) {
    showToast(`最多上传 ${BETA_MAX_IMAGES} 张图片`, 'error');
    return;
  }
  compressingImage.value = true;
  try {
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        showToast(`图片 ${file.name} 超过 8MB，已跳过`, 'error');
        continue;
      }
      betaImages.value.push(await compressImageToDataUrl(file));
    }
  } catch (error: any) {
    showToast(`图片处理失败：${error?.message || error}`, 'error');
  } finally {
    compressingImage.value = false;
  }
};

const removeBetaImage = (index: number) => {
  betaImages.value.splice(index, 1);
};

async function submitBetaApply() {
  const content = appealText.value.trim();
  if (!content) {
    showToast('请填写内测申请理由', 'error');
    return;
  }
  if (content.length > APPEAL_MAX) {
    showToast(`申请理由不能超过 ${APPEAL_MAX} 字`, 'error');
    return;
  }
  if (compressingImage.value) return;
  submitting.value = true;
  try {
    await submitFeedback('内测申请', content, {
      feedbackType: 'beta',
      images: betaImages.value.length > 0 ? [...betaImages.value] : undefined,
    });
    showToast('申请已提交，请耐心等待审核', 'success');
    betaSubmitted.value = true;
    appealing.value = false;
    betaImages.value = [];
  } catch (error) {
    showToast(error instanceof Error ? error.message : '申请提交失败', 'error');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <transition name="ban-modal" appear>
      <div
        v-if="banDialogState.visible"
        class="ban-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
        @click.self="!appealing && !isBetaMode && (mode === 'session' || mode === 'login' ? confirmClose() : confirm())"
      >
        <div class="ban-card">
          <div class="ban-icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM9 14.5a1 1 0 112 0 1 1 0 01-2 0z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
          <h3 class="ban-title">{{ title }}</h3>
          <p v-if="mode === 'session'" class="ban-version">请重新登录账号以继续</p>
          <p v-else-if="mode === 'login'" class="ban-version">登录后即可查看该用户的收藏与歌单</p>
          <p v-else-if="mode === 'beta'" class="ban-version">当前设备未申请内测资格</p>
          <p v-else-if="mode === 'betaPending'" class="ban-version">内测申请正在审核中</p>
          <p v-else-if="mode === 'betaUnverified'" class="ban-version">请检查网络连接</p>
          <p v-else-if="banDialogState.ciyuanxiId" class="ban-version">弦予号 {{ banDialogState.ciyuanxiId }}</p>
          <p v-else class="ban-version">当前设备已受限</p>

          <div v-if="!appealing" class="ban-content">
            <p class="ban-desc">{{ reasonText }}</p>
          </div>

          <div v-else class="ban-content">
            <textarea
              v-model="appealText"
              class="ban-textarea"
              :maxlength="APPEAL_MAX"
              rows="4"
              :placeholder="mode === 'beta' ? '请填写内测申请理由，我们会尽快审核处理…' : '请填写申诉理由，我们会尽快审核处理…'"
            ></textarea>
            <div class="ban-counter">{{ appealText.length }} / {{ APPEAL_MAX }}</div>
            <template v-if="mode === 'beta'">
              <div class="ban-img-row">
                <div v-for="(img, idx) in betaImages" :key="idx" class="ban-img-item">
                  <img :src="img" alt="申请附图" class="ban-img-preview" />
                  <button type="button" class="ban-img-remove" @click="removeBetaImage(idx)">
                    <X class="h-3 w-3" />
                  </button>
                </div>
                <button
                  v-if="betaImages.length < BETA_MAX_IMAGES"
                  type="button"
                  class="ban-img-add"
                  :disabled="compressingImage"
                  @click="triggerBetaImageSelect"
                >
                  <Plus v-if="!compressingImage" class="h-4 w-4" />
                  <Loader2 v-else class="h-4 w-4 animate-spin" />
                </button>
              </div>
              <input
                ref="betaImageInput"
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                @change="onBetaImageChange"
              />
            </template>
          </div>

          <div v-if="!appealing" class="ban-actions">
            <template v-if="mode === 'session'">
              <button type="button" class="ban-btn ban-btn--ghost" @click="confirmClose">
                确认
              </button>
              <button type="button" class="ban-btn ban-btn--primary" @click="goLogin">
                登录
              </button>
            </template>
            <template v-else-if="mode === 'login'">
              <button type="button" class="ban-btn ban-btn--ghost" @click="confirmClose">
                取消
              </button>
              <button type="button" class="ban-btn ban-btn--primary" @click="goLogin">
                登录
              </button>
            </template>
            <template v-else-if="mode === 'beta'">
              <button type="button" class="ban-btn ban-btn--ghost" @click="exitApp">
                退出软件
              </button>
              <button
                type="button"
                class="ban-btn ban-btn--primary"
                :disabled="betaSubmitted"
                @click="startBetaApply"
              >
                {{ betaSubmitted ? '已申请' : '申请资格' }}
              </button>
            </template>
            <template v-else-if="mode === 'betaPending'">
              <button type="button" class="ban-btn ban-btn--ghost" @click="exitApp">
                退出软件
              </button>
            </template>
            <template v-else-if="mode === 'betaUnverified'">
              <button type="button" class="ban-btn ban-btn--ghost" @click="exitUnverified">
                退出软件
              </button>
              <button type="button" class="ban-btn ban-btn--primary" @click="retryVerify">
                重试
              </button>
            </template>
            <template v-else>
              <button type="button" class="ban-btn ban-btn--ghost" @click="startAppeal">
                申诉
              </button>
              <button type="button" class="ban-btn ban-btn--primary" @click="confirm">
                确认
              </button>
            </template>
          </div>

          <div v-else class="ban-actions">
            <button type="button" class="ban-btn ban-btn--ghost" :disabled="submitting" @click="cancelAppeal">
              取消
            </button>
            <button
              type="button"
              class="ban-btn ban-btn--primary"
              :disabled="submitting || compressingImage"
              @click="mode === 'beta' ? submitBetaApply() : submitAppealHandler()"
            >
              {{ submitting ? '提交中…' : (mode === 'beta' ? '提交申请' : '提交申诉') }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.ban-overlay {
  transition: opacity 0.2s ease;
}

.ban-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ban-modal-enter-active {
  transition: opacity 0.2s ease;
}

.ban-modal-enter-active .ban-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ban-modal-enter-from {
  opacity: 0;
}

.ban-modal-enter-from .ban-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.ban-modal-leave-active {
  transition: opacity 0.2s ease;
}

.ban-modal-leave-active .ban-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ban-modal-leave-to {
  opacity: 0;
}

.ban-modal-leave-to .ban-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
.ban-card {
  width: min(90vw, 400px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.ban-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
  margin: 0 auto 14px;
}

.ban-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
}

.ban-version {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.85);
  margin: 0 0 16px;
}

.ban-content {
  margin-bottom: 18px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  max-height: 40vh;
  overflow-y: auto;
  text-align: left;
}

.ban-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0;
  white-space: pre-line;
}

.ban-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 96px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
  color: #1f2937;
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 10px 12px;
  outline: none;
}

.ban-textarea:focus {
  border-color: #ec4141;
}

.ban-counter {
  margin-top: 6px;
  text-align: right;
  font-size: 0.72rem;
  color: rgba(107, 114, 128, 0.85);
}

.ban-img-row {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ban-img-item {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.ban-img-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ban-img-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s ease;
}

.ban-img-remove:hover {
  background: rgba(0, 0, 0, 0.75);
}

.ban-img-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border: 1px dashed rgba(236, 65, 65, 0.45);
  border-radius: 8px;
  background: rgba(236, 65, 65, 0.05);
  color: #ec4141;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ban-img-add:hover:enabled {
  background: rgba(236, 65, 65, 0.12);
}

.ban-img-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ban-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.ban-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.ban-btn:active {
  transform: scale(0.97);
}

.ban-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ban-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.ban-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.ban-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

.ban-btn--primary:hover {
  background: #d13b3b;
}

html.dark .ban-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .ban-icon {
  background: rgba(236, 65, 65, 0.18);
  color: #fca5a5;
}

html.dark .ban-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .ban-version {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .ban-content {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .ban-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .ban-textarea {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.12);
}

html.dark .ban-counter {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .ban-img-item {
  border-color: rgba(255, 255, 255, 0.1);
}

html.dark .ban-img-add {
  color: #ff6b6b;
  background: rgba(236, 65, 65, 0.1);
}

html.dark .ban-actions {
  background: rgba(255, 255, 255, 0.05);
}

html.dark .ban-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .ban-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .ban-btn--primary {
  background: #ec4141;
  color: #ffffff;
}

html.dark .ban-btn--primary:hover {
  background: #d13b3b;
}
</style>