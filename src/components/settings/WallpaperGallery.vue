<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from 'vue';
import { getStoredAuth, signedRequest } from '../../services/auth/authService';
import { toolboxApi } from '../../services/tauri/toolboxApi';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select', localPath: string): void;
}>();

interface Wallpaper {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  category: string;
  uploaderId?: string;
  uploaderNickname?: string;
}

interface MyWallpaper extends Wallpaper {
  status: 'normal' | 'disabled' | 'pending' | 'rejected' | string;
  reviewedAt?: string | null;
  reviewedBy?: string;
  createdAt?: string;
}

interface DownloadedWallpaper extends Wallpaper {
  localPath: string;
  downloadedAt: string;
}

type WallpaperTab = 'browse' | 'mine' | 'downloads';

const DOWNLOADED_WALLPAPERS_KEY = 'xianyu_downloaded_wallpapers_v1';

const wallpapers = ref<Wallpaper[]>([]);
const isLoading = ref(true);
const loadError = ref('');
const downloadingId = ref<number | null>(null);
const downloadError = ref('');

// --- 淡出动画 ---
const isClosing = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let uploadCloseTimer: ReturnType<typeof setTimeout> | null = null;

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    emit('close');
    closeTimer = null;
  }, 220);
};

// 当前标签：browse 浏览壁纸中心 / mine 我的上传 / downloads 我的下载
const activeTab = ref<WallpaperTab>('browse');

// 登录态
const auth = getStoredAuth();
const isLoggedIn = computed(() => !!auth && !!auth.user?.ciyuanxi_id);
const currentUser = computed(() => auth?.user);

// 我的上传
const myWallpapers = ref<MyWallpaper[]>([]);
const myLoading = ref(false);
const myError = ref('');

// 我的下载
const downloadedWallpapers = ref<DownloadedWallpaper[]>([]);
const selectedDownloadIds = ref<number[]>([]);
const deletingDownloads = ref(false);

// 上传相关
const showUploadModal = ref(false);
const isUploadClosing = ref(false);
const uploadForm = ref({ title: '', description: '', category: '' });
const uploadFile = ref<File | null>(null);
const uploadPreview = ref('');
const uploading = ref(false);
const uploadError = ref('');

const clearUploadPreview = () => {
  if (uploadPreview.value) {
    URL.revokeObjectURL(uploadPreview.value);
    uploadPreview.value = '';
  }
};

const fetchWallpapers = async () => {
  isLoading.value = true;
  loadError.value = '';
  try {
    const data = await signedRequest<Record<string, unknown>[]>('list_wallpapers', {});
    wallpapers.value = Array.isArray(data) ? data.map((w: Record<string, unknown>) => ({
      id: Number(w.id || 0),
      title: String(w.title || ''),
      description: String(w.description || ''),
      imageUrl: String(w.imageUrl ?? w.image_url ?? w.image ?? ''),
      thumbnailUrl: String(w.thumbnailUrl ?? w.thumbnail_url ?? w.imageUrl ?? w.image_url ?? w.image ?? ''),
      category: String(w.category || ''),
      uploaderId: String(w.uploaderId ?? w.uploader_id ?? w.ciyuanxi_id ?? w.uploader ?? ''),
      uploaderNickname: String(w.uploaderNickname ?? w.uploaded_by_nickname ?? w.nickname ?? ''),
    })) : [];
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '获取壁纸列表失败';
  } finally {
    isLoading.value = false;
  }
};

