<script setup lang="ts">
/**
 * 网盘文件夹选择器（音乐库设置页，与移动端 CloudFolderPickerPage 同构）。
 * 浏览当前账号网盘目录，勾选一个或多个文件夹（当前目录 + 子目录行），
 * 跨目录累积，保存整体覆盖写入 CloudFolderSelectionStore。
 * 文件行只读展示（移动端同款），点播/下载走内嵌封面探针与搜索链路。
 *
 * 选取模式（pickMode）：歌单「网盘文件夹导入」等场景内嵌本组件只为
 * 挑文件夹——确定后 emit('pick') 返回所选 (key, 可读名) + 账号，
 * 不写播放范围 store（与移动端 ?pick=1 同语义）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';

import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { cloudProviders } from '../../services/cloud/cloudRegistry';
import { CloudCredentialsStore } from '../../services/cloud/cloudCredentialsStore';
import { CloudFolderNameCache, CloudFolderSelectionStore } from '../../services/cloud/cloudFolderSelectionStore';
import { CloudScanCacheStore } from '../../services/cloud/cloudScanCacheStore';
import { CloudAccount, CloudFile } from '../../services/cloud/cloudTypes';
import type { CloudProvider } from '../../services/cloud/cloudProvider';

const props = defineProps<{ pickMode?: boolean }>();

const emit = defineEmits<{
  (
    event: 'pick',
    payload: {
      providerId: string;
      accountId: string;
      providerName: string;
      folders: Array<{ key: string; name: string }>;
    },
  ): void;
}>();

const { t } = useI18n();
const { showToast } = useToast();

// 行间分隔与设置分区行同色；列表末行无线
// 首末行自带圆角：根容器不能加 overflow-hidden，否则账号下拉会被卡片裁掉
const rowClass = 'flex flex-wrap items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-white/40 dark:hover:bg-white/10 first:rounded-t-xl last:rounded-b-xl';
const chipClass = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all';
const chipIdleClass = 'border-gray-200/40 bg-white/20 text-gray-700 hover:border-[#EC4141]/40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200';
const selectChipClass = (active: boolean) => `${chipClass} ${active ? 'border-[#EC4141] bg-[#EC4141]/8 text-[#EC4141]' : chipIdleClass}`;

// 勾选框（移动端 Checkbox 同语义：选中红底白勾）
const boxClass = (checked: boolean) => [
  'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
  checked
    ? 'border-[#EC4141] bg-[#EC4141] text-white'
    : 'border-gray-300/70 bg-white/60 dark:border-white/20 dark:bg-white/10',
];

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 目录/音频/其他 三档排序（与移动端选择器一致）。 */
function sortedFiles(files: CloudFile[]): CloudFile[] {
  const rank = (f: CloudFile) => (f.isDir ? 0 : f.isAudio ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'));
}

// ── 已绑定账号 ────────────────────────────────────────────

const accountsMap = ref<Record<string, CloudAccount[]>>({});

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

let unsubCreds: (() => void) | null = null;

// ── 目录浏览 + 多选 ───────────────────────────────────────

const browseIndex = ref(-1);
const browseCrumbs = ref<Array<{ name: string; path: string }>>([]);
const browseFiles = ref<CloudFile[]>([]);
const browseCursor = ref<string | null>(null);
const browseLoading = ref(false);
const browseError = ref('');

/** 勾选集合：跨目录累积，保存时整体覆盖写入。 */
const selectedPaths = ref<Set<string>>(new Set());
/** 已选目录名称缓存（纯展示）：id 型盘的存储键是 id 串，键不在面包屑/
 * 当前列表时 chip 显示可读名全靠它；勾选与浏览命中时回写落盘。 */
const folderNames = ref<Record<string, string>>({});
const saving = ref(false);

const browseSel = computed(() => boundAccountsFlat.value[browseIndex.value] ?? null);
const currentDirPath = computed(() => browseCrumbs.value[browseCrumbs.value.length - 1]?.path ?? '');
const currentDirSelected = computed(() => selectedPaths.value.has(currentDirPath.value));

/** 列表条目的存储键（path 优先，回退 id），与勾选写入同口径。 */
const entryKey = (dir: CloudFile): string => {
  const cur = currentDirPath.value;
  return dir.path != null && dir.path !== '' && dir.path !== cur ? dir.path : dir.id;
};

/** 名称缓存回写（同步本地 ref 与落盘；纯展示数据不推同步时钟）。 */
const rememberNames = (entries: Record<string, string>) => {
  const sel = browseSel.value;
  if (!sel) return;
  if (Object.keys(entries).length === 0) return;
  folderNames.value = { ...folderNames.value, ...entries };
  void CloudFolderNameCache.instance.remember(sel.provider.id, sel.account.accountId, entries);
};

/** 恢复已保存选择（换账号时跟随）；选取模式不还原播放范围，只取名称缓存。 */
const restoreSelection = async () => {
  const sel = browseSel.value;
  if (!sel) return;
  const names = await CloudFolderNameCache.instance.namesFor(sel.provider.id, sel.account.accountId);
  folderNames.value = { ...names };
  if (props.pickMode) {
    selectedPaths.value = new Set();
    return;
  }
  const saved = await CloudFolderSelectionStore.instance.pathsFor(sel.provider.id, sel.account.accountId);
  selectedPaths.value = new Set(saved);
};

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
  void restoreSelection();
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
    // 名称 heal：当前列表命中的已选键回填缓存——跨设备同步来的选择
    //（本地无名称记录）首次浏览到其父目录即可显示可读名
    const heal: Record<string, string> = {};
    for (const f of browseFiles.value) {
      if (!f.isDir) continue;
      const k = entryKey(f);
      if (selectedPaths.value.has(k)) heal[k] = f.name;
    }
    rememberNames(heal);
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

const dirNameOf = (path: string): string => {
  if (!path) return t('cloud.root'); // 空串 = 根目录（id 型盘）
  for (const c of browseCrumbs.value) {
    if (c.path === path) return c.name;
  }
  for (const f of browseFiles.value) {
    if (f.isDir && entryKey(f) === path) return f.name;
  }
  const cached = folderNames.value[path];
  if (cached) return cached;
  const idx = path.lastIndexOf('/');
  return idx >= 0 && idx < path.length - 1 ? path.slice(idx + 1) : path;
};

const toggleCurrentDir = () => {
  // 空串是合法目录标识：id 型盘（迅雷/PikPak）根目录 id 为空串
  const path = currentDirPath.value;
  const next = new Set(selectedPaths.value);
  if (!next.delete(path)) {
    next.add(path);
    const name = browseCrumbs.value[browseCrumbs.value.length - 1]?.name;
    if (path !== '' && name) rememberNames({ [path]: name });
  }
  selectedPaths.value = next;
};

const toggleEntry = (dir: CloudFile) => {
  const sel = browseSel.value;
  if (!sel) return;
  const key = entryKey(dir);
  const next = new Set(selectedPaths.value);
  if (!next.delete(key)) {
    next.add(key);
    rememberNames({ [key]: dir.name });
  }
  selectedPaths.value = next;
};

const removeSelected = (path: string) => {
  const next = new Set(selectedPaths.value);
  next.delete(path);
  selectedPaths.value = next;
};

const saveSelection = async () => {
  const sel = browseSel.value;
  if (!sel || saving.value) return;
  // 选取模式：不写播放范围 store，直接把选择交回宿主（歌单导入等）
  if (props.pickMode) {
    emit('pick', {
      providerId: sel.provider.id,
      accountId: sel.account.accountId,
      providerName: sel.provider.displayName,
      folders: [...selectedPaths.value].map((key) => ({
        key,
        name: dirNameOf(key),
      })),
    });
    return;
  }
  saving.value = true;
  try {
    await CloudFolderSelectionStore.instance.setPaths(
      sel.provider.id,
      sel.account.accountId,
      [...selectedPaths.value],
    );
    // 扫描范围变了：该账号的网盘页全量扫描缓存作废，下次进入重扫
    CloudScanCacheStore.instance.invalidate(sel.provider.id, sel.account.accountId);
    showToast(`已保存 ${selectedPaths.value.size} 个文件夹`, 'info');
  } finally {
    saving.value = false;
  }
};

// ── 账号选择下拉：与其他设置页同款自定义材质 ──────────────

const browseAccountDropdownOpen = ref(false);
const browseAccountDropdownRef = ref<HTMLElement | null>(null);
const browseAccountLabel = computed(() => {
  const item = boundAccountsFlat.value[browseIndex.value];
  if (!item) return t('cloud.chooseAccount');
  return `${item.provider.displayName} · ${item.account.nickname || item.account.accountId}`;
});
const selectBrowseAccount = (i: number) => {
  browseAccountDropdownOpen.value = false;
  if (browseIndex.value !== i) {
    browseIndex.value = i;
    openBrowse();
  }
};
const handleBrowseAccountOutsideClick = (event: MouseEvent) => {
  if (
    browseAccountDropdownOpen.value
    && browseAccountDropdownRef.value
    && !browseAccountDropdownRef.value.contains(event.target as Node)
  ) {
    browseAccountDropdownOpen.value = false;
  }
};

// 账号就绪后自动打开（无需手动选择）
watch(
  boundAccountsFlat,
  (list) => {
    if (list.length > 0 && browseIndex.value < 0) openBrowse();
  },
);

// 目录浏览区默认收起（几十个文件夹会把设置页撑爆），点「选择文件夹」行展开；
// 选取模式（歌单导入弹窗内嵌）默认展开，免二次点击
const folderBrowserExpanded = ref(props.pickMode === true);
const toggleFolderBrowser = () => {
  folderBrowserExpanded.value = !folderBrowserExpanded.value;
  // 兜底：账号就绪 watch 已自动 openBrowse，这里覆盖手动提前展开的场景
  if (folderBrowserExpanded.value && browseIndex.value < 0) openBrowse();
};

onMounted(() => {
  void refreshAccounts();
  // 凭据落盘即刷新：登录同步后台导入绑定后，面板无需重开即跟随
  unsubCreds = CloudCredentialsStore.instance.subscribe(() => {
    void refreshAccounts();
  });
  window.addEventListener('mousedown', handleBrowseAccountOutsideClick);
});

onBeforeUnmount(() => {
  unsubCreds?.();
  window.removeEventListener('mousedown', handleBrowseAccountOutsideClick);
});
</script>

<template>
  <div class="rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
    <!-- 标题由宿主（SettingsLibrary 网盘文件夹分组）提供，这里只渲染内容 -->
    <div v-if="boundAccountsFlat.length === 0" :class="rowClass">
      <span class="flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.needBindFirst') }}</span>
    </div>

    <template v-else>
      <div :class="rowClass">
        <span class="min-w-[8rem] flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('cloud.chooseAccount') }}</span>
        <div ref="browseAccountDropdownRef" class="relative w-52 shrink-0 sm:w-56">
          <button
            type="button"
            :aria-expanded="browseAccountDropdownOpen"
            :aria-label="t('cloud.chooseAccount')"
            class="flex h-9 w-full items-center justify-between rounded-lg border border-black/10 bg-white/55 px-3 text-xs font-medium text-gray-800 outline-none transition hover:bg-white/75 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
            @click="browseAccountDropdownOpen = !browseAccountDropdownOpen"
          >
            <span class="truncate">{{ browseAccountLabel }}</span>
            <ChevronDown
              class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500"
              :class="{ 'rotate-180': browseAccountDropdownOpen }"
              :stroke-width="2.2"
            />
          </button>

          <Transition name="settings-dropdown">
            <div
              v-if="browseAccountDropdownOpen"
              class="absolute right-0 top-full z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-black/10 bg-white/90 p-1 text-xs shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#262626]/95"
            >
              <button
                v-for="(item, i) in boundAccountsFlat"
                :key="`${item.provider.id}:${item.account.accountId}`"
                type="button"
                class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium transition-colors"
                :class="browseIndex === i
                  ? 'bg-[#EC4141]/10 text-[#EC4141] dark:bg-[#EC4141]/20 dark:text-[#ff8b8b]'
                  : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
                @click="selectBrowseAccount(i)"
              >
                <span class="truncate">{{ item.provider.displayName }} · {{ item.account.nickname || item.account.accountId }}</span>
                <Check
                  v-if="browseIndex === i"
                  class="h-3.5 w-3.5 shrink-0 text-[#EC4141] dark:text-[#ff8b8b]"
                />
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <!-- 选择文件夹：点击展开/收起目录浏览区 -->
      <button
        type="button"
        :class="rowClass"
        class="w-full text-left"
        :aria-expanded="folderBrowserExpanded"
        @click="toggleFolderBrowser"
      >
        <span class="min-w-0 flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">选择文件夹</span>
        <span v-if="selectedPaths.size > 0" class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          已选 {{ selectedPaths.size }}
        </span>
        <ChevronDown
          class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500"
          :class="{ 'rotate-180': folderBrowserExpanded }"
          :stroke-width="2.2"
        />
      </button>

      <template v-if="folderBrowserExpanded">
      <!-- 已选 chips（跨目录累积） -->
      <div v-if="selectedPaths.size > 0" :class="rowClass">
        <span class="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <button
            v-for="p in selectedPaths"
            :key="p"
            type="button"
            class="group inline-flex max-w-full items-center gap-1 rounded-full border border-[#EC4141]/30 bg-[#EC4141]/8 px-2.5 py-1 text-xs text-[#EC4141] transition hover:bg-[#EC4141]/15"
            :title="p"
            @click="removeSelected(p)"
          >
            <span class="max-w-[12rem] truncate">📁 {{ dirNameOf(p) }}</span>
            <span class="opacity-60 group-hover:opacity-100">×</span>
          </button>
        </span>
      </div>

      <!-- 面包屑 + 返回上一级（移动端选择器同款） -->
      <div v-if="browseSel" :class="rowClass" class="flex-wrap">
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
          <template v-for="(c, i) in browseCrumbs" :key="`${i}:${c.path}`">
            <span v-if="i > 0" class="text-gray-400 dark:text-white/30">›</span>
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
        <button
          v-if="browseCrumbs.length > 1"
          type="button"
          :class="selectChipClass(false)"
          class="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="browseLoading"
          @click="jumpToCrumb(browseCrumbs.length - 2)"
        >
          {{ t('cloud.goUp') }}
        </button>
      </div>

      <!-- 选择当前目录（移动端同款） -->
      <div
        v-if="browseSel"
        :class="rowClass"
        class="cursor-pointer"
        @click="toggleCurrentDir"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2.5">
          <span :class="boxClass(currentDirSelected)">
            <Check v-if="currentDirSelected" class="h-3 w-3" :stroke-width="3" />
          </span>
          <span class="text-sm font-medium text-gray-800 dark:text-gray-200">选择当前文件夹</span>
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
        @click="f.isDir && enterDir(f)"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2.5">
          <button
            v-if="f.isDir"
            type="button"
            :class="boxClass(selectedPaths.has(f.path && f.path !== '' ? f.path : f.id))"
            :aria-label="`选择 ${f.name}`"
            @click.stop="toggleEntry(f)"
          >
            <Check
              v-if="selectedPaths.has(f.path && f.path !== '' ? f.path : f.id)"
              class="h-3 w-3"
              :stroke-width="3"
            />
          </button>
          <span class="shrink-0">{{ f.isDir ? '📁' : f.isAudio ? '🎵' : '📄' }}</span>
          <span
            class="min-w-0 flex-1 truncate text-sm"
            :class="f.isDir || f.isAudio ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-white/30'"
          >
            {{ f.name }}
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

      <!-- 底栏：已选计数 + 保存（移动端同款） -->
      <div
        v-if="browseSel"
        class="flex items-center justify-between gap-4 border-t border-black/5 px-4 py-3 dark:border-white/10"
      >
        <span class="text-xs text-gray-500 dark:text-gray-400">
          已选 {{ selectedPaths.size }} 个文件夹
        </span>
        <button
          type="button"
          class="rounded-lg bg-[#EC4141] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d93a3a] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="saving"
          @click="saveSelection"
        >
          {{ props.pickMode ? '确定' : '保存' }}
        </button>
      </div>
      </template>
    </template>
  </div>
</template>
