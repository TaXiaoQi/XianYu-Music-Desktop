<script setup lang="ts">
// 主题中心弹层：与 WallpaperGallery.vue 同形态（Teleport + 淡出动画 + Tab 结构）。
// 四个 Tab 对齐移动端主题中心：本地（库内全部）/ 广场（list_themes）/
// 我的上传（my_themes，只读）/ 我的下载（库内 source==='square' 子集）。
// 「下载即应用」：广场应用同时入库；应用复用 applyDesktopThemePackage → replaceTheme。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

import { useThemeSettings } from '../../composables/useThemeSettings';
import { useSettings } from '../../features/settings/useSettings';
import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { getStoredAuth, signedRequest } from '../../services/auth/authService';
import { applyDesktopThemePackage } from '../../features/settings/desktopThemePackage';
import {
  listThemeSquare,
  squareItemPackage,
  squareItemPreview,
  type ThemeSquareItem,
} from '../../features/settings/themeSquare';
import {
  listLibraryThemes,
  addLibraryTheme,
  removeLibraryTheme,
  libraryPreview,
  type LibraryThemeEntry,
} from '../../features/settings/themeLibrary';

const emit = defineEmits<{ (event: 'close'): void; }>();

const { isEnglish } = useI18n();
const { theme } = useThemeSettings();
const { replaceTheme } = useSettings();
const { showToast } = useToast();

// —— 关闭淡出动画：先播动画再卸载（与 WallpaperGallery 一致）——
const isClosing = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    emit('close');
    closeTimer = null;
  }, 220);
};

onMounted(() => {
  void loadThemeSquare();
  refreshLibrary();
});

onBeforeUnmount(() => {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
});

// —— Tab 切换 ——
type GalleryTab = 'local' | 'square' | 'mine' | 'downloads';
const activeTab = ref<GalleryTab>('square');

const switchTab = (tab: GalleryTab) => {
  activeTab.value = tab;
  if (tab === 'local' || tab === 'downloads') refreshLibrary();
  if (tab === 'mine' && myState.value === 'idle') void fetchMyThemes();
};

const isBusy = (id: string) => applyingRef.value === id;

// —— 应用链路（三个 Tab 共用）——
const applyingRef = ref('');

const applyRawTheme = async (busyId: string, raw: unknown, name: string): Promise<boolean> => {
  if (applyingRef.value) return false;
  applyingRef.value = busyId;
  try {
    const result = applyDesktopThemePackage(raw);
    // 整体替换主题设置，保留与主题视觉无关的个人开关。
    const current = theme.value;
    replaceTheme({
      ...result.settings,
      useCustomTrayMenu: current.useCustomTrayMenu,
      showLeaderboard: current.showLeaderboard,
      playerDetailCoverBehavior: current.playerDetailCoverBehavior,
      lastPlayerDetailCoverVisible: current.lastPlayerDetailCoverVisible,
    });
    showToast(isEnglish.value ? `Applied “${name}”` : `已应用《${name}》`, 'success');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : (isEnglish.value ? 'Failed to apply theme' : '主题应用失败');
    showToast(message, 'error');
    return false;
  } finally {
    applyingRef.value = '';
  }
};

// —— 广场（list_themes, platform=desktop）——
const squareItems = ref<ThemeSquareItem[]>([]);
const squareState = ref<'loading' | 'ready' | 'error'>('loading');

const loadThemeSquare = async () => {
  squareState.value = 'loading';
  try {
    squareItems.value = await listThemeSquare();
    squareState.value = 'ready';
  } catch {
    squareState.value = 'error';
  }
};

const applySquareTheme = async (item: ThemeSquareItem) => {
  // 相对 /uploads 资源补全后再校验/应用；库内存同一份绝对化包，二次应用无需再补全。
  const raw = squareItemPackage(item);
  const ok = await applyRawTheme(`square-${item.id}`, raw, item.name);
  if (!ok) return;
  addLibraryTheme({
    source: 'square',
    squareId: item.id,
    name: item.name,
    author: item.uploaderNickname,
    preview: squareItemPreview(item),
    raw,
  });
  refreshLibrary();
};

// —— 本地库 / 我的下载 ——
const library = ref<LibraryThemeEntry[]>([]);
const removingKey = ref('');

const refreshLibrary = () => { library.value = listLibraryThemes(); };

const downloadedThemes = computed(() => library.value.filter((item) => item.source === 'square'));

const applyLibraryTheme = (entry: LibraryThemeEntry) =>
  applyRawTheme(`lib-${entry.key}`, entry.raw, entry.name);

const removeLibraryEntry = async (entry: LibraryThemeEntry) => {
  if (removingKey.value) return;
  removingKey.value = entry.key;
  try {
    removeLibraryTheme(entry.key);
    refreshLibrary();
  } finally {
    removingKey.value = '';
  }
};

// —— 我的上传（my_themes，只读 + 可直接应用自己的包）——
interface MyThemeItem extends ThemeSquareItem {
  status: string;
  description: string;
}

const auth = getStoredAuth();
const isLoggedIn = computed(() => !!auth && !!auth.user?.ciyuanxi_id);
const myItems = ref<MyThemeItem[]>([]);
const myState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
const myErrorText = ref('');

