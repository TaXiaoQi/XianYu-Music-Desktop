import { ref, type ComputedRef } from "vue";
import { signedRequest } from "../../services/auth/authService";
import type { AuthUser } from "../../services/auth/authTypes";
import type { MyWallpaper, Wallpaper } from "./wallpaperTypes";

interface UseWallpaperListOptions {
    /** 是否已登录（与主组件共享同一份登录态） */
    isLoggedIn: ComputedRef<boolean>;
    /** 当前登录用户 */
    currentUser: ComputedRef<AuthUser | undefined>;
}

/**
 * 壁纸中心列表加载：广场壁纸与我的上传两组列表的拉取与错误兜底。
 */
export function useWallpaperList({
    isLoggedIn,
    currentUser,
}: UseWallpaperListOptions) {
    const wallpapers = ref<Wallpaper[]>([]); // 实现
    const isLoading = ref(true); // 实现
    const loadError = ref("");
    const myWallpapers = ref<MyWallpaper[]>([]); // 实现
    const myLoading = ref(false); // 实现
    const myError = ref("");
    const fetchWallpapers = async () => { // 实现
        isLoading.value = true;
        loadError.value = "";
        try {
            const data = await signedRequest<Record<string, unknown>[]>(
                "list_wallpapers",
                { platform: "desktop" },
            );
            wallpapers.value = Array.isArray(data)
                ? data.map((w: Record<string, unknown>) => ({
                      id: Number(w.id || 0),
                      title: String(w.title || ""),
                      description: String(w.description || ""),
                      imageUrl: String(w.imageUrl ?? w.image_url ?? w.image ?? ""),
                      thumbnailUrl: String(
                          w.thumbnailUrl ??
                              w.thumbnail_url ??
                              w.imageUrl ??
                              w.image_url ??
                              w.image ??
                              "",
                      ),
                      videoUrl: String(w.videoUrl ?? w.video_url ?? ""),
                      videoSha256: String(w.videoSha256 ?? w.video_sha256 ?? ""),
                      mediaType: String(w.mediaType ?? w.media_type ?? ""),
                      category: String(w.category || ""),
                      uploaderId: String(
                          w.uploaderId ??
                              w.uploader_id ??
                              w.ciyuanxi_id ??
                              w.uploader ??
                              "",
                      ),
                      uploaderNickname: String(
                          w.uploaderNickname ??
                              w.uploaded_by_nickname ??
                              w.nickname ??
                              "",
                      ),
                  }))
                : [];
        } catch (err) {
            loadError.value =
                err instanceof Error ? err.message : "获取壁纸列表失败";
        } finally {
            isLoading.value = false;
        }
    }; // 实现
    const fetchMyWallpapers = async () => { // 实现
        if (!isLoggedIn.value || !currentUser.value?.ciyuanxi_id) return;
        myLoading.value = true;
        myError.value = "";
        try {
            const data = await signedRequest<Record<string, unknown>[]>(
                "my_wallpapers",
                {
                    ciyuanxi_id: currentUser.value.ciyuanxi_id,
                    platform: "desktop",
                },
            );
            myWallpapers.value = Array.isArray(data)
                ? (data.map((w: Record<string, unknown>) => ({
                      id: Number(w.id || 0),
                      title: String(w.title || ""),
                      description: String(w.description || ""),
                      imageUrl: String(w.imageUrl ?? w.image_url ?? w.image ?? ""),
                      thumbnailUrl: String(
                          w.thumbnailUrl ??
                              w.thumbnail_url ??
                              w.imageUrl ??
                              w.image_url ??
                              w.image ??
                              "",
                      ),
                      videoUrl: String(w.videoUrl ?? w.video_url ?? ""),
                      videoSha256: String(w.videoSha256 ?? w.video_sha256 ?? ""),
                      mediaType: String(w.mediaType ?? w.media_type ?? ""),
                      category: String(w.category || ""),
                      status: String(w.status || "pending"),
                      reviewedAt: w.reviewedAt ?? w.reviewed_at ?? null,
                      reviewedBy:
                          (w.reviewedBy ?? w.reviewed_by)
                              ? String(w.reviewedBy ?? w.reviewed_by)
                              : undefined,
                      createdAt:
                          (w.createdAt ?? w.created_at)
                              ? String(w.createdAt ?? w.created_at)
                              : undefined,
                      uploaderId: String(
                          w.uploaderId ?? w.uploader_id ?? w.ciyuanxi_id ?? "",
                      ),
                      uploaderNickname: String(
                          w.uploaderNickname ??
                              w.uploaded_by_nickname ??
                              w.nickname ??
                              "",
                      ),
                  })) as MyWallpaper[])
                : [];
        } catch (err) {
            myError.value = err instanceof Error ? err.message : "获取我的上传失败";
        } finally {
            myLoading.value = false;
        }
    }; // 实现

    return {
        wallpapers,
        isLoading,
        loadError,
        fetchWallpapers,
        myWallpapers,
        myLoading,
        myError,
        fetchMyWallpapers,
    };
}
