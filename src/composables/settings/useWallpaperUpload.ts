import { onBeforeUnmount, ref, type ComputedRef } from "vue";
import { signedRequest } from "../../services/auth/authService";
import type { AuthUser } from "../../services/auth/authTypes";

interface UseWallpaperUploadOptions {
    /** 是否已登录（与主组件共享同一份登录态） */
    isLoggedIn: ComputedRef<boolean>;
    /** 当前登录用户 */
    currentUser: ComputedRef<AuthUser | undefined>;
    /** 上传成功后的跳转：切到「我的上传」并刷新列表 */
    onUploadSuccess: () => Promise<void> | void;
}

/**
 * 壁纸中心上传弹层：
 * 文件选择校验、图片压缩 / 视频首帧封面提取、上传提交与弹层淡出关闭。
 */
export function useWallpaperUpload({
    isLoggedIn,
    currentUser,
    onUploadSuccess,
}: UseWallpaperUploadOptions) {
    const showUploadModal = ref(false); // 实现
    const isUploadClosing = ref(false);
    const uploadForm = ref({ title: "", description: "", category: "" });
    const uploadFile = ref<File | null>(null); // 实现
    const uploadPreview = ref("");
    const uploadVideoUrl = ref("");
    const uploadIsVideo = ref(false);
    const uploadVideoDuration = ref(0);
    const uploading = ref(false); // 实现
    const uploadError = ref("");
    let uploadCloseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearUploadPreview = () => {
        if (uploadPreview.value) {
            URL.revokeObjectURL(uploadPreview.value);
            uploadPreview.value = "";
        }
        if (uploadVideoUrl.value) {
            URL.revokeObjectURL(uploadVideoUrl.value);
            uploadVideoUrl.value = "";
        }
        uploadIsVideo.value = false;
        uploadVideoDuration.value = 0;
    }; // 实现
    const openUploadModal = () => { // 实现
        if (!isLoggedIn.value) {
            uploadError.value = "请先登录账号后再上传壁纸";
            return;
        }
        clearUploadPreview();
        uploadForm.value = { title: "", description: "", category: "" };
        uploadFile.value = null; // 实现
        uploadError.value = "";
        showUploadModal.value = true;
    }; // 实现
    const closeUploadModal = () => { // 实现
        if (uploading.value || isUploadClosing.value) return;
        isUploadClosing.value = true;
        uploadCloseTimer = setTimeout(() => {
            showUploadModal.value = false;
            isUploadClosing.value = false;
            uploadFile.value = null;
            clearUploadPreview();
            uploadCloseTimer = null;
        }, 150);
    }; // 实现
    const onFileChange = (e: Event) => { // 实现
        const input = e.target as HTMLInputElement;
        uploadError.value = "";
        if (!input.files || !input.files[0]) {
            uploadFile.value = null;
            clearUploadPreview();
            return;
        }
        const file = input.files[0];
        if (/^video\/mp4$/i.test(file.type) || /\.mp4$/i.test(file.name)) {
            if (file.size > 50 * 1024 * 1024) {
                uploadError.value = "视频过大，请选择 50MB 以内的 MP4 视频";
                input.value = "";
                uploadFile.value = null;
                clearUploadPreview();
                return;
            }
            clearUploadPreview();
            uploadFile.value = file;
            uploadIsVideo.value = true;
            uploadVideoUrl.value = URL.createObjectURL(file);
            // 读视频时长，兜底失败时按 0 上报（服务端仅校验 0-86400）
            const probe = document.createElement("video");
            probe.preload = "metadata";
            probe.muted = true;
            probe.onloadedmetadata = () => {
                uploadVideoDuration.value = Math.max(
                    0,
                    Math.round(probe.duration || 0),
                );
                probe.removeAttribute("src");
                probe.load();
            };
            probe.onerror = () => {
                probe.removeAttribute("src");
                probe.load();
            };
            probe.src = uploadVideoUrl.value;
            return;
        }
        if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
            uploadError.value = "只支持 JPG / PNG / WEBP / GIF 图片或 MP4 视频";
            input.value = "";
            uploadFile.value = null;
            clearUploadPreview();
            return;
        }
        if (file.size > 30 * 1024 * 1024) {
            uploadError.value = "图片过大，请选择 30MB 以内的图片";
            input.value = "";
            uploadFile.value = null;
            clearUploadPreview();
            return;
        }
        clearUploadPreview();
        uploadFile.value = file;
        uploadPreview.value = URL.createObjectURL(file);
    }; // 实现
    const compressImageToDataUrl = (
        file: File,
        maxWidth = 1920,
        quality = 0.85,
    ): Promise<string> => {
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
                    const canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        reject(new Error("Canvas 上下文不可用"));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL("image/jpeg", quality);
                    canvas.width = 0;
                    canvas.height = 0;
                    img.onload = null;
                    img.onerror = null;
                    img.src = "";
                    resolve(dataUrl);
                };
                img.onerror = () => reject(new Error("图片加载失败"));
                img.src = reader.result as string;
            };
            reader.onerror = () => reject(new Error("文件读取失败"));
            reader.readAsDataURL(file);
        });
    }; // 实现
    const fileToDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("文件读取失败"));
            reader.readAsDataURL(file);
        });

    // 视频首帧封面：loadeddata 时首帧已就绪，直接绘到 canvas 导出 JPEG
    const captureVideoPoster = (url: string): Promise<string> =>
        new Promise((resolve, reject) => {
            const video = document.createElement("video");
            video.muted = true;
            video.preload = "auto";
            const cleanup = () => {
                video.onloadeddata = null;
                video.onerror = null;
                video.removeAttribute("src");
                video.load();
            };
            video.onloadeddata = () => {
                try {
                    const w = video.videoWidth;
                    const h = video.videoHeight;
                    if (!w || !h) {
                        cleanup();
                        reject(new Error("无法读取视频画面"));
                        return;
                    }
                    let cw = w;
                    let ch = h;
                    if (cw > 1920) {
                        ch = Math.round(ch * (1920 / cw));
                        cw = 1920;
                    }
                    const canvas = document.createElement("canvas");
                    canvas.width = cw;
                    canvas.height = ch;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        cleanup();
                        reject(new Error("Canvas 上下文不可用"));
                        return;
                    }
                    ctx.drawImage(video, 0, 0, cw, ch);
                    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
                    canvas.width = 0;
                    cleanup();
                    resolve(dataUrl);
                } catch (err) {
                    cleanup();
                    reject(
                        err instanceof Error ? err : new Error("视频封面提取失败"),
                    );
                }
            };
            video.onerror = () => {
                cleanup();
                reject(new Error("视频无法解析，请换一个文件"));
            };
            video.src = url;
        });

    const doUpload = async () => { // 实现
        if (!isLoggedIn.value || !currentUser.value?.ciyuanxi_id) {
            uploadError.value = "请先登录";
            return;
        }
        const title = uploadForm.value.title.trim();
        if (!title) {
            uploadError.value = "请填写壁纸标题";
            return;
        }
        if (!uploadFile.value) {
            uploadError.value = "请选择壁纸图片或视频";
            return;
        }
        uploading.value = true;
        uploadError.value = "";
        try {
            if (uploadIsVideo.value) {
                const poster = await captureVideoPoster(uploadVideoUrl.value);
                const videoData = await fileToDataUrl(uploadFile.value);
                await signedRequest(
                    "upload_wallpaper",
                    {
                        ciyuanxi_id: currentUser.value.ciyuanxi_id,
                        nickname:
                            currentUser.value.nickname ||
                            currentUser.value.username ||
                            "",
                        title,
                        description: uploadForm.value.description.trim(),
                        category: uploadForm.value.category.trim() || "用户上传",
                        platform: "desktop",
                        image_data: poster,
                        video_data: videoData,
                        video_duration: uploadVideoDuration.value,
                    },
                    { fetchTimeoutMs: 600_000, timeoutMs: 610_000 },
                );
            } else {
                const imageData = await compressImageToDataUrl(
                    uploadFile.value,
                    1920,
                    0.8,
                );
                await signedRequest(
                    "upload_wallpaper",
                    {
                        ciyuanxi_id: currentUser.value.ciyuanxi_id,
                        nickname:
                            currentUser.value.nickname ||
                            currentUser.value.username ||
                            "",
                        title,
                        description: uploadForm.value.description.trim(),
                        category: uploadForm.value.category.trim() || "用户上传",
                        platform: "desktop",
                        image_data: imageData,
                    },
                    { fetchTimeoutMs: 90_000, timeoutMs: 95_000 },
                );
            }
            isUploadClosing.value = true;
            uploadCloseTimer = setTimeout(() => {
                showUploadModal.value = false;
                isUploadClosing.value = false;
                uploadFile.value = null;
                clearUploadPreview();
                uploadCloseTimer = null;
            }, 150);
            await onUploadSuccess();
        } catch (err) {
            uploadError.value = err instanceof Error ? err.message : "上传失败";
        } finally {
            uploading.value = false;
        }
    }; // 实现

    onBeforeUnmount(() => {
        clearUploadPreview();
        if (uploadCloseTimer) {
            clearTimeout(uploadCloseTimer);
            uploadCloseTimer = null;
        }
    });

    return {
        showUploadModal,
        isUploadClosing,
        uploadForm,
        uploadPreview,
        uploadVideoUrl,
        uploading,
        uploadError,
        openUploadModal,
        closeUploadModal,
        onFileChange,
        doUpload,
    };
}