const fetchMyWallpapers = async () => {
  if (!isLoggedIn.value || !currentUser.value?.ciyuanxi_id) return;
  myLoading.value = true;
  myError.value = '';
  try {
    const data = await signedRequest<Record<string, unknown>[]>('my_wallpapers', {
      ciyuanxi_id: currentUser.value.ciyuanxi_id,
    });
    // 与 fetchWallpapers 一致，对 API 返回字段做容错映射，
    // 兼容 camelCase / snake_case 以及 pending 状态下缺少 thumbnailUrl 的情况
    myWallpapers.value = Array.isArray(data) ? data.map((w: Record<string, unknown>) => ({
      id: Number(w.id || 0),
      title: String(w.title || ''),
      description: String(w.description || ''),
      imageUrl: String(w.imageUrl ?? w.image_url ?? w.image ?? ''),
      thumbnailUrl: String(w.thumbnailUrl ?? w.thumbnail_url ?? w.imageUrl ?? w.image_url ?? w.image ?? ''),
      category: String(w.category || ''),
      status: String(w.status || 'pending'),
      reviewedAt: w.reviewedAt ?? w.reviewed_at ?? null,
      reviewedBy: w.reviewedBy ?? w.reviewed_by ? String(w.reviewedBy ?? w.reviewed_by) : undefined,
      createdAt: w.createdAt ?? w.created_at ? String(w.createdAt ?? w.created_at) : undefined,
      uploaderId: String(w.uploaderId ?? w.uploader_id ?? w.ciyuanxi_id ?? ''),
      uploaderNickname: String(w.uploaderNickname ?? w.uploaded_by_nickname ?? w.nickname ?? ''),
    })) as MyWallpaper[] : [];
  } catch (err) {
    myError.value = err instanceof Error ? err.message : '获取我的上传失败';
  } finally {
    myLoading.value = false;
  }
};

const loadDownloadedWallpapers = () => {
  try {
    const raw = localStorage.getItem(DOWNLOADED_WALLPAPERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    downloadedWallpapers.value = Array.isArray(parsed)
      ? parsed.filter((item): item is DownloadedWallpaper => !!item && typeof item.id === 'number' && typeof item.localPath === 'string')
      : [];
  } catch {
    downloadedWallpapers.value = [];
  }
};

const persistDownloadedWallpapers = () => {
  localStorage.setItem(DOWNLOADED_WALLPAPERS_KEY, JSON.stringify(downloadedWallpapers.value));
};

const downloadedIdSet = computed(() => new Set(downloadedWallpapers.value.map(item => item.id)));

const isDownloaded = (id: number) => downloadedIdSet.value.has(id);

const downloadedRecord = (id: number) => downloadedWallpapers.value.find(item => item.id === id);

const uploaderLabel = (wallpaper: Wallpaper) => {
  const nick = (wallpaper.uploaderNickname || '').trim();
  const id = (wallpaper.uploaderId || '').trim();
  if (nick && id) return `${nick}（${id}）`;
  if (nick) return nick;
  if (id) return `@${id}`;
  return '管理员';
};

const switchTab = (tab: WallpaperTab) => {
  activeTab.value = tab;
  if (tab === 'mine' && isLoggedIn.value && myWallpapers.value.length === 0 && !myError.value) {
    fetchMyWallpapers();
  }
  if (tab === 'downloads') {
    selectedDownloadIds.value = [];
  }
};

const openUploadModal = () => {
  if (!isLoggedIn.value) {
    uploadError.value = '请先登录账号后再上传壁纸';
    return;
  }
  clearUploadPreview();
  uploadForm.value = { title: '', description: '', category: '' };
  uploadFile.value = null;
  uploadError.value = '';
  showUploadModal.value = true;
};

const closeUploadModal = () => {
  if (uploading.value || isUploadClosing.value) return;
  isUploadClosing.value = true;
  uploadCloseTimer = setTimeout(() => {
    showUploadModal.value = false;
    isUploadClosing.value = false;
    uploadFile.value = null;
    clearUploadPreview();
    uploadCloseTimer = null;
  }, 150);
};

const onFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  uploadError.value = '';
  if (!input.files || !input.files[0]) {
    uploadFile.value = null;
    clearUploadPreview();
    return;
  }
  const file = input.files[0];
  // 校验类型
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
    uploadError.value = '只支持 JPG / PNG / WEBP / GIF 格式';
    input.value = '';
    uploadFile.value = null;
    clearUploadPreview();
    return;
  }
  // 校验大小（30MB）
  if (file.size > 30 * 1024 * 1024) {
    uploadError.value = '图片过大，请选择 30MB 以内的图片'
    input.value = ''
    uploadFile.value = null;
    clearUploadPreview();
    return
  }
  clearUploadPreview();
  uploadFile.value = file;
  uploadPreview.value = URL.createObjectURL(file);
};

