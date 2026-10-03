// 人机验证码弹窗状态与请求/回调编排（自 src/views/Auth.vue 拆出，逻辑保持原样）
import { ref } from 'vue';

import type { HumanCaptchaPayload } from '../../services/auth/authService';

export function useAuthCaptcha() {
  const captchaModalOpen = ref(false);
  const captchaModalTitle = ref('人机验证');
  const captchaModalDescription = ref('请先完成验证，验证通过后将继续当前操作。');
  let captchaResolver: ((payload: HumanCaptchaPayload | null) => void) | null = null;

  function requestHumanCaptcha(title: string, description: string): Promise<HumanCaptchaPayload | null> {
    captchaModalTitle.value = title;
    captchaModalDescription.value = description;
    captchaModalOpen.value = true;
    return new Promise(resolve => {
      captchaResolver = resolve;
    });
  }

  function resolveHumanCaptcha(payload: HumanCaptchaPayload | null) {
    captchaModalOpen.value = false;
    captchaResolver?.(payload);
    captchaResolver = null;
  }

  function handleCaptchaVerified(payload: HumanCaptchaPayload) {
    resolveHumanCaptcha(payload);
  }

  function handleCaptchaCancel() {
    resolveHumanCaptcha(null);
  }

  return {
    captchaModalOpen,
    captchaModalTitle,
    captchaModalDescription,
    requestHumanCaptcha,
    handleCaptchaVerified,
    handleCaptchaCancel,
  };
}
