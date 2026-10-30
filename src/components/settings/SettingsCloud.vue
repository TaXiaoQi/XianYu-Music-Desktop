<script setup lang="ts">
/**
 * 网盘设置页：绑定管理 / 网盘浏览 / 分享链接导入 三个子视图。
 * 引擎在 services/cloud（与移动端/手表端同构）；本页只做交互编排与展示。
 * WebView 范式的盘在桌面端走内嵌 WebView 登录窗（阿里/迅雷 token 型注入
 * pollScript 轮询、夸克/UC cookie 型原生 Cookie 轮询，命中自动完成绑定），
 * 凭据粘贴框保留兜底；微云捕获规则不可靠仍引导去手机端绑定；139 桌面端
 * 走自绘短信/服务密码表单（Cookie 粘贴兜底）；百度走内嵌 OAuth 授权窗
 * （回调 code 自动回传）。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import DialogSurface from '../common/modal/DialogSurface.vue';

const ModernModal = defineAsyncComponent(() => import('../common/ModernModal.vue'));

import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriInvoke } from '../../services/tauri/invoke';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { cloudProviders, cloudProviderById } from '../../services/cloud/cloudRegistry';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import {
  CloudAccount,
  CloudCaptureResult,
  CloudFile,
  CloudLoginField,
  CloudLoginKind,
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

/** 绑定弹窗主按钮可用性：按登录范式/当前表单通道取对应 busy/填写状态。
 *  QrCode 盘（百度）双通道：任一通道忙碌即禁用。 */
const bindSubmitDisabled = computed(() => {
  const p = selectedProvider.value;
  if (!p) return true;
  switch (p.loginKind) {
    case CloudLoginKind.WebviewToken:
      return tokenLoginBusy.value || tokenInput.value.trim() === '';
    case CloudLoginKind.WebviewCookie:
      return cookieLoginBusy.value || cookieInput.value.trim() === '';
    case CloudLoginKind.QrCode:
      // 底部「登录」只提交 Cookie 粘贴轨；授权窗由顶部主按钮自管 busy
      return cookieLoginBusy.value || cookieInput.value.trim() === '';
    default:
      return bindFormMode.value === 'cookie'
        ? cookieLoginBusy.value || cookieInput.value.trim() === ''
        : loginBusy.value;
  }
});

/** 绑定弹窗主按钮动作：按登录范式分发（QrCode 盘底部「登录」固定走
 *  Cookie 粘贴轨；授权窗由弹窗顶部主按钮直开）。 */
function bindSubmit() {
  const p = selectedProvider.value;
  if (!p) return;
  if (p.loginKind === CloudLoginKind.WebviewToken) void submitTokenLogin();
  else if (p.loginKind === CloudLoginKind.WebviewCookie) void submitCookieLogin();
  else if (p.loginKind === CloudLoginKind.QrCode) void submitCookieLogin();
  else if (bindFormMode.value === 'cookie') void submitCookieLogin();
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
// 弹窗说明文案（139 等主动短信登录盘由 provider 下发 hint，天翼用默认）。
const smsPromptHint = ref('');
let smsResendTimer: ReturnType<typeof setInterval> | null = null;
let smsTimer: ReturnType<typeof setInterval> | null = null;

const closeSmsPrompt = () => {
  smsPromptFor.value = '';
  smsPromptCode.value = '';
  smsPromptHint.value = '';
  if (smsResendTimer) {
    clearInterval(smsResendTimer);
    smsResendTimer = null;
  }
  smsResendCooldown.value = 0;
  smsResendBusy.value = false;
};

const selectedProvider = computed<CloudProvider | null>(() => cloudProviderById(selectedProviderId.value));

// 双通道盘（smsPassword/httpPassword 表单 + webviewCookie Cookie 粘贴兜底，
// 如 139）：绑定弹窗内互相切换；单通道盘按 loginKind 直接渲染。
const bindFormMode = ref<'fields' | 'cookie'>('fields');
// optional 字段展开态（多通道二选一，如 139 服务密码；折叠时不参与必填）。
const loginExpanded = ref<Record<string, boolean>>({});
const supportsBothBindModes = (p: CloudProvider): boolean => p.loginFields.length > 0 && p.captureRule != null;
const fieldCollapsed = (f: CloudLoginField): boolean =>
  !!f.optional && !!f.switchLabel && !loginExpanded.value[f.key];
const collapseField = (f: CloudLoginField) => {
  loginValues.value[f.key] = '';
  loginExpanded.value[f.key] = false;
};

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
      smsPromptHint.value = e.hint ?? '';
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
  loginExpanded.value = {};
  bindFormMode.value = 'fields';
  bindDialogLeaving.value = false;
};

