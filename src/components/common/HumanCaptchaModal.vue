<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import {
  getHumanCaptchaConfig,
  getHumanCaptcha,
  verifyHumanCaptcha,
  type HumanCaptcha,
  type HumanCaptchaConfig,
  type HumanCaptchaPayload,
} from '../../services/auth/authService';

const props = withDefaults(defineProps<{
  open: boolean;
  title?: string;
  description?: string;
}>(), {
  title: '人机验证',
  description: '请先完成验证，验证通过后将继续当前操作。',
});

const emit = defineEmits<{
  (event: 'verified', payload: HumanCaptchaPayload): void;
  (event: 'cancel'): void;
}>();

const captchaConfig = ref<HumanCaptchaConfig>({
  enabled: false,
  provider: 'off',
  siteKey: '',
});
const captcha = ref<HumanCaptcha | null>(null);
const answer = ref('');
const providerToken = ref('');
const providerWidgetId = ref<string | number | null>(null);
const providerBoxRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const verifying = ref(false);
const errorText = ref('');
const answerInputRef = ref<HTMLInputElement | null>(null);

function captchaGlobal(): any {
  return captchaConfig.value.provider === 'hcaptcha' ? (window as any).hcaptcha : (window as any).turnstile;
}

function isProviderCaptchaEnabled(): boolean {
  return Boolean(captchaConfig.value.enabled && captchaConfig.value.siteKey && captchaConfig.value.provider !== 'off');
}

