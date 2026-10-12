<script setup lang="ts">
/**
 * 网盘设置页：绑定管理 / 网盘浏览 / 分享链接导入 三个子视图。
 * 引擎在 services/cloud（与移动端/手表端同构）；本页只做交互编排与展示。
 * WebView 范式的盘（139/微云/阿里）在桌面端不做网页登录，
 * 提示去手机端绑定，凭据经账号同步自动下发；百度/夸克/UC 走原生扫码。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import QRCode from 'qrcode';

import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { cloudProviders, cloudProviderById } from '../../services/cloud/cloudRegistry';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import {
  CloudAccount,
  CloudException,
  CloudFile,
  CloudLoginKind,
  CloudQrLoginSession,
  CloudShareParse,
} from '../../services/cloud/cloudTypes';
import type { CloudProvider } from '../../services/cloud/cloudProvider';
import { parseUrlToProvider } from '../../services/cloud/shareLinkParser';
import { CloudPlayContext, cloudSongFromContext } from '../../features/playback/cloudPlaybackResolver';

const { t } = useI18n();
const { showToast } = useToast();
const { playSong, addSongsToQueue } = usePlaybackController();

const rowClass = 'flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';
const chipClass = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all';
const chipActiveClass = 'border-[#EC4141] bg-[#EC4141]/8 text-[#EC4141]';
const chipIdleClass = 'border-gray-200/40 bg-white/20 text-gray-700 hover:border-[#EC4141]/40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200';
const inputClass = 'rounded-lg border border-gray-200/40 bg-white/30 px-2.5 py-1.5 text-xs text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200 dark:placeholder:text-white/30';
const primaryBtnClass = 'rounded-lg bg-[#EC4141] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

function selectChipClass(active: boolean) {
  return `${chipClass} ${active ? chipActiveClass : chipIdleClass}`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 目录/音频/其他 三档排序（与移动端浏览页一致）。 */
function sortedFiles(files: CloudFile[]): CloudFile[] {
  const rank = (f: CloudFile) => (f.isDir ? 0 : f.isAudio ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'));
}

type CloudView = 'main' | 'bind' | 'browse' | 'import';
const view = ref<CloudView>('main');

// ── 绑定管理 ──────────────────────────────────────────────

const accountsMap = ref<Record<string, CloudAccount[]>>({});
const selectedProviderId = ref('');
const loginValues = ref<Record<string, string>>({});
const loginBusy = ref(false);
const smsCooldown = ref(0);
const qrDataUrl = ref('');
const qrImageUrl = ref('');
const qrWaiting = ref(false);
const qrError = ref('');
const pendingRemoveKey = ref('');

let smsTimer: ReturnType<typeof setInterval> | null = null;
let qrPollTimer: ReturnType<typeof setInterval> | null = null;
let unbindResetTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (p.loginKind === CloudLoginKind.QrCode) {
    void startQrLogin();
  }
};

/** 两步解绑确认：首次点击进入待确认态（3s 自动复位），再次点击执行。 */
const requestUnbind = (p: CloudProvider, a: CloudAccount) => {
  const key = `${p.id}:${a.accountId}`;
  if (pendingRemoveKey.value !== key) {
    pendingRemoveKey.value = key;
    if (unbindResetTimer) clearTimeout(unbindResetTimer);
    unbindResetTimer = setTimeout(() => {
      pendingRemoveKey.value = '';
    }, 3000);
    return;
  }
  pendingRemoveKey.value = '';
  void (async () => {
    await CloudCredentialsStore.instance.removeAccount(p.id, a.accountId);
    showToast(t('cloud.unbindSuccess'), 'success');
    if (selectedProviderId.value === p.id) selectedProviderId.value = '';
    await refreshAccounts();
  })();
};

// ── 网盘浏览 ──────────────────────────────────────────────

