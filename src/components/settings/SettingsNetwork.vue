<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';

import { useNetworkProxy } from '../../composables/useNetworkProxy';
import { useToast } from '../../composables/toast';
import { useI18n } from '../../features/i18n';

const { state, refresh, save, test, restart } = useNetworkProxy();
const { showToast } = useToast();
const { isEnglish } = useI18n();

const text = computed(() => (isEnglish.value ? {
  pageTitle: 'Network',
  pageSubtitle: 'HTTP proxy',
  cardTitle: 'Network proxy',
  cardSubtitle: 'HTTP proxy host and authentication',
  enable: 'Enable network proxy',
  host: 'Host',
  port: 'Port',
  username: 'Username',
  password: 'Password',
  passwordKeep: 'Saved; leave blank to keep',
  passwordEmpty: 'Optional',
  save: 'Save',
  test: 'Test connection',
  testing: 'Testing…',
  saved: 'Proxy settings saved. Restart the app so every request uses it.',
  saveFailed: 'Could not save proxy settings',
  testOk: 'Proxy reachable',
  testFail: 'Proxy unreachable',
  hostRequired: 'Enter a proxy host',
  portInvalid: 'The proxy port must be between 1 and 65535',
  restartHint: 'Proxy changes fully apply only after restarting the app',
  restartNow: 'Restart now',
  loadFailed: 'Could not read proxy settings',
} : {
  pageTitle: '网络',
  pageSubtitle: 'HTTP 代理',
  cardTitle: '网络代理',
  cardSubtitle: 'HTTP 代理主机与认证',
  enable: '启用网络代理',
  host: '主机',
  port: '端口',
  username: '账号',
  password: '密码',
  passwordKeep: '已保存，留空则不修改',
  passwordEmpty: '可留空',
  save: '保存',
  test: '测试连接',
  testing: '测试中…',
  saved: '代理设置已保存；重启应用后全部请求才会生效',
  saveFailed: '保存代理设置失败',
  testOk: '代理可用',
  testFail: '代理不可用',
  hostRequired: '请填写代理主机',
  portInvalid: '代理端口需在 1-65535 之间',
  restartHint: '代理改动需重启应用才会对全部请求生效',
  restartNow: '立即重启',
  loadFailed: '读取代理设置失败',
}));

// 端口单独用字符串承接输入，避免清空输入框时把 '' 写进 number 字段。
const portInput = ref('');
const passwordInput = ref('');
const saving = ref(false);
const testing = ref(false);
const testResult = ref<{
  success: boolean;
  status: number | null;
  elapsedMs: number;
  error: string | null;
} | null>(null);

const inputClass =
  'h-9 w-full min-w-0 rounded-lg border border-gray-200/60 bg-white/50 px-3 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[#EC4141]/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700/60 dark:bg-black/25 dark:text-gray-200 dark:placeholder:text-gray-500';

const passwordPlaceholder = computed(() => (
  state.passwordSet ? text.value.passwordKeep : text.value.passwordEmpty
));

const testResultText = computed(() => {
  const result = testResult.value;
  if (!result) return '';
  const labels = text.value;
  if (result.success) {
    const status = result.status === null ? '' : ` (HTTP ${result.status})`;
    return `${labels.testOk}${status} · ${result.elapsedMs}ms`;
  }
  return result.error ? `${labels.testFail}: ${result.error}` : labels.testFail;
});

const applyPortInput = () => {
  state.port = Number.parseInt(portInput.value, 10) || 0;
};

// 后端回传的错误本身就是完整一句话；让它单独成节点，英文才能被 english.ts 的整句映射命中。
const errorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || fallback;
};
const validate = () => {
  if (!state.host.trim()) {
    showToast(text.value.hostRequired, 'error');
    return false;
  }
  const port = Number.parseInt(portInput.value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showToast(text.value.portInvalid, 'error');
    return false;
  }
  return true;
};

const handleSave = async () => {
  applyPortInput();
  if (!validate()) return;
  saving.value = true;
  try {
    await save(passwordInput.value);
    passwordInput.value = '';
    showToast(text.value.saved, 'success');
  } catch (error) {
    showToast(errorMessage(error, text.value.saveFailed), 'error');
  } finally {
    saving.value = false;
  }
};