const statusText = (status: string) => {
  if (status === 'normal') return isEnglish.value ? 'Approved' : '已通过';
  if (status === 'rejected') return isEnglish.value ? 'Rejected' : '未通过';
  return isEnglish.value ? 'Pending review' : '待审核';
};

const statusClass = (status: string) => {
  if (status === 'normal') return 'text-green-300/90 bg-green-400/10 border-green-300/20';
  if (status === 'rejected') return 'text-[#ff8a8a] bg-[#EC4141]/10 border-[#EC4141]/30';
  return 'text-amber-300/90 bg-amber-400/10 border-amber-300/20';
};

const fetchMyThemes = async () => {
  const ciyuanxiId = auth?.user?.ciyuanxi_id;
  if (!isLoggedIn.value || !ciyuanxiId) return;
  myState.value = 'loading';
  myErrorText.value = '';
  try {
    const data = await signedRequest<Record<string, unknown>[]>('my_themes', {
      ciyuanxi_id: ciyuanxiId,
      platform: 'desktop',
    });
    myItems.value = Array.isArray(data) ? data.map((t) => ({
      id: Number(t.id || 0),
      name: String(t.name || ''),
      theme: t.theme ?? null,
      previewUrl: String(t.previewUrl ?? t.preview_url ?? ''),
      thumbnailUrl: String(t.thumbnailUrl ?? t.thumbnail_url ?? ''),
      uploaderNickname: String(t.uploaderNickname ?? t.uploader_nickname ?? ''),
      status: String(t.status || 'pending'),
      description: String(t.description || ''),
    })) : [];
    myState.value = 'ready';
  } catch (err) {
    myErrorText.value = err instanceof Error ? err.message : (isEnglish.value ? 'Failed to load your uploads' : '获取我的上传失败');
    myState.value = 'error';
  }
};

const applyMyTheme = async (item: MyThemeItem) => {
  const raw = squareItemPackage(item);
  await applyRawTheme(`square-${item.id}`, raw, item.name);
};
</script>