const browseIndex = ref(-1);
const browseCrumbs = ref<Array<{ name: string; path: string }>>([]);
const browseFiles = ref<CloudFile[]>([]);
const browseCursor = ref<string | null>(null);
const browseLoading = ref(false);
const browseError = ref('');

const browseSel = computed(() => boundAccountsFlat.value[browseIndex.value] ?? null);

const openBrowse = () => {
  if (boundAccountsFlat.value.length === 0) return;
  if (browseIndex.value < 0 || browseIndex.value >= boundAccountsFlat.value.length) {
    browseIndex.value = 0;
  }
  const sel = boundAccountsFlat.value[browseIndex.value];
  if (!sel) return;
  browseCrumbs.value = [{ name: t('cloud.root'), path: sel.provider.rootPath }];
  browseFiles.value = [];
  browseCursor.value = null;
  browseError.value = '';
  void loadDir(true);
};

const loadDir = async (reset: boolean) => {
  const sel = browseSel.value;
  if (!sel || browseLoading.value) return;
  browseLoading.value = true;
  browseError.value = '';
  try {
    const path = browseCrumbs.value[browseCrumbs.value.length - 1]?.path ?? sel.provider.rootPath;
    const res = await sel.provider.listDir(sel.account.cred, path, reset ? null : browseCursor.value);
    browseFiles.value = reset ? sortedFiles(res.files) : sortedFiles([...browseFiles.value, ...res.files]);
    browseCursor.value = res.nextCursor;
  } catch (e) {
    browseError.value = errorMessage(e);
  } finally {
    browseLoading.value = false;
  }
};

/** 进入子目录：path 型盘条目携带绝对路径，id 型盘回退用 id（与移动端一致）。 */
const enterDir = (dir: CloudFile) => {
  const sel = browseSel.value;
  if (!sel) return;
  const cur = browseCrumbs.value[browseCrumbs.value.length - 1]?.path ?? sel.provider.rootPath;
  const next = dir.path != null && dir.path !== '' && dir.path !== cur ? dir.path : dir.id;
  browseCrumbs.value = [...browseCrumbs.value, { name: dir.name, path: next }];
  browseFiles.value = [];
  browseCursor.value = null;
  void loadDir(true);
};

const jumpToCrumb = (index: number) => {
  if (index === browseCrumbs.value.length - 1) return;
  browseCrumbs.value = browseCrumbs.value.slice(0, index + 1);
  browseFiles.value = [];
  browseCursor.value = null;
  void loadDir(true);
};