// 绑定弹窗（DialogSurface）：关闭走 200ms 退场动画，与 ModernModal 一致
const bindDialogLeaving = ref(false);
let bindDialogSettleTimer: ReturnType<typeof setTimeout> | null = null;

const closeBindDialog = () => {
  if (bindDialogLeaving.value) return;
  bindDialogLeaving.value = true;
  closeOauthCodeListener();
  closeWebviewLoginListener();
  // 登录窗还开着（等待捕获中）就一并关掉（窗口不存在时 no-op）
  if (webviewLoginBusy.value) {
    webviewLoginBusy.value = false;
    void tauriInvoke('close_webview_login_window').catch(() => {});
  }
  if (bindDialogSettleTimer) clearTimeout(bindDialogSettleTimer);
  bindDialogSettleTimer = setTimeout(() => {
    selectedProviderId.value = '';
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

// ── OAuth 授权登录（QrCode 范式盘当前唯一登录通道，如百度） ──────
// 点主按钮直接打开内嵌授权窗（rust open_oauth_login_window）：独立
// WebView 加载 provider.oauthAuthorizeUrl，授权完成 302 到注册回调
// （github.io，页面不可达）时 rust 侧 on_navigation 在加载前拦截抽 code
// emit 回来，自动完成绑定并关窗——用户全程看不到 404，零复制粘贴。

const oauthBusy = ref(false);

const OAUTH_CODE_EVENT = 'oauth-login-code';
let oauthCodeUnlisten: UnlistenFn | null = null;

const closeOauthCodeListener = () => {
  if (oauthCodeUnlisten) {
    oauthCodeUnlisten();
    oauthCodeUnlisten = null;
  }
};

const openAuthorizePage = async () => {
  const provider = selectedProvider.value;
  if (!provider?.oauthAuthorizeUrl || oauthBusy.value) return;
  // 先注册监听再开窗，避免 code 早于监听就绪的竞态
  closeOauthCodeListener();
  oauthBusy.value = true;
  try {
    oauthCodeUnlisten = await listen<string>(OAUTH_CODE_EVENT, (e) => {
      closeOauthCodeListener();
      oauthBusy.value = false;
      const code = (e.payload ?? '').trim();
      if (code === '') return;
      // rust 侧不在导航回调栈里关窗（防主线程卡死），由这里收尾
      void tauriInvoke('close_oauth_login_window').catch(() => {});
      tokenInput.value = code;
      void submitTokenLogin();
    });
    await tauriInvoke('open_oauth_login_window', {
      url: provider.oauthAuthorizeUrl,
      event: OAUTH_CODE_EVENT,
    });
  } catch (e) {
    closeOauthCodeListener();
    showToast(errorMessage(e), 'error');
  } finally {
    oauthBusy.value = false;
  }
};

// ── WebView 窗口登录（webviewToken/webviewCookie 范式盘的桌面直连通道）──
// rust open_webview_login_window：独立 WebView 打开 provider.webviewLoginUrl。
// token 型盘注入 pollScript 轮询登录凭据；cookie 型盘后台轮询原生 Cookie
// 等齐登录态锚（httpOnly 也能拿到，夸克/UC 命中后驱动落地页补签发
// __puus）。命中即 emit {providerId, kind, value}——校验 providerId 后走
// completeLogin 完成绑定并关窗，粘贴框保留兜底。微云规则不可靠（无
// pollScript/cookie 域）不展示该通道。

const WEBVIEW_LOGIN_EVENT = 'webview-login-capture';
const webviewLoginBusy = ref(false);
let webviewLoginUnlisten: UnlistenFn | null = null;

/** 是否具备窗口登录通道：有登录 URL 且规则可判定完成（token 型有
 * pollScript / cookie 型有轮询域+登录态锚）。 */
const supportsWebviewLogin = (p: CloudProvider): boolean => {
  const rule = p.captureRule;
  if (p.webviewLoginUrl === '' || !rule) return false;
  if (rule.pollScript != null && rule.pollScript !== '') return true;
  return rule.cookieDomains.length > 0 && rule.requiredCookies.length > 0;
};

const closeWebviewLoginListener = () => {
  if (webviewLoginUnlisten) {
    webviewLoginUnlisten();
    webviewLoginUnlisten = null;
  }
};

/** 打开内嵌 WebView 登录窗。capture 为 CloudCaptureRule 的 JSON 投影。 */
const openWebviewLoginWindow = async () => {
  const provider = selectedProvider.value;
  if (!provider || webviewLoginBusy.value || !supportsWebviewLogin(provider)) return;
  const rule = provider.captureRule!;
  // 先注册监听再开窗，避免凭据早于监听就绪的竞态
  closeWebviewLoginListener();
  webviewLoginBusy.value = true;
  try {
    webviewLoginUnlisten = await listen<{ providerId: string; kind: 'token' | 'cookies'; value: string }>(
      WEBVIEW_LOGIN_EVENT,
      (e) => {
        const payload = e.payload;
        if (!payload || payload.providerId !== selectedProviderId.value) return;
        closeWebviewLoginListener();
        webviewLoginBusy.value = false;
        // rust 侧不在导航/轮询栈里关窗，由这里收尾
        void tauriInvoke('close_webview_login_window').catch(() => {});
        void (async () => {
          try {
            const target = selectedProvider.value;
            if (!target) return;
            const captured =
              payload.kind === 'token'
                ? new CloudCaptureResult({ token: payload.value })
                : new CloudCaptureResult({ cookies: JSON.parse(payload.value) as Record<string, string> });
            const account = await target.completeLogin(captured);
            await CloudCredentialsStore.instance.saveAccount(account);
            showToast(t('cloud.bindSuccess'), 'success');
            tokenInput.value = '';
            cookieInput.value = '';
            selectedProviderId.value = '';
            await refreshAccounts();
          } catch (err) {
            showToast(errorMessage(err), 'error');
          }
        })();
      },
    );
    await tauriInvoke('open_webview_login_window', {
      providerId: provider.id,
      url: provider.webviewLoginUrl,
      event: WEBVIEW_LOGIN_EVENT,
      // null 归一：rust 侧字段是 String/Vec 非 Option，null 会拒收
      // （token 型盘的 postLoginUrl/requiredCookies 等默认 null/缺省）。
      captureJson: JSON.stringify({
        pollScript: rule.pollScript ?? '',
        pollIntervalMs: rule.pollIntervalMs ?? 500,
        cookieDomains: rule.cookieDomains ?? [],
        requiredCookies: rule.requiredCookies ?? [],
        finalCookies: rule.finalCookies ?? [],
        postLoginUrl: rule.postLoginUrl ?? '',
        scrollToRight: rule.scrollToRight === true,
        forceScrollable: rule.forceScrollable === true,
        windowWidth: rule.windowWidth ?? 0,
        windowHeight: rule.windowHeight ?? 0,
      }),
    });
  } catch (e) {
    closeWebviewLoginListener();
    showToast(errorMessage(e), 'error');
  } finally {
    webviewLoginBusy.value = false;
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
  closeOauthCodeListener();
  closeWebviewLoginListener();
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
          <p :class="modalHintClass">{{ smsPromptHint !== '' ? smsPromptHint : t('cloud.smsPromptBody', { u: smsPromptFor }) }}</p>
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

          <!-- webviewToken 范式：窗口登录直连（阿里/迅雷），粘贴兜底 -->
          <div
            v-if="selectedProvider.loginKind === CloudLoginKind.WebviewToken"
            class="flex flex-col gap-2"
          >
            <button
              v-if="supportsWebviewLogin(selectedProvider)"
              type="button"
              :class="modalPrimaryBtnClass"
              :disabled="webviewLoginBusy"
              @click="openWebviewLoginWindow"
            >
              {{ webviewLoginBusy ? t('cloud.webviewLoginWaiting') : t('cloud.webviewLoginButton') }}
            </button>
            <p
              v-if="supportsWebviewLogin(selectedProvider)"
              :class="modalHintClass"
              class="text-center"
            >
              {{ t('cloud.webviewLoginDivider') }}
            </p>
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

          <!-- webviewCookie 范式：窗口登录直连（夸克/UC），粘贴兜底 -->
          <div
            v-else-if="selectedProvider.loginKind === CloudLoginKind.WebviewCookie"
            class="flex flex-col gap-2"
          >
            <button
              v-if="supportsWebviewLogin(selectedProvider)"
              type="button"
              :class="modalPrimaryBtnClass"
              :disabled="webviewLoginBusy"
              @click="openWebviewLoginWindow"
            >
              {{ webviewLoginBusy ? t('cloud.webviewLoginWaiting') : t('cloud.webviewLoginButton') }}
            </button>
            <p
              v-if="supportsWebviewLogin(selectedProvider)"
              :class="modalHintClass"
              class="text-center"
            >
              {{ t('cloud.webviewLoginDivider') }}
            </p>
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
            <!-- 双通道切换（表单 + Cookie 粘贴兜底，如 139） -->
            <div
              v-if="supportsBothBindModes(selectedProvider)"
              class="flex gap-2"
            >
              <button
                type="button"
                :class="selectChipClass(bindFormMode === 'fields')"
                @click="bindFormMode = 'fields'"
              >
                {{ t('cloud.accountLogin') }}
              </button>
              <button
                type="button"
                :class="selectChipClass(bindFormMode === 'cookie')"
                @click="bindFormMode = 'cookie'"
              >
                {{ t('cloud.cookieLogin') }}
              </button>
            </div>

            <!-- 表单通道：按 loginFields 动态渲染；optional 字段默认折叠 -->
            <template v-if="bindFormMode === 'fields'">
              <template v-for="f in selectedProvider.loginFields" :key="f.key">
                <button
                  v-if="fieldCollapsed(f)"
                  type="button"
                  :class="selectChipClass(false)"
                  class="self-start"
                  @click="loginExpanded[f.key] = true"
                >
                  {{ f.switchLabel }}
                </button>
                <div v-else class="flex flex-col gap-1.5">
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
                  <button
                    v-if="f.collapseLabel"
                    type="button"
                    class="self-start text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    @click="collapseField(f)"
                  >
                    {{ f.collapseLabel }}
                  </button>
                </div>
              </template>
            </template>

            <!-- Cookie 粘贴通道（兜底） -->
            <template v-else>
              <p :class="modalHintClass">{{ t('cloud.cookieLoginHint') }}</p>
              <textarea
                v-model="cookieInput"
                :placeholder="t('cloud.cookieLoginPlaceholder')"
                :aria-label="t('cloud.cookieLoginHint')"
                :class="modalInputClass"
                class="h-24 resize-none font-mono break-all"
                spellcheck="false"
              ></textarea>
            </template>
          </form>

          <!-- OAuth 授权登录（如百度）：与其他盘统一双通道结构——
               顶部主按钮开内嵌授权窗（回调 code 自动回传），Cookie
               粘贴为兜底通道（底部「登录」提交） -->
          <div v-else-if="selectedProvider.loginKind === CloudLoginKind.QrCode" class="flex flex-col gap-2">
            <button
              type="button"
              :class="modalPrimaryBtnClass"
              :disabled="oauthBusy"
              @click="openAuthorizePage"
            >
              {{ oauthBusy ? t('cloud.webviewLoginWaiting') : t('cloud.webviewLoginButton') }}
            </button>
            <p :class="modalHintClass" class="text-center">{{ t('cloud.webviewLoginDivider') }}</p>
            <p :class="modalHintClass">{{ t('cloud.baiduCookieHint') }}</p>
            <textarea
              v-model="cookieInput"
              :placeholder="t('cloud.baiduCookiePlaceholder')"
              :aria-label="t('cloud.baiduCookieHint')"
              :class="modalInputClass"
              class="h-20 resize-none font-mono break-all"
              spellcheck="false"
            ></textarea>
          </div>
        </div>

        <div class="flex flex-col gap-3 px-4 py-3 sm:flex-row-reverse bg-gray-50/50 dark:bg-white/5">
          <button
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