<template>
  <Teleport to="body">
    <div
      class="theme-overlay fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      :class="{ 'is-closing': isClosing }"
    >
      <div
        class="theme-card flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md"
        :class="{ 'is-closing': isClosing }"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
          <div class="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[#EC4141]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
            </svg>
            <span class="text-base font-bold">主题中心</span>
            <span v-if="activeTab === 'square' && squareState === 'ready' && squareItems.length" class="text-xs text-white/40">{{ squareItems.length }} 款</span>
          </div>
          <div class="flex items-center gap-3">
            <button
              v-if="activeTab === 'square'"
              class="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="squareState === 'loading'"
              @click="loadThemeSquare"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" :class="squareState === 'loading' ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
              </svg>
              刷新
            </button>
            <button @click="handleClose" class="text-white/50 transition hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <div class="flex shrink-0 items-center border-b border-white/10 px-5 py-2">
          <div class="flex gap-1">
            <button
              @click="switchTab('local')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'local' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >本地<span v-if="library.length" class="ml-1 text-[11px] text-white/40">{{ library.length }}</span></button>
            <button
              @click="switchTab('square')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'square' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >广场</button>
            <button
              @click="switchTab('mine')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'mine' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >我的上传</button>
            <button
              @click="switchTab('downloads')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'downloads' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >我的下载<span v-if="downloadedThemes.length" class="ml-1 text-[11px] text-white/40">{{ downloadedThemes.length }}</span></button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-5">
          <!-- 本地：库内全部主题包 -->
          <div v-if="activeTab === 'local'">
            <div v-if="library.length === 0" class="py-16 text-center text-xs text-white/45">还没有导入主题</div>
            <div v-else class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div
                v-for="entry in library"
                :key="entry.key"
                class="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 transition-all hover:-translate-y-0.5 hover:border-[#EC4141]/40 hover:bg-white/10"
              >
                <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-white/5">
                  <img v-if="libraryPreview(entry.preview)" :src="libraryPreview(entry.preview)" :alt="entry.name" loading="lazy" class="h-full w-full object-cover" />
                  <div v-else class="flex h-full w-full items-center justify-center text-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  </div>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold text-white/90">{{ entry.name }}</div>
                  <div class="truncate text-[11px] text-white/40">{{ entry.author || (entry.source === 'square' ? '来自广场' : '本地导入') }}</div>
                </div>
                <div class="flex gap-1.5">
                  <button
                    class="flex flex-1 items-center justify-center rounded-full bg-[#EC4141] px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#EC4141]"
                    :disabled="!!applyingRef || !!removingKey"
                    @click="applyLibraryTheme(entry)"
                  >
                    <svg v-if="isBusy(`lib-${entry.key}`)" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
                    <template v-else>应用</template>
                  </button>
                  <button
                    class="flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!!applyingRef || !!removingKey"
                    @click="removeLibraryEntry(entry)"
                  >删除</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 广场：list_themes -->
          <div v-else-if="activeTab === 'square'">
            <div v-if="squareState === 'loading'" class="flex items-center justify-center gap-2 py-16 text-xs text-white/45">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
              </svg>
              主题加载中…
            </div>
            <div v-else-if="squareState === 'error'" class="flex flex-col items-center gap-2 py-16">
              <span class="text-xs text-white/45">主题加载失败</span>
              <button
                class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
                @click="loadThemeSquare"
              >重试</button>
            </div>
            <div v-else-if="squareItems.length === 0" class="py-16 text-center text-xs text-white/45">暂无主题</div>
            <div v-else class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div
                v-for="item in squareItems"
                :key="item.id"
                class="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 transition-all hover:-translate-y-0.5 hover:border-[#EC4141]/40 hover:bg-white/10"
              >
                <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-white/5">
                  <img v-if="squareItemPreview(item)" :src="squareItemPreview(item)" :alt="item.name" loading="lazy" class="h-full w-full object-cover" />
                  <div v-else class="flex h-full w-full items-center justify-center text-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  </div>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold text-white/90">{{ item.name }}</div>
                  <div class="truncate text-[11px] text-white/40">{{ item.uploaderNickname }}</div>
                </div>
                <button
                  class="flex items-center justify-center rounded-full bg-[#EC4141] px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#EC4141]"
                  :disabled="!!applyingRef"
                  @click="applySquareTheme(item)"
                >
                  <svg v-if="isBusy(`square-${item.id}`)" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
                  <template v-else>应用</template>
                </button>
              </div>
            </div>
          </div>

          <!-- 我的上传：my_themes（只读 + 可应用） -->
          <div v-else-if="activeTab === 'mine'">
            <div v-if="!isLoggedIn" class="py-16 text-center text-xs text-white/45">请先登录后查看我的上传</div>
            <div v-else-if="myState === 'loading'" class="flex items-center justify-center gap-2 py-16 text-xs text-white/45">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
              </svg>
              主题加载中…
            </div>
            <div v-else-if="myState === 'error'" class="flex flex-col items-center gap-2 py-16">
              <span class="text-xs text-white/45">{{ myErrorText }}</span>
              <button
                class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
                @click="fetchMyThemes"
              >重试</button>
            </div>
            <div v-else-if="myItems.length === 0" class="py-16 text-center text-xs text-white/45">暂无上传</div>
            <div v-else class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div
                v-for="item in myItems"
                :key="item.id"
                class="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 transition-all hover:-translate-y-0.5 hover:border-[#EC4141]/40 hover:bg-white/10"
              >
                <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-white/5">
                  <img v-if="squareItemPreview(item)" :src="squareItemPreview(item)" :alt="item.name" loading="lazy" class="h-full w-full object-cover" />
                  <div v-else class="flex h-full w-full items-center justify-center text-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  </div>
                  <span class="absolute right-1.5 top-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm" :class="statusClass(item.status)">{{ statusText(item.status) }}</span>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold text-white/90">{{ item.name }}</div>
                  <div class="truncate text-[11px] text-white/40">{{ item.uploaderNickname }}</div>
                </div>
                <button
                  class="flex items-center justify-center rounded-full bg-[#EC4141] px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#EC4141]"
                  :disabled="!!applyingRef"
                  @click="applyMyTheme(item)"
                >
                  <svg v-if="isBusy(`square-${item.id}`)" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
                  <template v-else>应用</template>
                </button>
              </div>
            </div>
          </div>

          <!-- 我的下载：库内广场来源子集 -->
          <div v-else>
            <div v-if="downloadedThemes.length === 0" class="py-16 text-center text-xs text-white/45">还没有从主题中心下载主题</div>
            <div v-else class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div
                v-for="entry in downloadedThemes"
                :key="entry.key"
                class="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 transition-all hover:-translate-y-0.5 hover:border-[#EC4141]/40 hover:bg-white/10"
              >
                <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-white/5">
                  <img v-if="libraryPreview(entry.preview)" :src="libraryPreview(entry.preview)" :alt="entry.name" loading="lazy" class="h-full w-full object-cover" />
                  <div v-else class="flex h-full w-full items-center justify-center text-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  </div>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold text-white/90">{{ entry.name }}</div>
                  <div class="truncate text-[11px] text-white/40">{{ entry.author }}</div>
                </div>
                <div class="flex gap-1.5">
                  <button
                    class="flex flex-1 items-center justify-center rounded-full bg-[#EC4141] px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#EC4141]"
                    :disabled="!!applyingRef || !!removingKey"
                    @click="applyLibraryTheme(entry)"
                  >
                    <svg v-if="isBusy(`lib-${entry.key}`)" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
                    <template v-else>应用</template>
                  </button>
                  <button
                    class="flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!!applyingRef || !!removingKey"
                    @click="removeLibraryEntry(entry)"
                  >移除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ==================== 弹窗进出场动画（对齐壁纸中心） ==================== */
.theme-overlay {
  animation: theme-overlay-in 0.2s ease;
  transition: opacity 0.2s ease;
}

.theme-card {
  animation: theme-card-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes theme-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes theme-card-in {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.theme-overlay.is-closing {
  opacity: 0;
}

.theme-card.is-closing {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>