const playBrowseFile = (file: CloudFile) => {
  const sel = browseSel.value;
  if (!sel) return;
  const ctx = new CloudPlayContext({ provider: sel.provider.id, accountId: sel.account.accountId, file });
  void playSong(cloudSongFromContext(ctx, sel.provider.displayName));
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

onMounted(() => {
  void refreshAccounts();
});

onBeforeUnmount(() => {
  if (smsTimer) clearInterval(smsTimer);
  stopQrPoll();
  if (unbindResetTimer) clearTimeout(unbindResetTimer);
});
</script>

<template>
  <section class="space-y-3">
    <div class="px-1">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('cloud.title') }}</h2>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.description') }}</p>
    </div>

    <!-- 主视图：三个入口 -->
    <template v-if="view === 'main'">
      <div :class="rowClass">
        <span class="min-w-[12rem] flex-1">
          <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('cloud.bindManage') }}</span>
          <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.bindManageHint') }}</span>
        </span>
        <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="view = 'bind'">
          {{ t('cloud.open') }}
        </button>
      </div>
      <div :class="rowClass">
        <span class="min-w-[12rem] flex-1">
          <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('cloud.browse') }}</span>
          <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.browseHint') }}</span>
        </span>
        <button
          type="button"
          :class="selectChipClass(false)"
          class="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="boundAccountsFlat.length === 0"
          @click="openBrowse(); view = 'browse'"
        >
          {{ t('cloud.open') }}
        </button>
      </div>
      <div :class="rowClass">
        <span class="min-w-[12rem] flex-1">
          <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('cloud.importLink') }}</span>
          <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.importLinkHint') }}</span>
        </span>
        <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="resetImport(); view = 'import'">
          {{ t('cloud.open') }}
        </button>
      </div>
    </template>

    <!-- 绑定管理 -->
    <template v-else-if="view === 'bind'">
      <div :class="rowClass">
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('cloud.bindManage') }}</span>
        <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="selectedProviderId = ''; view = 'main'">
          {{ t('cloud.back') }}
        </button>
      </div>

      <div
        v-for="p in cloudProviders"
        :key="p.id"
        :class="rowClass"
      >
        <span class="min-w-0 flex-1">
          <span class="block whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{{ p.displayName }}</span>
          <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            {{ boundCountOf(p.id) > 0 ? t('cloud.boundCount', { count: boundCountOf(p.id) }) : t('cloud.notBound') }}
          </span>
          <span v-if="boundCountOf(p.id) > 0" class="mt-1 block space-y-1">
            <span
              v-for="a in accountsMap[p.id] ?? []"
              :key="a.accountId"
              class="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300"
            >
              <span class="truncate">{{ a.nickname || a.accountId }}</span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-gray-200/60 px-2 py-0.5 text-[11px] transition hover:border-red-400/60 hover:text-red-500 dark:border-white/10"
                @click="requestUnbind(p, a)"
              >
                {{ pendingRemoveKey === `${p.id}:${a.accountId}` ? t('cloud.confirmUnbind') : t('cloud.unbindAction') }}
              </button>
            </span>
          </span>
        </span>
        <button
          v-if="selectedProviderId !== p.id"
          type="button"
          :class="selectChipClass(false)"
          class="shrink-0"
          @click="openBind(p)"
        >
          {{ t('cloud.bindAction') }}
        </button>
      </div>

      <!-- 登录面板 -->
      <div v-if="selectedProvider" :class="rowClass" class="flex-col items-stretch">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {{ t('cloud.bindAction') }} · {{ selectedProvider.displayName }}
          </span>
          <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="selectedProviderId = ''">
            {{ t('cloud.back') }}
          </button>
        </div>

        <!-- WebView 范式：桌面端不做网页登录，引导去手机端 -->
        <p
          v-if="selectedProvider.loginKind === CloudLoginKind.WebviewCookie || selectedProvider.loginKind === CloudLoginKind.WebviewToken"
          class="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400"
        >
          {{ t('cloud.webviewHint') }}
        </p>

        <!-- 账密 / 短信表单 -->
        <form
          v-else-if="selectedProvider.loginKind === CloudLoginKind.HttpPassword || selectedProvider.loginKind === CloudLoginKind.SmsPassword"
          class="mt-3 flex flex-wrap items-center gap-2"
          @submit.prevent="submitLogin"
        >
          <template v-for="f in selectedProvider.loginFields" :key="f.key">
            <input
              v-model="loginValues[f.key]"
              :type="f.obscure ? 'password' : f.isPhone ? 'tel' : 'text'"
              :inputmode="f.isSmsCode ? 'numeric' : undefined"
              :placeholder="f.label"
              :aria-label="f.label"
              :class="inputClass"
              class="w-44"
              autocomplete="off"
            >
            <button
              v-if="f.isSmsCode"
              type="button"
              :class="selectChipClass(false)"
              class="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="smsCooldown > 0"
              @click="sendSms"
            >
              {{ smsCooldown > 0 ? t('cloud.smsResendIn', { s: smsCooldown }) : t('cloud.sendSms') }}
            </button>
          </template>
          <button type="submit" :class="primaryBtnClass" class="shrink-0" :disabled="loginBusy">
            {{ t('cloud.submitLogin') }}
          </button>
        </form>

        <!-- 扫码登录 -->
        <div v-else-if="selectedProvider.loginKind === CloudLoginKind.QrCode" class="mt-3 flex flex-col items-center gap-3">
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.qrHint') }}</p>
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
          <p v-if="qrWaiting" class="text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.qrWaiting') }}</p>
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
    </template>

    <!-- 网盘浏览 -->
    <template v-else-if="view === 'browse'">
      <div :class="rowClass">
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('cloud.browse') }}</span>
        <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="view = 'main'">
          {{ t('cloud.back') }}
        </button>
      </div>

      <div v-if="boundAccountsFlat.length === 0" :class="rowClass">
        <span class="flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.needBindFirst') }}</span>
        <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="view = 'bind'">
          {{ t('cloud.bindAction') }}
        </button>
      </div>

      <template v-else>
        <div :class="rowClass">
          <span class="min-w-[8rem] flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.chooseAccount') }}</span>
          <select v-model.number="browseIndex" :class="inputClass" class="shrink-0" @change="openBrowse">
            <option v-for="(item, i) in boundAccountsFlat" :key="`${item.provider.id}:${item.account.accountId}`" :value="i">
              {{ item.provider.displayName }} · {{ item.account.nickname || item.account.accountId }}
            </option>
          </select>
        </div>

        <!-- 面包屑 -->
        <div v-if="browseSel" :class="rowClass" class="flex-wrap">
          <span class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
            <template v-for="(c, i) in browseCrumbs" :key="`${i}:${c.path}`">
              <span v-if="i > 0" class="text-gray-400 dark:text-white/30">/</span>
              <button
                type="button"
                class="truncate rounded px-1 transition hover:text-[#EC4141]"
                :class="i === browseCrumbs.length - 1 ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-[#EC4141]'"
                @click="jumpToCrumb(i)"
              >
                {{ c.name }}
              </button>
            </template>
          </span>
        </div>

        <div v-if="browseError" :class="rowClass">
          <span class="flex-1 text-xs text-red-500 dark:text-red-400">{{ browseError }}</span>
          <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="loadDir(true)">
            {{ t('cloud.retry') }}
          </button>
        </div>
        <div v-else-if="browseLoading && browseFiles.length === 0" :class="rowClass">
          <span class="flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.loading') }}</span>
        </div>
        <div v-else-if="browseFiles.length === 0" :class="rowClass">
          <span class="flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.emptyDir') }}</span>
        </div>

        <div
          v-for="f in browseFiles"
          :key="f.id"
          :class="rowClass"
          class="cursor-pointer"
          @click="f.isDir ? enterDir(f) : (f.isAudio && playBrowseFile(f))"
        >
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-sm"
              :class="f.isDir || f.isAudio ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-white/30'"
            >
              {{ f.isDir ? '📁' : f.isAudio ? '🎵' : '📄' }} {{ f.name }}
            </span>
          </span>
          <span v-if="!f.isDir && f.size > 0" class="shrink-0 text-xs text-gray-400 dark:text-white/30">
            {{ (f.size / 1024 / 1024).toFixed(1) }} MB
          </span>
        </div>

        <div v-if="browseCursor != null" :class="rowClass">
          <span class="flex-1 text-xs text-gray-500 dark:text-gray-400">
            {{ browseLoading ? t('cloud.loading') : '' }}
          </span>
          <button
            type="button"
            :class="selectChipClass(false)"
            class="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="browseLoading"
            @click="loadDir(false)"
          >
            {{ t('cloud.loadMore') }}
          </button>
        </div>
      </template>
    </template>

    <!-- 分享链接导入 -->
    <template v-else-if="view === 'import'">
      <div :class="rowClass">
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('cloud.importLink') }}</span>
        <button type="button" :class="selectChipClass(false)" class="shrink-0" @click="view = 'main'">
          {{ t('cloud.back') }}
        </button>
      </div>

      <div :class="rowClass" class="flex-col items-stretch">
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
    </template>
  </section>
</template>