const handleTest = async () => {
  applyPortInput();
  if (!validate()) return;
  testing.value = true;
  testResult.value = null;
  try {
    const result = await test(passwordInput.value);
    testResult.value = {
      success: result.success,
      status: result.status,
      elapsedMs: result.elapsed_ms,
      error: result.error,
    };
  } catch (error) {
    showToast(errorMessage(error, text.value.testFail), 'error');
  } finally {
    testing.value = false;
  }
};

const handleRestart = () => {
  // 进程随即重启，这个 promise 多半不会落到 resolve，忽略即可。
  void restart().catch(() => undefined);
};

onMounted(async () => {
  try {
    await refresh();
  } catch (error) {
    showToast(errorMessage(error, text.value.loadFailed), 'error');
  }
  portInput.value = state.port > 0 ? String(state.port) : '';
});
</script>

<template>
  <div class="w-full space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section
      class="rounded-2xl border border-gray-200/50 bg-white/30 p-5 dark:border-gray-800/50 dark:bg-black/20"
    >
      <div class="flex items-center gap-4">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EC4141]/10 text-[#EC4141]"
        >
          <RefreshCw :size="22" />
        </span>
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {{ text.pageTitle }}
          </h2>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {{ text.pageSubtitle }}
          </p>
        </div>
      </div>
    </section>

    <section
      class="overflow-hidden rounded-2xl border border-gray-200/50 bg-white/30 dark:border-gray-800/50 dark:bg-black/20"
    >
      <div class="border-b border-gray-200/50 px-5 py-4 dark:border-gray-800/50">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {{ text.cardTitle }}
        </h3>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {{ text.cardSubtitle }}
        </p>
      </div>

      <div class="flex items-center justify-between gap-5 px-5 py-4">
        <span class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ text.enable }}</span>
        <button
          type="button"
          class="glass-switch"
          :class="{ 'is-checked': state.enabled }"
          @click="state.enabled = !state.enabled"
        ></button>
      </div>

      <div
        class="grid grid-cols-1 border-t border-gray-200/50 sm:grid-cols-2 dark:border-gray-800/50"
      >
        <label
          class="flex items-center gap-3 border-b border-gray-200/50 px-5 py-4 sm:border-r dark:border-gray-800/50"
        >
          <span class="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-400">{{ text.host }}</span>
          <input v-model.trim="state.host" :disabled="!state.enabled" placeholder="127.0.0.1" :class="inputClass" />
        </label>
        <label
          class="flex items-center gap-3 border-b border-gray-200/50 px-5 py-4 dark:border-gray-800/50"
        >
          <span class="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-400">{{ text.port }}</span>
          <input
            v-model="portInput"
            type="number"
            inputmode="numeric"
            placeholder="7890"
            :disabled="!state.enabled"
            :class="inputClass"
          />
        </label>
        <label class="flex items-center gap-3 px-5 py-4 sm:border-r">
          <span class="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-400">{{ text.username }}</span>
          <input v-model.trim="state.username" :disabled="!state.enabled" :class="inputClass" />
        </label>
        <label class="flex items-center gap-3 px-5 py-4">
          <span class="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-400">{{ text.password }}</span>
          <input
            v-model="passwordInput"
            type="password"
            autocomplete="off"
            :placeholder="passwordPlaceholder"
            :disabled="!state.enabled"
            :class="inputClass"
          />
        </label>
      </div>

      <div
        class="flex flex-wrap items-center gap-3 border-t border-gray-200/50 px-5 py-4 dark:border-gray-800/50"
      >
        <button
          type="button"
          class="rounded-lg bg-[#EC4141] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="saving"
          @click="handleSave"
        >
          {{ text.save }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-gray-300/60 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700/60 dark:text-gray-200 dark:hover:bg-white/10"
          :disabled="testing || !state.enabled"
          @click="handleTest"
        >
          {{ testing ? text.testing : text.test }}
        </button>
        <span
          v-if="testResultText"
          class="text-xs"
          :class="testResult?.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#EC4141]'"
        >
          {{ testResultText }}
        </span>
      </div>

      <div
        class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/50 bg-gray-50/40 px-5 py-3 dark:border-gray-800/50 dark:bg-white/5"
      >
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ text.restartHint }}</span>
        <button
          type="button"
          class="rounded-lg border border-gray-300/60 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white/60 dark:border-gray-700/60 dark:text-gray-200 dark:hover:bg-white/10"
          @click="handleRestart"
        >
          {{ text.restartNow }}
        </button>
      </div>
    </section>
  </div>
</template>