function loadProviderScript(): Promise<void> {
  if (!isProviderCaptchaEnabled() || captchaGlobal()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const provider = captchaConfig.value.provider === 'hcaptcha' ? 'hcaptcha' : 'turnstile';
    const existing = document.querySelector<HTMLScriptElement>(`script[data-human-captcha-provider="${provider}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('captcha script load failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = provider === 'hcaptcha'
      ? 'https://js.hcaptcha.com/1/api.js?render=explicit'
      : 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.humanCaptchaProvider = provider;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('captcha script load failed'));
    document.head.appendChild(script);
  });
}

async function renderProviderCaptcha() {
  if (!isProviderCaptchaEnabled()) return;
  await nextTick();
  if (!providerBoxRef.value || providerWidgetId.value != null) return;
  await loadProviderScript();
  const captchaApi = captchaGlobal();
  if (!captchaApi) throw new Error('人机验证组件加载失败');
  providerWidgetId.value = captchaApi.render(providerBoxRef.value, {
    sitekey: captchaConfig.value.siteKey,
    callback: (token: string) => { providerToken.value = token; },
    'expired-callback': () => { providerToken.value = ''; },
    'error-callback': () => { providerToken.value = ''; },
  });
}

function resetProviderCaptcha() {
  const captchaApi = captchaGlobal();
  if (!captchaApi || providerWidgetId.value == null) return;
  providerToken.value = '';
  captchaApi.reset(providerWidgetId.value);
}

async function refreshCaptcha() {
  loading.value = true;
  answer.value = '';
  providerToken.value = '';
  errorText.value = '';
  try {
    captchaConfig.value = await getHumanCaptchaConfig();
    if (isProviderCaptchaEnabled()) {
      captcha.value = null;
      await renderProviderCaptcha();
    } else {
      captcha.value = await getHumanCaptcha();
      await nextTick();
      answerInputRef.value?.focus();
    }
  } catch (error) {
    captcha.value = null;
    errorText.value = error instanceof Error ? error.message : '验证题加载失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function cancel() {
  emit('cancel');
}

async function submit() {
  if (isProviderCaptchaEnabled()) {
    if (!providerToken.value.trim()) {
      errorText.value = '请先完成人机验证';
      return;
    }
    emit('verified', {
      captchaToken: providerToken.value,
      provider: captchaConfig.value.provider,
    });
    return;
  }

  if (!captcha.value?.captcha_id) {
    errorText.value = '请先加载验证题';
    return;
  }
  const trimmed = answer.value.trim();
  if (!trimmed) {
    errorText.value = '请输入验证答案';
    answerInputRef.value?.focus();
    return;
  }
  const payload = {
    captchaId: captcha.value.captcha_id,
    captchaAnswer: trimmed,
  };

  verifying.value = true;
  errorText.value = '';
  try {
    await verifyHumanCaptcha(payload);
    emit('verified', payload);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '人机验证失败，请重试';
    answer.value = '';
    await nextTick();
    answerInputRef.value?.focus();
  } finally {
    verifying.value = false;
  }
}

watch(
  () => props.open,
  open => {
    if (open) {
      void refreshCaptcha();
    } else {
      captcha.value = null;
      answer.value = '';
      providerToken.value = '';
      providerWidgetId.value = null;
      captchaConfig.value = { enabled: false, provider: 'off', siteKey: '' };
      errorText.value = '';
      loading.value = false;
      verifying.value = false;
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="human-captcha-fade">
      <div
        v-if="open"
        class="human-captcha-mask"
        @click.self="cancel"
      >
        <div class="human-captcha-card">
          <div class="human-captcha-header">
            <div>
              <p class="human-captcha-kicker">安全验证</p>
              <h3 class="human-captcha-title">{{ title }}</h3>
            </div>
            <button
              type="button"
              class="human-captcha-close"
              aria-label="关闭"
              @click="cancel"
            >
              ×
            </button>
          </div>

          <p class="human-captcha-desc">{{ description }}</p>

          <div v-if="isProviderCaptchaEnabled()" class="human-captcha-provider">
            <div ref="providerBoxRef" class="human-captcha-provider-box"></div>
            <button
              type="button"
              class="human-captcha-refresh"
              :disabled="loading"
              @click="resetProviderCaptcha"
            >
              重新验证
            </button>
          </div>

          <div v-else class="human-captcha-question">
            <span>{{ loading ? '正在加载验证题…' : captcha?.question || '验证题加载失败' }}</span>
            <button
              type="button"
              class="human-captcha-refresh"
              :disabled="loading"
              @click="refreshCaptcha"
            >
              {{ loading ? '刷新中…' : '换一题' }}
            </button>
          </div>

          <form class="human-captcha-form" @submit.prevent="submit">
            <input
              v-if="!isProviderCaptchaEnabled()"
              ref="answerInputRef"
              v-model="answer"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="输入答案"
              class="human-captcha-input"
              :disabled="loading || verifying || !captcha"
            />
            <p v-if="errorText" class="human-captcha-error">{{ errorText }}</p>

            <div class="human-captcha-actions">
              <button
                type="button"
                class="human-captcha-secondary"
                :disabled="verifying"
                @click="cancel"
              >
                取消
              </button>
              <button
                type="submit"
                class="human-captcha-primary"
                :disabled="loading || verifying || (!isProviderCaptchaEnabled() && !captcha)"
              >
                {{ verifying ? '验证中…' : '验证并继续' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.human-captcha-mask {
  position: fixed;
  inset: 0;
  z-index: 10020;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(14px);
}

.human-captcha-card {
  width: min(420px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 24px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.8);
  color: #111827;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.26);
}

:global(.dark) .human-captcha-card {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(17, 24, 39, 0.9);
  color: #f9fafb;
}

.human-captcha-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.human-captcha-kicker {
  margin: 0 0 6px;
  color: #ec4141;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.human-captcha-title {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.15;
}

.human-captcha-close {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  color: inherit;
  cursor: pointer;
  font-size: 24px;
  line-height: 1;
}

:global(.dark) .human-captcha-close {
  background: rgba(255, 255, 255, 0.08);
}

.human-captcha-desc {
  margin: 12px 0 18px;
  color: rgba(17, 24, 39, 0.62);
  font-size: 14px;
  line-height: 1.7;
}

:global(.dark) .human-captcha-desc {
  color: rgba(249, 250, 251, 0.62);
}

.human-captcha-question {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 56px;
  padding: 14px 16px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.03);
  font-size: 18px;
  font-weight: 700;
}

:global(.dark) .human-captcha-question {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
}

.human-captcha-provider {
  display: grid;
  justify-items: center;
  gap: 12px;
  min-height: 92px;
  padding: 16px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.03);
}

:global(.dark) .human-captcha-provider {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
}

.human-captcha-provider-box {
  min-height: 65px;
  display: grid;
  place-items: center;
}

.human-captcha-refresh {
  border: 0;
  background: transparent;
  color: #ec4141;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.human-captcha-refresh:disabled,
.human-captcha-secondary:disabled,
.human-captcha-primary:disabled,
.human-captcha-input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.human-captcha-form {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.human-captcha-input {
  height: 48px;
  border: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.16);
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 18px;
}

.human-captcha-input:focus {
  border-bottom-color: #ec4141;
}

:global(.dark) .human-captcha-input {
  border-bottom-color: rgba(255, 255, 255, 0.18);
}

.human-captcha-error {
  margin: 0;
  color: #ec4141;
  font-size: 13px;
}

.human-captcha-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 6px;
}

.human-captcha-secondary,
.human-captcha-primary {
  height: 40px;
  border: 0;
  border-radius: 999px;
  padding: 0 20px;
  cursor: pointer;
  font-weight: 700;
}

.human-captcha-secondary {
  background: rgba(0, 0, 0, 0.06);
  color: inherit;
}

:global(.dark) .human-captcha-secondary {
  background: rgba(255, 255, 255, 0.08);
}

.human-captcha-primary {
  background: #ec4141;
  color: #fff;
}

.human-captcha-fade-enter-active,
.human-captcha-fade-leave-active {
  transition: opacity 0.18s ease;
}

.human-captcha-fade-enter-from,
.human-captcha-fade-leave-to {
  opacity: 0;
}
</style>
