// 壁纸中心共享模型：类型、常量与纯函数工具（列表/操作/上传组合函数与卡片子组件共用）。
export interface Wallpaper { // 实现
    id: number;
    title: string;
    description: string;
    imageUrl: string;
    thumbnailUrl: string;
    videoUrl?: string;
    videoSha256?: string;
    mediaType?: string;
    category: string;
    uploaderId?: string;
    uploaderNickname?: string;
} // 实现
export interface MyWallpaper extends Wallpaper { // 实现
    status: "normal" | "disabled" | "pending" | "rejected" | string;
    reviewedAt?: string | null;
    reviewedBy?: string;
    createdAt?: string;
} // 实现
export interface DownloadedWallpaper extends Wallpaper {
    localPath: string;
    downloadedAt: string;
}

export type MediaType = "image" | "video";
export const resolveMediaType = (v?: string): MediaType =>
    v === "video" ? "video" : "image";
export type WallpaperTab = "browse" | "mine" | "downloads";
export const DOWNLOADED_WALLPAPERS_KEY = "xianyu_downloaded_wallpapers_v1";

export const uploaderLabel = (wallpaper: Wallpaper) => {
    const nick = (wallpaper.uploaderNickname || "").trim();
    const id = (wallpaper.uploaderId || "").trim();
    if (nick && id) return `${nick}（${id}）`;
    if (nick) return nick;
    if (id) return `@${id}`;
    return "管理员";
};

export const isVideo = (wallpaper: Wallpaper): boolean =>
    resolveMediaType(
        wallpaper.mediaType || (wallpaper.videoUrl ? "video" : "image"),
    ) === "video";

export const statusMeta = (status: string): { text: string; cls: string } => { // 实现
    switch (status) {
        case "normal":
            return { text: "已通过", cls: "bg-green-500/20 text-green-300" };
        case "pending":
            return { text: "待审核", cls: "bg-amber-500/20 text-amber-300" };
        case "rejected":
            return { text: "未通过", cls: "bg-red-500/20 text-red-300" };
        case "disabled":
            return { text: "已禁用", cls: "bg-gray-500/20 text-gray-300" };
        default:
            return { text: status, cls: "bg-white/10 text-white/60" };
    }
}; // 实现
