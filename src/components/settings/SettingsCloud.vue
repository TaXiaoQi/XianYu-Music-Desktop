<script setup lang="ts">
/**
 * 网盘设置页：绑定管理 / 网盘浏览 / 分享链接导入 三个子视图。
 * 引擎在 services/cloud（与移动端/手表端同构）；本页只做交互编排与展示。
 * WebView 范式的盘（139/微云/阿里）在桌面端不做网页登录，
 * 提示去手机端绑定，凭据经账号同步自动下发；百度/夸克/UC 走原生扫码。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import QRCode from 'qrcode';
import DialogSurface from '../common/modal/DialogSurface.vue';

const ModernModal = defineAsyncComponent(() => import('../common/ModernModal.vue'));

import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { cloudProviders, cloudProviderById } from '../../services/cloud/cloudRegistry';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import {
  CloudAccount,
  CloudCaptureResult,
  CloudException,
  CloudFile,
  CloudLoginKind,
  CloudQrLoginSession,
  CloudShareParse,
} from '../../services/cloud/cloudTypes';
import type { CloudProvider } from '../../services/cloud/cloudProvider';
import { CloudSmsRequiredException } from '../../services/cloud/cloudTypes';
import { parseUrlToProvider } from '../../services/cloud/shareLinkParser';
import { CloudPlayContext, cloudSongFromContext } from '../../features/playback/cloudPlaybackResolver';

const { t } = useI18n();
const { showToast } = useToast();
const { playSong, addSongsToQueue } = usePlaybackController();

// 行间分隔线与 PluginCard 同色（rgba(148,163,184,0.12)）；展开列表行用
// 内联 borderBottom 确保颜色生效（Tailwind 任意值语法在部分环境未生成），
// 列表最后一行由 rowStyle 去线收尾
const rowClass = 'flex flex-wrap items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-white/40 dark:hover:bg-white/10';

// 展开列表行分隔线：只在网盘组之间分割——每组最后一行（组尾账号行；
// 未绑定盘则是盘头行自身）与下一盘头之间有线，组内行无线，列表末行无线。
const rowStyle = (pIdx: number, aIdx: number | null): Record<string, string> => {
  const p = cloudProviders[pIdx];
  if (!p) return {};
  const isGroupTail =
    aIdx === null
      ? (accountsMap.value[p.id] ?? []).length === 0
      : aIdx === (accountsMap.value[p.id] ?? []).length - 1;
  const isListLast = pIdx === cloudProviders.length - 1;
  return isGroupTail && !isListLast ? { borderBottom: '1px solid rgba(148,163,184,0.12)' } : {};
};

// 三段折叠面板：与歌词同步补偿同款「点击展开/收起」交互
const bindPanelOpen = ref(false);
const importPanelOpen = ref(false);
const totalBoundCount = computed(() => boundAccountsFlat.value.length);
const chipClass = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all';
const chipActiveClass = 'border-[#EC4141] bg-[#EC4141]/8 text-[#EC4141]';
const chipIdleClass = 'border-gray-200/40 bg-white/20 text-gray-700 hover:border-[#EC4141]/40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200';
const inputClass = 'rounded-lg border border-gray-200/40 bg-white/30 px-2.5 py-1.5 text-xs text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200 dark:placeholder:text-white/30';
const primaryBtnClass = 'rounded-lg bg-[#EC4141] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

// 「新建歌单」弹窗（PlaylistModal）同款控件样式：添加账号/短信校验弹窗专用。
const modalLabelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-300';
const modalHintClass = 'text-xs leading-relaxed text-gray-400 dark:text-white/40';
const modalInputClass = 'w-full rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all';
const modalPrimaryBtnClass = 'w-full inline-flex justify-center items-center gap-2 rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] disabled:opacity-50 disabled:cursor-not-allowed';
const modalCancelBtnClass = 'w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed';

function selectChipClass(active: boolean) {
  return `${chipClass} ${active ? chipActiveClass : chipIdleClass}`;
}

/** 绑定弹窗主按钮可用性：按登录范式取对应 busy/填写状态。 */
const bindSubmitDisabled = computed(() => {
  const p = selectedProvider.value;
  if (!p) return true;
  switch (p.loginKind) {
    case CloudLoginKind.WebviewToken:
      return tokenLoginBusy.value || tokenInput.value.trim() === '';
    case CloudLoginKind.WebviewCookie:
      return cookieLoginBusy.value || cookieInput.value.trim() === '';
    default:
      return loginBusy.value;
  }
});

