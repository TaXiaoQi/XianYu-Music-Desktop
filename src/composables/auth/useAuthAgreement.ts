// 用户协议勾选与协议弹窗（滚动到底才能同意）（自 src/views/Auth.vue 拆出，逻辑保持原样）
import { nextTick, ref } from 'vue';

import { getUserAgreement } from '../../services/auth/authService';
import { useToast } from '../toast';

const defaultAgreementContent = `一、协议范围
本协议适用于弦予音乐客户端账号系统及相关云端同步、资料管理、统计上报、风控安全服务。用户注册、登录或继续使用账号功能，即表示已阅读并同意本协议。

二、账号注册与使用
用户应使用真实、有效的邮箱完成注册，并妥善保管账号、密码和邮箱验证码。因用户主动泄露、共享账号或使用非官方客户端造成的损失，由用户自行承担。

三、本地数据读取说明
为提供账号登录、设备安全识别、播放统计、同步和故障排查功能，账号系统可能读取或生成以下本地数据：本机设备标识、客户端版本、操作系统版本、设备厂商与型号、登录状态凭证、用户主动上传的头像、本地收藏、歌单、播放历史、听歌时长等音乐使用数据，以及软件运行错误日志。上述数据仅用于账号服务、安全风控、功能同步、异常定位和产品维护。

四、数据上报与安全
客户端启动、登录、注册、搜索、播放统计、错误反馈等行为可能向服务器上报必要信息，包括设备ID、IP地址、账号ID、客户端版本、操作系统版本、设备厂商、设备型号、行为时间和必要的请求参数。为便于准确排查和定位问题，提交问题反馈或错误日志时，客户端还会一并上报当前设备的具体厂商、型号及系统版本等详细信息（例如手机厂商与机型、系统版本号；桌面端操作系统版本与设备型号）。我们将尽合理努力保护数据安全，不会主动出售用户个人信息。

五、禁止行为
用户不得利用账号系统进行恶意攻击、批量注册、刷量、破解、逆向、绕过限制、上传违法违规内容、干扰服务器稳定性或侵犯他人权益。发现异常行为时，平台有权限制、封禁账号或设备。

六、封禁与申诉
若账号或设备因违反协议、安全风控或恶意行为被封禁，登录时将提示封禁状态及原因。用户如认为处理有误，可联系管理员并提供账号、设备ID及相关说明进行核查。

七、协议更新
平台可根据功能调整、安全要求或法律合规需要更新本协议。更新后继续使用账号功能，视为接受更新后的协议内容。`;

export function useAuthAgreement() {
  const { showToast } = useToast();

  const agreementAccepted = ref(false);
  const termsModalOpen = ref(false);
  const termsScrolledToEnd = ref(false);
  const termsBodyRef = ref<HTMLElement | null>(null);
  const agreementTitle = ref('弦予音乐用户协议');

  const agreementContent = ref(defaultAgreementContent);

  async function loadUserAgreement() {
    try {
      const agreement = await getUserAgreement();
      if (agreement.title.trim()) {
        agreementTitle.value = agreement.title.trim();
      }
      if (agreement.content.trim()) {
        agreementContent.value = agreement.content.trim();
      }
    } catch {
      agreementTitle.value = '弦予音乐用户协议';
      agreementContent.value = defaultAgreementContent;
    }
  }

  async function openTermsModal() {
    termsScrolledToEnd.value = false;
    termsModalOpen.value = true;
    await nextTick();
    refreshTermsScrollState();
  }

  function closeTermsModal() {
    termsModalOpen.value = false;
  }

  function refreshTermsScrollState() {
    const el = termsBodyRef.value;
    if (!el) return;
    const hasScrollableContent = el.scrollHeight > el.clientHeight + 4;
    if (!hasScrollableContent) {
      termsScrolledToEnd.value = true;
      return;
    }
    termsScrolledToEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
  }

  function handleAgreementCheckboxChange(event: Event) {
    const checked = (event.target as HTMLInputElement | null)?.checked ?? false;
    if (!checked) {
      agreementAccepted.value = false;
      return;
    }
    agreementAccepted.value = false;
    void openTermsModal();
  }

  function acceptTerms() {
    if (!termsScrolledToEnd.value) {
      showToast('请先阅读并滚动到用户协议底部', 'error');
      return;
    }
    agreementAccepted.value = true;
    termsModalOpen.value = false;
  }

  return {
    agreementAccepted,
    termsModalOpen,
    termsScrolledToEnd,
    termsBodyRef,
    agreementTitle,
    agreementContent,
    loadUserAgreement,
    openTermsModal,
    closeTermsModal,
    refreshTermsScrollState,
    handleAgreementCheckboxChange,
    acceptTerms,
  };
}