/** 使用 Canvas 压缩图片为 data URL（JPEG），最大宽度 1920，质量 0.85 */
const compressImageToDataUrl = (file: File, maxWidth = 1920, quality = 0.85): Promise<string> => {
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

const doUpload = async () => {
  if (!isLoggedIn.value || !currentUser.value?.ciyuanxi_id) {
    uploadError.value = '请先登录';
    return;
  }
  const title = uploadForm.value.title.trim();
  if (!title) {
    uploadError.value = '请填写壁纸标题';
    return;
  }
  if (!uploadFile.value) {
    uploadError.value = '请选择壁纸图片';
    return;
  }
  uploading.value = true;
  uploadError.value = '';
  try {
    // Canvas 压缩为 base64（传输用 0.80 质量，服务端会再次压缩到质量 82 存储）
    const imageData = await compressImageToDataUrl(uploadFile.value, 1920, 0.80);
    await signedRequest(
      'upload_wallpaper',
      {
        ciyuanxi_id: currentUser.value.ciyuanxi_id,
        nickname: currentUser.value.nickname || currentUser.value.username || '',
        title,
        description: uploadForm.value.description.trim(),
        category: uploadForm.value.category.trim() || '用户上传',
        image_data: imageData,
      },
      { fetchTimeoutMs: 90_000, timeoutMs: 95_000 },
    );
    isUploadClosing.value = true;
    uploadCloseTimer = setTimeout(() => {
      showUploadModal.value = false;
      isUploadClosing.value = false;
      uploadFile.value = null;
      clearUploadPreview();
      uploadCloseTimer = null;
    }, 150);
    // 切到「我的上传」并刷新
    activeTab.value = 'mine';
    await fetchMyWallpapers();
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : '上传失败';
  } finally {
    uploading.value = false;
  }
};

const statusMeta = (status: string): { text: string; cls: string } => {
  switch (status) {
    case 'normal':   return { text: '已通过', cls: 'bg-green-500/20 text-green-300' };
    case 'pending':  return { text: '待审核', cls: 'bg-amber-500/20 text-amber-300' };
    case 'rejected': return { text: '未通过', cls: 'bg-red-500/20 text-red-300' };
    case 'disabled': return { text: '已禁用', cls: 'bg-gray-500/20 text-gray-300' };
    default:         return { text: status, cls: 'bg-white/10 text-white/60' };
  }
};

const downloadAndUse = async (wallpaper: Wallpaper) => {
  if (downloadingId.value !== null) return;
  downloadingId.value = wallpaper.id;
  downloadError.value = '';
  try {
    let localPath = downloadedRecord(wallpaper.id)?.localPath || '';
    if (!localPath) {
      const filename = `wallpaper_${wallpaper.id}.jpg`;
      localPath = await toolboxApi.downloadWallpaper(wallpaper.imageUrl, filename);
      const record: DownloadedWallpaper = {
        ...wallpaper,
        localPath,
        downloadedAt: new Date().toISOString(),
      };
      downloadedWallpapers.value = [
        record,
        ...downloadedWallpapers.value.filter(item => item.id !== wallpaper.id),
      ];
      persistDownloadedWallpapers();
    }
    emit('select', localPath);
    handleClose();
  } catch (err) {
    downloadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    downloadingId.value = null;
  }
};

const toggleDownloadSelection = (id: number) => {
  selectedDownloadIds.value = selectedDownloadIds.value.includes(id)
    ? selectedDownloadIds.value.filter(item => item !== id)
    : [...selectedDownloadIds.value, id];
};

const selectAllDownloads = () => {
  selectedDownloadIds.value = downloadedWallpapers.value.map(item => item.id);
};

const clearDownloadSelection = () => {
  selectedDownloadIds.value = [];
};

const deleteSelectedDownloads = async () => {
  if (selectedDownloadIds.value.length === 0 || deletingDownloads.value) return;
  const ids = new Set(selectedDownloadIds.value);
  const targets = downloadedWallpapers.value.filter(item => ids.has(item.id));
  deletingDownloads.value = true;
  downloadError.value = '';
  try {
    await Promise.all(targets.map(item => toolboxApi.deleteWallpaperFile(item.localPath).catch(() => undefined)));
    downloadedWallpapers.value = downloadedWallpapers.value.filter(item => !ids.has(item.id));
    selectedDownloadIds.value = [];
    persistDownloadedWallpapers();
  } catch (err) {
    downloadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    deletingDownloads.value = false;
  }
};

const useDownloadedWallpaper = (item: DownloadedWallpaper) => {
  emit('select', item.localPath);
  handleClose();
};

onMounted(() => {
  loadDownloadedWallpapers();
  fetchWallpapers();
});

onBeforeUnmount(() => {
  clearUploadPreview();
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (uploadCloseTimer) {
    clearTimeout(uploadCloseTimer);
    uploadCloseTimer = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      class="wallpaper-overlay fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      :class="{ 'is-closing': isClosing }"
    >
      <div
        class="wallpaper-card flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md"
        :class="{ 'is-closing': isClosing }"
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div class="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[#EC4141]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span class="text-base font-bold">壁纸中心</span>
            <span v-if="activeTab === 'browse' && wallpapers.length" class="text-xs text-white/40">{{ wallpapers.length }} 张</span>
          </div>
          <button @click="handleClose" class="text-white/50 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>

        <!-- 标签栏 + 上传按钮 -->
        <div class="flex items-center justify-between border-b border-white/10 px-6 py-2.5">
          <div class="flex gap-1">
            <button
              @click="switchTab('browse')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'browse' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >壁纸中心</button>
            <button
              @click="switchTab('mine')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'mine' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >我的上传</button>
            <button
              @click="switchTab('downloads')"
              :class="['rounded-lg px-3 py-1.5 text-sm font-medium transition', activeTab === 'downloads' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white']"
            >我的下载<span v-if="downloadedWallpapers.length" class="ml-1 text-[11px] text-white/40">{{ downloadedWallpapers.length }}</span></button>
          </div>
          <button
            v-if="activeTab === 'mine'"
            @click="openUploadModal"
            class="flex items-center gap-1 rounded-full bg-[#EC4141] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            上传壁纸
          </button>
        </div>

        <!-- 未登录提示（我的上传） -->
        <div v-if="activeTab === 'mine' && !isLoggedIn" class="flex h-[60vh] flex-col items-center justify-center text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <p class="text-sm">请先登录账号后再上传壁纸</p>
        </div>

        <!-- 内容区 -->
        <div v-else class="h-[60vh] overflow-y-auto p-6">
          <!-- ====== 浏览：加载中 ====== -->
          <div v-if="activeTab === 'browse' && isLoading" class="flex flex-col items-center justify-center py-20 text-white/40">
            <svg class="mb-3 h-8 w-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">正在加载壁纸…</span>
          </div>

          <!-- ====== 浏览：加载失败 ====== -->
          <div v-else-if="activeTab === 'browse' && loadError" class="flex flex-col items-center justify-center py-20 text-white/50">
            <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p class="mb-3 text-sm">{{ loadError }}</p>
            <button @click="fetchWallpapers" class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold transition hover:bg-white/10">重新加载</button>
          </div>

          <!-- ====== 浏览：空列表 ====== -->
          <div v-else-if="activeTab === 'browse' && wallpapers.length === 0" class="flex flex-col items-center justify-center py-20 text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="text-sm">暂无壁纸，敬请期待</span>
          </div>

          <!-- ====== 浏览：壁纸网格 ====== -->
          <div v-else-if="activeTab === 'browse'" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            <div
              v-for="wallpaper in wallpapers"
              :key="wallpaper.id"
              class="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-all hover:border-[#EC4141]/50 hover:shadow-[0_0_15px_rgba(236,65,65,0.25)]"
            >
              <div class="aspect-[16/10] w-full overflow-hidden">
                <img :src="wallpaper.thumbnailUrl || wallpaper.imageUrl" :alt="wallpaper.title" loading="eager" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
              </div>
              <!-- 上传者 ID 徽标 -->
              <div class="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                {{ uploaderLabel(wallpaper) }}
              </div>
              <div v-if="isDownloaded(wallpaper.id)" class="absolute left-2 top-2 rounded-full bg-green-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                已下载
              </div>
              <div class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <div class="p-3">
                  <h3 class="truncate text-sm font-semibold">{{ wallpaper.title }}</h3>
                  <p class="mt-0.5 truncate text-[11px] text-white/50">上传者：{{ uploaderLabel(wallpaper) }}</p>
                  <p v-if="wallpaper.description" class="mt-0.5 line-clamp-2 text-xs text-white/60">{{ wallpaper.description }}</p>
                  <button @click="downloadAndUse(wallpaper)" :disabled="downloadingId !== null" class="mt-2 w-full rounded-full bg-[#EC4141] py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60">
                    <span v-if="downloadingId === wallpaper.id">下载中…</span>
                    <span v-else>{{ isDownloaded(wallpaper.id) ? '使用已下载' : '下载并使用' }}</span>
                  </button>
                </div>
              </div>
              <div v-if="downloadingId === wallpaper.id" class="absolute inset-0 flex items-center justify-center bg-black/50">
                <svg class="h-6 w-6 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>
          </div>

          <!-- ====== 我的上传：加载中 ====== -->
          <div v-if="activeTab === 'mine' && myLoading" class="flex flex-col items-center justify-center py-20 text-white/40">
            <svg class="mb-3 h-8 w-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">正在加载我的上传…</span>
          </div>

          <!-- ====== 我的上传：错误 ====== -->
          <div v-else-if="activeTab === 'mine' && myError" class="flex flex-col items-center justify-center py-20 text-white/50">
            <p class="mb-3 text-sm">{{ myError }}</p>
            <button @click="fetchMyWallpapers" class="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold transition hover:bg-white/10">重新加载</button>
          </div>

          <!-- ====== 我的上传：空 ====== -->
          <div v-else-if="activeTab === 'mine' && myWallpapers.length === 0" class="flex flex-col items-center justify-center py-20 text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="mb-3 text-sm">还没有上传过壁纸</span>
            <button @click="openUploadModal" class="rounded-full bg-[#EC4141] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#d13a3a]">上传第一张</button>
          </div>

          <!-- ====== 我的上传：网格 ====== -->
          <div v-else-if="activeTab === 'mine'" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            <div
              v-for="wp in myWallpapers"
              :key="wp.id"
              class="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-all"
              :class="wp.status === 'normal' ? 'hover:border-[#EC4141]/50' : ''"
            >
              <div class="aspect-[16/10] w-full overflow-hidden">
                <img :src="wp.thumbnailUrl || wp.imageUrl" :alt="wp.title" loading="eager" class="h-full w-full object-cover" :class="wp.status === 'rejected' || wp.status === 'disabled' ? 'opacity-50 grayscale' : ''" />
              </div>
              <!-- 状态徽标 -->
              <div class="absolute left-2 top-2">
                <span :class="['rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm', statusMeta(wp.status).cls]">{{ statusMeta(wp.status).text }}</span>
              </div>
              <div class="p-3">
                <h3 class="truncate text-sm font-semibold">{{ wp.title }}</h3>
                <p v-if="wp.status === 'pending'" class="mt-1 text-[11px] text-amber-300/80">等待管理员审核</p>
                <p v-else-if="wp.status === 'rejected'" class="mt-1 text-[11px] text-red-300/80">审核未通过</p>
                <p v-else-if="wp.status === 'normal'" class="mt-1 text-[11px] text-green-300/80">已通过审核，壁纸中心可见</p>
                <p v-else-if="wp.status === 'disabled'" class="mt-1 text-[11px] text-gray-300/60">已被管理员禁用</p>
                <p v-if="wp.status === 'normal' && isDownloaded(wp.id)" class="mt-1 text-[11px] text-sky-300/80">已下载到本地</p>
                <button
                  v-if="wp.status === 'normal'"
                  @click="downloadAndUse(wp)"
                  :disabled="downloadingId !== null"
                  class="mt-2 w-full rounded-full bg-[#EC4141] py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span v-if="downloadingId === wp.id">下载中…</span>
                  <span v-else>{{ isDownloaded(wp.id) ? '使用已下载' : '下载并使用' }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- ====== 我的下载 ====== -->
          <div v-if="activeTab === 'downloads'">
            <div v-if="downloadedWallpapers.length === 0" class="flex flex-col items-center justify-center py-20 text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              <span class="text-sm">还没有下载过壁纸</span>
            </div>
            <template v-else>
              <div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div class="text-xs text-white/50">
                  已保存 {{ downloadedWallpapers.length }} 张，已选择 {{ selectedDownloadIds.length }} 张
                </div>
                <div class="flex gap-2">
                  <button @click="selectAllDownloads" class="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10">全选</button>
                  <button @click="clearDownloadSelection" class="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10">取消选择</button>
                  <button
                    @click="deleteSelectedDownloads"
                    :disabled="selectedDownloadIds.length === 0 || deletingDownloads"
                    class="rounded-full bg-[#EC4141] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-50"
                  >{{ deletingDownloads ? '删除中…' : '删除所选' }}</button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                <div
                  v-for="item in downloadedWallpapers"
                  :key="item.id"
                  class="group relative overflow-hidden rounded-xl border bg-white/5 transition-all"
                  :class="selectedDownloadIds.includes(item.id) ? 'border-[#EC4141]/70 shadow-[0_0_15px_rgba(236,65,65,0.2)]' : 'border-white/10 hover:border-[#EC4141]/50'"
                >
                  <button
                    @click.stop="toggleDownloadSelection(item.id)"
                    class="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border backdrop-blur-sm transition"
                    :class="selectedDownloadIds.includes(item.id) ? 'border-[#EC4141] bg-[#EC4141] text-white' : 'border-white/30 bg-black/45 text-transparent hover:text-white'"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <div class="aspect-[16/10] w-full overflow-hidden">
                    <img :src="item.thumbnailUrl || item.imageUrl" :alt="item.title" loading="eager" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  </div>
                  <div class="p-3">
                    <h3 class="truncate text-sm font-semibold">{{ item.title }}</h3>
                    <p class="mt-1 truncate text-[11px] text-white/50">上传者：{{ uploaderLabel(item) }}</p>
                    <p class="mt-1 truncate text-[11px] text-white/35">本地：{{ item.localPath }}</p>
                    <button @click="useDownloadedWallpaper(item)" class="mt-2 w-full rounded-full bg-[#EC4141] py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a]">
                      使用此壁纸
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 下载错误提示 -->
          <div v-if="downloadError" class="mt-4 rounded-lg border border-[#EC4141]/30 bg-[#EC4141]/10 px-4 py-2 text-xs text-[#ff8a8a]">
            下载失败：{{ downloadError }}
          </div>
        </div>

        <!-- 底部说明 -->
        <div class="border-t border-white/10 px-6 py-3 text-center text-[11px] text-white/30">
          <template v-if="activeTab === 'browse'">点击「下载并使用」将保存到本地，已下载壁纸会直接复用，避免重复下载</template>
          <template v-else-if="activeTab === 'mine'">用户上传的壁纸需经管理员审核通过后才会展示在壁纸中心</template>
          <template v-else>我的下载支持多选删除；删除只影响本机已保存的壁纸文件</template>
        </div>
      </div>

      <!-- 上传弹窗 -->
      <div
        v-if="showUploadModal"
        class="upload-overlay fixed inset-0 z-[10002] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        :class="{ 'is-closing': isUploadClosing }"
        @click.self="closeUploadModal"
      >
        <div
          class="upload-card w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-neutral-900/95 text-white shadow-2xl"
          :class="{ 'is-closing': isUploadClosing }"
        >
          <div class="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
            <span class="text-sm font-bold">上传壁纸</span>
            <button @click="closeUploadModal" :disabled="uploading" class="text-white/50 transition hover:text-white disabled:opacity-40">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
            </button>
          </div>
          <div class="max-h-[70vh] overflow-y-auto p-5">
            <div class="mb-3">
              <label class="mb-1 block text-xs text-white/60">标题 <span class="text-[#EC4141]">*</span></label>
              <input v-model="uploadForm.title" maxlength="60" placeholder="给壁纸起个名字" class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10" />
            </div>
            <div class="mb-3">
              <label class="mb-1 block text-xs text-white/60">描述</label>
              <textarea v-model="uploadForm.description" rows="2" placeholder="可选，简短描述" class="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-[#EC4141]/60"></textarea>
            </div>
            <div class="mb-3">
              <label class="mb-1 block text-xs text-white/60">分类</label>
              <input v-model="uploadForm.category" placeholder="留空默认为「用户上传」" class="w-full h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10" />
            </div>
            <div class="mb-2">
              <label class="mb-1 block text-xs text-white/60">图片 <span class="text-[#EC4141]">*</span></label>
              <div class="rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-2">
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/*" @change="onFileChange" class="w-full text-xs text-white/70 file:mr-3 file:rounded file:border-0 file:bg-[#EC4141] file:px-3 file:py-1 file:text-xs file:font-medium file:text-white hover:file:bg-[#d13a3a]" />
                <p class="mt-1 text-[10px] text-white/40">支持 JPG / PNG / WEBP / GIF，30MB 以内，将自动压缩为 1920px JPEG</p>
              </div>
              <div v-if="uploadPreview" class="mt-2 overflow-hidden rounded-lg border border-white/10">
                <img :src="uploadPreview" alt="预览" class="max-h-40 w-full object-cover" />
              </div>
            </div>
            <div v-if="uploadError" class="mt-3 rounded-lg border border-[#EC4141]/30 bg-[#EC4141]/10 px-3 py-2 text-xs text-[#ff8a8a]">{{ uploadError }}</div>
            <p class="mt-3 text-[11px] text-white/40">上传后状态为「待审核」，管理员审核通过后才会展示在壁纸中心供所有人下载。</p>
          </div>
          <div class="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
            <button @click="closeUploadModal" :disabled="uploading" class="rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 disabled:opacity-40">取消</button>
            <button @click="doUpload" :disabled="uploading" class="rounded-lg bg-[#EC4141] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60">
              <span v-if="uploading">上传中…</span>
              <span v-else>上传</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ==================== 主弹窗动画 ==================== */
.wallpaper-overlay {
  animation: wallpaper-overlay-in 0.2s ease;
  transition: opacity 0.2s ease;
}

.wallpaper-card {
  animation: wallpaper-card-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes wallpaper-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes wallpaper-card-in {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

/* 离开动画（is-closing 类驱动） */
.wallpaper-overlay.is-closing {
  opacity: 0;
}

.wallpaper-card.is-closing {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

/* ==================== 上传弹窗动画 ==================== */
.upload-overlay {
  animation: upload-overlay-in 0.15s ease;
  transition: opacity 0.15s ease;
}

.upload-card {
  animation: upload-card-in 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: opacity 0.15s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes upload-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes upload-card-in {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

/* 离开动画（is-closing 类驱动） */
.upload-overlay.is-closing {
  opacity: 0;
}

.upload-card.is-closing {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>