/** 绑定弹窗主按钮动作：按登录范式分发（QR 自动轮询，无主按钮）。 */
function bindSubmit() {
  const p = selectedProvider.value;
  if (!p) return;
  if (p.loginKind === CloudLoginKind.WebviewToken) void submitTokenLogin();
  else if (p.loginKind === CloudLoginKind.WebviewCookie) void submitCookieLogin();
  else void submitLogin();
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 目录/音频/其他 三档排序（与移动端浏览页一致）。 */
function sortedFiles(files: CloudFile[]): CloudFile[] {
  const rank = (f: CloudFile) => (f.isDir ? 0 : f.isAudio ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'));
}

// ── 绑定管理 ──────────────────────────────────────────────

const accountsMap = ref<Record<string, CloudAccount[]>>({});
const selectedProviderId = ref('');
const loginValues = ref<Record<string, string>>({});
const loginBusy = ref(false);
const smsCooldown = ref(0);
const smsPromptFor = ref('');
const smsPromptCode = ref('');
// 弹窗内「发送验证码」：打开时不自动发码，点击按钮手动触发，60 秒冷却。
const smsResendCooldown = ref(0);
const smsResendBusy = ref(false);
let smsResendTimer: ReturnType<typeof setInterval> | null = null;

const closeSmsPrompt = () => {
  smsPromptFor.value = '';
  smsPromptCode.value = '';
  if (smsResendTimer) {
    clearInterval(smsResendTimer);
    smsResendTimer = null;
  }
  smsResendCooldown.value = 0;
  smsResendBusy.value = false;
};
const qrDataUrl = ref('');
const qrImageUrl = ref('');
const qrWaiting = ref(false);
const qrError = ref('');

let smsTimer: ReturnType<typeof setInterval> | null = null;
let qrPollTimer: ReturnType<typeof setInterval> | null = null;

const selectedProvider = computed<CloudProvider | null>(() => cloudProviderById(selectedProviderId.value));

const refreshAccounts = async () => {
  const map: Record<string, CloudAccount[]> = {};
  for (const p of cloudProviders) {
    map[p.id] = await CloudCredentialsStore.instance.accountsFor(p.id);
  }
  accountsMap.value = map;
};

const boundAccountsFlat = computed(() => {
  const out: Array<{ provider: CloudProvider; account: CloudAccount }> = [];
  for (const p of cloudProviders) {
    for (const a of accountsMap.value[p.id] ?? []) {
      out.push({ provider: p, account: a });
    }
  }
  return out;
});

const boundCountOf = (providerId: string) => (accountsMap.value[providerId] ?? []).length;

const stopQrPoll = () => {
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    qrPollTimer = null;
  }
  qrWaiting.value = false;
};

const startQrLogin = async () => {
  const provider = selectedProvider.value;
  if (!provider) return;
  qrError.value = '';
  qrDataUrl.value = '';
  qrImageUrl.value = '';
  stopQrPoll();
  try {
    const session = await provider.createQrLogin();
    // 服务方直接下发二维码图片（百度）：直接展示，无需本地渲染。
    if (session.qrImageUrl != null && session.qrImageUrl !== '') {
      qrImageUrl.value = session.qrImageUrl;
    } else {
      qrDataUrl.value = await QRCode.toDataURL(session.qrContent);
    }
    qrWaiting.value = true;
    qrPollTimer = setInterval(() => {
      void pollQrLogin(session);
    }, 2000);
  } catch (e) {
    qrError.value = errorMessage(e);
  }
};

const pollQrLogin = async (session: CloudQrLoginSession) => {
  const provider = selectedProvider.value;
  if (!provider || !qrPollTimer) return;
  try {
    const account = await provider.pollQrLogin(session);
    if (!account) return; // 未确认，继续轮询
    stopQrPoll();
    await CloudCredentialsStore.instance.saveAccount(account);
    showToast(t('cloud.bindSuccess'), 'success');
    selectedProviderId.value = '';
    await refreshAccounts();
  } catch (e) {
    if (e instanceof CloudException) {
      // 过期/取消：停止轮询，展示刷新入口
      stopQrPoll();
      qrError.value = e.message;
    }
    // 其他异常（网络抖动）保持轮询
  }
};

const sendSms = async () => {
  const provider = selectedProvider.value;
  if (!provider || smsCooldown.value > 0 || loginBusy.value) return;
  try {
    await provider.sendLoginSms(loginValues.value);
    showToast(t('cloud.smsSent'), 'success');
    smsCooldown.value = 60;
    if (smsTimer) clearInterval(smsTimer);
    smsTimer = setInterval(() => {
      smsCooldown.value -= 1;
      if (smsCooldown.value <= 0 && smsTimer) {
        clearInterval(smsTimer);
        smsTimer = null;
      }
    }, 1000);
  } catch (e) {
    showToast(errorMessage(e), 'error');
  }
};

const submitLogin = async () => {
  const provider = selectedProvider.value;
  if (!provider || loginBusy.value) return;
  loginBusy.value = true;
  try {
    const account = await provider.loginWithFields(loginValues.value);
    await CloudCredentialsStore.instance.saveAccount(account);
    showToast(t('cloud.bindSuccess'), 'success');
    selectedProviderId.value = '';
    loginValues.value = {};
    await refreshAccounts();
  } catch (e) {
    if (e instanceof CloudSmsRequiredException) {
      // 风控要求设备短信二次校验：暂存会话，弹窗收码续登；发码由弹窗内按钮手动触发。
      smsPromptFor.value = e.username;
      smsPromptCode.value = '';
      smsResendCooldown.value = 0;
      smsResendBusy.value = false;
      return;
    }
    showToast(errorMessage(e), 'error');
  } finally {
    loginBusy.value = false;
  }
};

/** 验证码弹窗「发送验证码」：手动触发设备二次校验发码，60 秒冷却。 */
const resendDeviceSmsCode = async () => {
  const provider = selectedProvider.value;
  if (!provider || smsResendBusy.value || smsResendCooldown.value > 0) return;
  smsResendBusy.value = true;
  try {
    await provider.resendDeviceSms(smsPromptFor.value);
    showToast(t('cloud.smsSent'), 'success');
    smsResendCooldown.value = 60;
    if (smsResendTimer) clearInterval(smsResendTimer);
    smsResendTimer = setInterval(() => {
      smsResendCooldown.value -= 1;
      if (smsResendCooldown.value <= 0 && smsResendTimer) {
        clearInterval(smsResendTimer);
        smsResendTimer = null;
      }
    }, 1000);
  } catch (e) {
    showToast(errorMessage(e), 'error');
  } finally {
    smsResendBusy.value = false;
  }
};

/** 验证码弹窗确认：提交设备二次校验完成绑定。 */
const confirmSmsCode = async () => {
  const provider = selectedProvider.value;
  const code = smsPromptCode.value.trim();
  if (!provider || code === '' || loginBusy.value) return;
  loginBusy.value = true;
  try {
    const account = await provider.submitSmsCode(smsPromptFor.value, code);
    await CloudCredentialsStore.instance.saveAccount(account);
    showToast(t('cloud.bindSuccess'), 'success');
    smsPromptFor.value = '';
    smsPromptCode.value = '';
    selectedProviderId.value = '';
    loginValues.value = {};
    await refreshAccounts();
  } catch (e) {
    showToast(errorMessage(e), 'error');
  } finally {
    loginBusy.value = false;
  }
};

const openBind = (p: CloudProvider) => {
  selectedProviderId.value = p.id;
  loginValues.value = {};
  qrError.value = '';
  qrDataUrl.value = '';
  qrImageUrl.value = '';
  stopQrPoll();
  bindDialogLeaving.value = false;
  if (p.loginKind === CloudLoginKind.QrCode) {
    void startQrLogin();
  }
};

// 绑定弹窗（DialogSurface）：关闭走 200ms 退场动画，与 ModernModal 一致
const bindDialogLeaving = ref(false);
let bindDialogSettleTimer: ReturnType<typeof setTimeout> | null = null;

const closeBindDialog = () => {
  if (bindDialogLeaving.value) return;
  bindDialogLeaving.value = true;
  if (bindDialogSettleTimer) clearTimeout(bindDialogSettleTimer);
  bindDialogSettleTimer = setTimeout(() => {
    selectedProviderId.value = '';
    stopQrPoll();
    bindDialogLeaving.value = false;
    bindDialogSettleTimer = null;
  }, 200);
};

// ── Cookie 粘贴登录（webviewCookie 范式盘的桌面端替代） ─────────
// 用户在浏览器登录网页版后复制 Cookie 串粘贴进来，复用 provider 的
// completeLogin（凭据校验/账号构建与移动端 WebView 捕获同一条链路）。

const cookieInput = ref('');
const cookieLoginBusy = ref(false);

const parseCookieHeader = (raw: string): Record<string, string> => {
  // 浏览器导出插件的 JSON 形态：数组 [{name,value},…] / {cookies:[…]} /
  // 平面对象 {name:value}；非法 JSON 落回 k=v 文本解析
  const t = raw.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const dec = JSON.parse(t) as unknown;
      const items = Array.isArray(dec)
        ? dec
        : Array.isArray((dec as { cookies?: unknown[] })?.cookies)
          ? (dec as { cookies: unknown[] }).cookies
          : null;
      const out: Record<string, string> = {};
      if (items) {
        for (const e of items) {
          const k = String((e as { name?: unknown; key?: unknown })?.name ??
            (e as { key?: unknown })?.key ?? '');
          const v = String((e as { value?: unknown })?.value ?? '');
          if (k && v && v !== 'undefined') out[k] = v;
        }
        return out;
      }
      for (const [k, v] of Object.entries(dec as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    } catch {
      // 落回文本解析
    }
  }
  const out: Record<string, string> = {};
  for (const part of raw.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
};

const submitCookieLogin = async () => {
  const provider = selectedProvider.value;
  const raw = cookieInput.value.trim();
  if (!provider || raw === '' || cookieLoginBusy.value) return;
  cookieLoginBusy.value = true;
  try {
    const cookies = parseCookieHeader(raw);
    const account = await provider.completeLogin(new CloudCaptureResult({ cookies }));
    await CloudCredentialsStore.instance.saveAccount(account);
    showToast(t('cloud.bindSuccess'), 'success');
    cookieInput.value = '';
    selectedProviderId.value = '';
    await refreshAccounts();
  } catch (e) {
    showToast(errorMessage(e), 'error');
  } finally {
    cookieLoginBusy.value = false;
  }
};

// webviewToken 范式（阿里/迅雷/微云）粘贴 Token 登录：用户在浏览器登录
// 网页版后从开发者工具复制登录凭据（JSON 或裸 token），复用 provider 的
// completeLogin（与移动端 WebView 捕获同一条账号构建链路）。
const tokenInput = ref('');
const tokenLoginBusy = ref(false);

const submitTokenLogin = async () => {
  const provider = selectedProvider.value;
  const raw = tokenInput.value.trim();
  if (!provider || raw === '' || tokenLoginBusy.value) return;
  tokenLoginBusy.value = true;
  try {
    const account = await provider.completeLogin(new CloudCaptureResult({ token: raw }));
    await CloudCredentialsStore.instance.saveAccount(account);
    showToast(t('cloud.bindSuccess'), 'success');
    tokenInput.value = '';
    selectedProviderId.value = '';
    await refreshAccounts();
  } catch (e) {
    showToast(errorMessage(e), 'error');
  } finally {
    tokenLoginBusy.value = false;
  }
};

// 解绑确认走 ModernModal 弹窗（复用桌面端通用确认弹窗，对齐移动端交互）
const unbindConfirmShown = ref(false);
const unbindConfirmTarget = ref<{ provider: CloudProvider; account: CloudAccount } | null>(null);

const requestUnbind = (p: CloudProvider, a: CloudAccount) => {
  unbindConfirmTarget.value = { provider: p, account: a };
  unbindConfirmShown.value = true;
};

const unbindConfirmText = computed(() => {
  const target = unbindConfirmTarget.value;
  if (!target) return '';
  const name = target.account.nickname || target.account.accountId;
  return t('cloud.unbindConfirmText', { name, provider: target.provider.displayName });
});

const confirmUnbind = () => {
  const target = unbindConfirmTarget.value;
  unbindConfirmShown.value = false;
  unbindConfirmTarget.value = null;
  if (!target) return;
  void (async () => {
    await CloudCredentialsStore.instance.removeAccount(target.provider.id, target.account.accountId);
    showToast(t('cloud.unbindSuccess'), 'success');
    if (selectedProviderId.value === target.provider.id) selectedProviderId.value = '';
    await refreshAccounts();
  })();
};

// ── 分享链接导入 ──────────────────────────────────────────

const importLink = ref('');
const importPwd = ref('');
const importBusy = ref(false);
const importProvider = ref<CloudProvider | null>(null);
const importShare = ref<CloudShareParse | null>(null);
const importTransferBusy = ref(false);

const shareAudioFiles = computed(() => sortedFiles((importShare.value?.files ?? []).filter((f) => !f.isDir)));

const resetImport = () => {
  importProvider.value = null;
  importShare.value = null;
};

const parseImport = async () => {
  const raw = importLink.value.trim();
  if (raw === '' || importBusy.value) return;
  const info = parseUrlToProvider(raw);
  const provider = info ? cloudProviderById(info.providerId) : null;
  if (!info || !provider) {
    showToast(t('cloud.invalidLink'), 'error');
    return;
  }
  importBusy.value = true;
  try {
    const share = await provider.parseShareLink(info.url, importPwd.value.trim() || info.passcode || null);
    importProvider.value = provider;
    importShare.value = share;
  } catch (e) {
    resetImport();
    showToast(errorMessage(e), 'error');
  } finally {
    importBusy.value = false;
  }
};

/** 直链免转存点播；否则转存后按名定位播放（与移动端/手表端一致）。 */
const playShareFile = (file: CloudFile) => {
  const provider = importProvider.value;
  const share = importShare.value;
  if (!provider || !share) return;
  if (share.directPlayable) {
    void (async () => {
      const accounts = await CloudCredentialsStore.instance.accountsFor(provider.id);
      const accountId = accounts[0]?.accountId ?? '_';
      const ctx = new CloudPlayContext({ provider: provider.id, accountId, file, share });
      void playSong(cloudSongFromContext(ctx, provider.displayName));
    })();
    return;
  }
  void transferAndPlay(file);
};

const transferAndPlay = async (clicked: CloudFile) => {
  const provider = importProvider.value;
  const share = importShare.value;
  if (!provider || !share || importTransferBusy.value) return;
  const accounts = await CloudCredentialsStore.instance.accountsFor(provider.id);
  const account = accounts[0];
  if (!account) {
    showToast(t('cloud.needBindFirst'), 'error');
    return;
  }
  importTransferBusy.value = true;
  try {
    const transferred = await provider.transferShareFiles(account.cred, share);
    const audio = transferred.filter((f) => f.isAudio);
    if (audio.length === 0) {
      showToast(t('cloud.noAudio'), 'error');
      return;
    }
    showToast(t('cloud.transferSuccess'), 'success');
    const ordered = sortedFiles(audio);
    const start = Math.max(0, ordered.findIndex((f) => f.name === clicked.name));
    const songs = ordered.map((f) =>
      cloudSongFromContext(
        new CloudPlayContext({ provider: provider.id, accountId: account.accountId, file: f }),
        provider.displayName,
      ),
    );
    const startSong = songs[start];
    if (!startSong) return;
    void playSong(startSong);
    const rest = songs.filter((_, i) => i !== start);
    if (rest.length > 0) addSongsToQueue(rest);
  } catch (e) {
    showToast(errorMessage(e), 'error');
  } finally {
    importTransferBusy.value = false;
  }
};

let unsubCreds: (() => void) | null = null;

onMounted(() => {
  void refreshAccounts();
  // 凭据落盘即刷新：登录同步后台导入绑定后，面板无需重开即跟随
  unsubCreds = CloudCredentialsStore.instance.subscribe(() => {
    void refreshAccounts();
  });
});

onBeforeUnmount(() => {
  unsubCreds?.();
  if (smsTimer) clearInterval(smsTimer);
  stopQrPoll();
  if (bindDialogSettleTimer) clearTimeout(bindDialogSettleTimer);
});
</script>

<template>
  <section class="space-y-3">
    <!-- 标题由宿主（SettingsAccount 网盘分区）提供，这里只渲染内容 -->

    <!-- 平铺分组容器：与其他设置分区同款底色，绑定/浏览/导入三段依次排列 -->
    <div class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <!-- 网盘账号绑定 -->
      <button
        type="button"
        class="desktop-setting-row w-full"
        :aria-expanded="bindPanelOpen"
        @click="bindPanelOpen = !bindPanelOpen"
      >
        <div class="min-w-0">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('cloud.bindManage') }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <div class="text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300">
            {{ totalBoundCount > 0 ? t('cloud.boundCount', { count: totalBoundCount }) : t('cloud.notBound') }}
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 text-gray-400 transition-transform duration-200"
            :class="bindPanelOpen ? 'rotate-180' : ''"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
        </div>
      </button>
      <transition name="settings-pop-panel">
        <div v-if="bindPanelOpen" class="settings-expand-panel">
          <div
            v-for="(p, pIdx) in cloudProviders"
            :key="p.id"
          >
            <!-- 盘头行：盘名/状态 | 添加账号（红色文字，对齐移动端） -->
            <div :class="rowClass" :style="rowStyle(pIdx, null)">
              <span class="min-w-0 flex-1">
                <span class="block whitespace-nowrap text-sm font-medium text-gray-800 dark:text-gray-200">{{ p.displayName }}</span>
                <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                  {{ boundCountOf(p.id) > 0 ? t('cloud.boundCount', { count: boundCountOf(p.id) }) : t('cloud.notBound') }}
                </span>
              </span>
              <button
                v-if="selectedProviderId !== p.id"
                type="button"
                class="shrink-0 text-xs font-medium text-[#EC4141] transition-opacity hover:opacity-75 dark:text-[#ff8b8b]"
                @click="openBind(p)"
              >
                {{ t('cloud.addAccount') }}
              </button>
            </div>

            <!-- 已绑定账号行 -->
            <div
              v-for="(a, aIdx) in accountsMap[p.id] ?? []"
              :key="a.accountId"
              :class="rowClass"
              :style="rowStyle(pIdx, aIdx)"
            >
              <span class="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300">
                {{ a.nickname || a.accountId }}
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-gray-200/60 px-2 py-0.5 text-[11px] transition hover:border-red-400/60 hover:text-red-500 dark:border-white/10"
                @click="requestUnbind(p, a)"
              >
                {{ t('cloud.unbindAction') }}
              </button>
            </div>
          </div>

      <!-- 登录面板已改为弹窗（见模板尾部 DialogSurface） -->
        </div>
      </transition>

      <div class="mx-4 h-px [background:rgba(148,163,184,0.12)]"></div>

      <!-- 分享链接导入 -->
      <button
        type="button"
        class="desktop-setting-row w-full"
        :aria-expanded="importPanelOpen"
        @click="importPanelOpen = !importPanelOpen"
      >
        <div class="min-w-0">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('cloud.importLink') }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <div v-if="importShare" class="max-w-[12rem] truncate text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300">
            {{ t('cloud.recognizedAs', { name: importProvider?.displayName ?? '' }) }}
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 text-gray-400 transition-transform duration-200"
            :class="importPanelOpen ? 'rotate-180' : ''"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
        </div>
      </button>
      <transition name="settings-pop-panel">
        <div v-if="importPanelOpen" class="settings-expand-panel">
          <div class="flex flex-col items-stretch">
            <div class="flex flex-wrap items-center gap-2">
          <input
            v-model="importLink"
            type="text"
            :placeholder="t('cloud.linkPlaceholder')"
            :aria-label="t('cloud.linkPlaceholder')"
            :class="inputClass"
            class="min-w-[16rem] flex-1"
            @keydown.enter="parseImport"
          >
          <input
            v-model="importPwd"
            type="text"
            :placeholder="t('cloud.passcodePlaceholder')"
            :aria-label="t('cloud.passcodePlaceholder')"
            :class="inputClass"
            class="w-36"
          >
          <button type="button" :class="primaryBtnClass" class="shrink-0" :disabled="importBusy" @click="parseImport">
            {{ t('cloud.parseAction') }}
          </button>
        </div>

        <template v-if="importProvider && importShare">
          <div class="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {{ t('cloud.recognizedAs', { name: importProvider.displayName }) }}
          </div>
          <div
            v-for="f in shareAudioFiles"
            :key="f.id"
            class="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/40 px-3 py-2 dark:border-gray-800/40"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
              🎵 {{ f.name }}
            </span>
            <button
              type="button"
              :class="selectChipClass(false)"
              class="shrink-0"
              :disabled="importTransferBusy"
              @click="playShareFile(f)"
            >
              {{ importShare.directPlayable ? t('cloud.play') : t('cloud.transferPlay') }}
            </button>
          </div>
          <div v-if="shareAudioFiles.length === 0" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {{ t('cloud.noAudio') }}
          </div>
        </template>
          </div>
        </div>
      </transition>
    </div>

    <!-- 短信验证码弹窗（登录风控二次校验，如天翼 -133）：与「新建歌单」弹窗同款外观 -->
    <DialogSurface
      :shown="smsPromptFor !== ''"
      :leaving="false"
      @backdrop-click="closeSmsPrompt"
    >
      <div class="flex flex-col items-stretch">
        <div class="flex flex-col gap-2 px-6 pb-4 pt-5">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('cloud.smsPromptTitle') }}</p>
          <p :class="modalHintClass">{{ t('cloud.smsPromptBody', { u: smsPromptFor }) }}</p>
          <input
            v-model="smsPromptCode"
            type="text"
            inputmode="numeric"
            maxlength="6"
            :placeholder="t('cloud.smsCode')"
            :class="modalInputClass"
            @keyup.enter="confirmSmsCode"
          />
        </div>
        <div class="flex flex-col gap-3 px-4 py-3 sm:flex-row-reverse bg-gray-50/50 dark:bg-white/5">
          <button
            type="button"
            :class="modalPrimaryBtnClass"
            :disabled="loginBusy || smsPromptCode.trim() === ''"
            @click="confirmSmsCode"
          >
            {{ t('cloud.confirm') }}
          </button>
          <button type="button" :class="modalCancelBtnClass" :disabled="loginBusy" @click="closeSmsPrompt">
            {{ t('cloud.cancel') }}
          </button>
          <button
            type="button"
            :class="modalCancelBtnClass"
            :disabled="smsResendBusy || smsResendCooldown > 0"
            @click="resendDeviceSmsCode"
          >
            {{
              smsResendCooldown > 0
                ? t('cloud.smsResendIn', { s: smsResendCooldown })
                : t('cloud.sendSms')
            }}
          </button>
        </div>
      </div>
    </DialogSurface>

    <!-- 添加账号弹窗：扫码/账密/WebView 引导，与「新建歌单」弹窗同款外观 -->
    <DialogSurface
      :shown="!!selectedProvider"
      :leaving="bindDialogLeaving"
      @backdrop-click="closeBindDialog"
    >
      <div v-if="selectedProvider" class="flex flex-col items-stretch">
        <div class="flex flex-col gap-3 px-6 pb-4 pt-5">
          <p :class="modalLabelClass">{{ t('cloud.bindAction') }} · {{ selectedProvider.displayName }}</p>

          <!-- webviewToken 范式：粘贴登录 Token（JSON 或裸 token） -->
          <div
            v-if="selectedProvider.loginKind === CloudLoginKind.WebviewToken"
            class="flex flex-col gap-2"
          >
            <p :class="modalHintClass">
              {{ t('cloud.tokenLoginHint', { name: selectedProvider.displayName }) }}
            </p>
            <textarea
              v-model="tokenInput"
              :placeholder="t('cloud.tokenLoginPlaceholder')"
              :aria-label="t('cloud.tokenLoginHint', { name: selectedProvider.displayName })"
              :class="modalInputClass"
              class="h-24 resize-none font-mono break-all"
              spellcheck="false"
            ></textarea>
          </div>

          <!-- webviewCookie 范式：粘贴 Cookie 登录 -->
          <div
            v-else-if="selectedProvider.loginKind === CloudLoginKind.WebviewCookie"
            class="flex flex-col gap-2"
          >
            <p :class="modalHintClass">{{ t('cloud.cookieLoginHint') }}</p>
            <textarea
              v-model="cookieInput"
              :placeholder="t('cloud.cookieLoginPlaceholder')"
              :aria-label="t('cloud.cookieLoginHint')"
              :class="modalInputClass"
              class="h-24 resize-none font-mono break-all"
              spellcheck="false"
            ></textarea>
          </div>

          <!-- 账密 / 短信表单 -->
          <form
            v-else-if="selectedProvider.loginKind === CloudLoginKind.HttpPassword || selectedProvider.loginKind === CloudLoginKind.SmsPassword"
            class="flex flex-col gap-3"
            @submit.prevent="submitLogin"
          >
            <template v-for="f in selectedProvider.loginFields" :key="f.key">
              <div class="flex flex-col gap-1.5">
                <label :class="modalLabelClass" :for="`cloud-login-${f.key}`">{{ f.label }}</label>
                <input
                  :id="`cloud-login-${f.key}`"
                  v-model="loginValues[f.key]"
                  :type="f.obscure ? 'password' : f.isPhone ? 'tel' : 'text'"
                  :inputmode="f.isSmsCode ? 'numeric' : undefined"
                  :placeholder="f.label"
                  :aria-label="f.label"
                  :class="modalInputClass"
                  autocomplete="off"
                >
                <button
                  v-if="f.isSmsCode"
                  type="button"
                  :class="selectChipClass(false)"
                  class="mt-1 shrink-0 self-start disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="smsCooldown > 0"
                  @click="sendSms"
                >
                  {{ smsCooldown > 0 ? t('cloud.smsResendIn', { s: smsCooldown }) : t('cloud.sendSms') }}
                </button>
              </div>
            </template>
          </form>

          <!-- 扫码登录 -->
          <div v-else-if="selectedProvider.loginKind === CloudLoginKind.QrCode" class="flex flex-col items-center gap-3 py-1">
            <p :class="modalHintClass">{{ t('cloud.qrHint') }}</p>
            <img
              v-if="qrImageUrl"
              :src="qrImageUrl"
              :alt="t('cloud.qrHint')"
              class="h-40 w-40 rounded-xl bg-white p-2"
            >
            <img
              v-else-if="qrDataUrl"
              :src="qrDataUrl"
              :alt="t('cloud.qrHint')"
              class="h-40 w-40 rounded-xl bg-white p-2"
            >
            <p v-if="qrWaiting" :class="modalHintClass">{{ t('cloud.qrWaiting') }}</p>
            <p v-if="qrError" class="text-xs text-red-500 dark:text-red-400">{{ qrError }}</p>
            <button
              v-if="qrError || !qrWaiting"
              type="button"
              :class="selectChipClass(false)"
              class="shrink-0"
              @click="startQrLogin"
            >
              {{ t('cloud.refreshQr') }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-3 px-4 py-3 sm:flex-row-reverse bg-gray-50/50 dark:bg-white/5">
          <button
            v-if="selectedProvider.loginKind !== CloudLoginKind.QrCode"
            type="button"
            :class="modalPrimaryBtnClass"
            :disabled="bindSubmitDisabled"
            @click="bindSubmit"
          >
            {{ t('cloud.submitLogin') }}
          </button>
          <button type="button" :class="modalCancelBtnClass" @click="closeBindDialog">
            {{ t('cloud.cancel') }}
          </button>
        </div>
      </div>
    </DialogSurface>

    <ModernModal
      :visible="unbindConfirmShown"
      :title="t('cloud.unbindConfirmTitle')"
      :content="unbindConfirmText"
      type="danger"
      :confirm-text="t('cloud.unbindAction')"
      @confirm="confirmUnbind"
      @cancel="unbindConfirmShown = false"
    />
  </section>
</template>

<style scoped>
/* 与 SettingsAudioOutput 的歌词同步补偿同款折叠交互样式 */
.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  text-align: left;
  transition: background-color 160ms ease;
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.1);
}

.settings-expand-panel {
  margin-top: 2px;
  padding: 0;
}

.settings-pop-panel-enter-active,
.settings-pop-panel-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-pop-panel-enter-from,
.settings-pop-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

/* 网盘段内容比歌词补偿高（长目录列表），放大上限避免动画期间裁剪 */
.settings-pop-panel-enter-to,
.settings-pop-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 2400px;
}

.settings-dropdown-enter-active,
.settings-dropdown-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  transform-origin: top right;
}

.settings-dropdown-enter-from,
.settings-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}
</style>
