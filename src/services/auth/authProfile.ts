import { getDeviceId } from '../domain/usageStats';
import { getAuthErrorMessage, mapUser } from './authShared';
import {
  getAuthToken,
  getStoredUser,
  saveAuth,
} from './authSession';
import { requestAction } from './authHttp';
import type {
  AuthUser,
  ProfileAuditStatus,
  ProfileChangeLimitStatus,
  ProfileStats,
} from './authTypes';

/**
 * 账号认证服务 · 资料管理。
 * 个人资料查询/更新、昵称改名审核、头像上传/审核状态。依赖
 * authSession（凭证）、authHttp（签名请求）、authShared（映射）。
 */

/**
 * 获取个人资料与统计。
 * 当前 XY Music API 文档未提供独立的资料接口，登录响应已含用户信息，
 * 此处返回 null（统计展示为占位符），后续可接入正式接口。
 */
export async function getProfile(): Promise<{
  user: AuthUser;
  stats: ProfileStats;
} | null> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) return null;

  try {
    const data = await requestAction<Record<string, unknown>>(
      'get_user_info',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const user = mapUser(data);
    // 更新内存缓存，保证后续读取一致
    saveAuth({ token, user });
    return {
      user,
      stats: {
        favorite_count: Number(data.favorite_count ?? 0),
        playlist_count: Number(data.playlist_count ?? 0),
      },
    };
  } catch (error) {
    console.warn('[getProfile] 获取用户信息失败:', error);
    return null;
  }
}

/**
 * 更新个人资料（昵称）。
 * 改名走审核流程，失败时透传服务端提示。
 */
export async function updateProfile(
  nickname: string,
  avatar?: string,
): Promise<{ user: AuthUser; nicknamePending?: boolean }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  try {
    const data = await requestAction<{ user?: AuthUser; avatar?: string; nickname_pending?: boolean; status?: string }>('update_profile', {
      token,
      ciyuanxi_id: current.ciyuanxi_id || '',
      username: nickname,
      nickname,
      avatar: avatar || '',
    });

    // 改名走审核流程：后端不会更新 username，前端也保持旧值
    // nickname_pending=true 表示改名申请已提交待审核
    const nicknamePending = data.nickname_pending === true || data.status === 'pending';
    const nextUser: AuthUser = data.user ?? {
      ...current,
      avatar: avatar ?? current.avatar,
    };
    // 不在本地更新 username/nickname（需审核通过后才更新）
    saveAuth({ token, user: nextUser });
    return { user: nextUser, nicknamePending };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '保存失败'), { cause: error });
  }
}

/**
 * 查询当前用户改名审核状态。
 * 返回 'pending'（审核中）/ 'rejected'（未通过）/ 'none'（无待处理）
 */
export async function getNicknameStatus(): Promise<'pending' | 'rejected' | 'none'> {
  const current = getStoredUser();
  if (!current) return 'none';

  try {
    const data = await requestAction<{ status: string }>(
      'get_nickname_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const status = data.status ?? 'none';
    if (status === 'pending' || status === 'rejected') return status;
    return 'none';
  } catch (error) {
    console.warn('[getNicknameStatus] 查询失败:', error);
    return 'none';
  }
}

export async function getNicknameChangeLimitStatus(): Promise<ProfileChangeLimitStatus> {
  const current = getStoredUser();
  if (!current) return { status: 'none', todayBlocked: false, blockMessage: '' };

  try {
    const data = await requestAction<{ status: string; today_blocked?: boolean; block_message?: string }>(
      'get_nickname_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const rawStatus = data.status ?? 'none';
    const status: ProfileAuditStatus = rawStatus === 'pending' || rawStatus === 'rejected' ? rawStatus : 'none';
    return {
      status,
      todayBlocked: data.today_blocked === true,
      blockMessage: String(data.block_message || ''),
    };
  } catch (error) {
    console.warn('[getNicknameChangeLimitStatus] 查询失败:', error);
    return { status: 'none', todayBlocked: false, blockMessage: '' };
  }
}

/**
 * 使用 Canvas 压缩图片为 base64 data URL。
 * Tauri HTTP 插件不支持 FormData 文件上传，因此改为 base64 JSON 方式。
 */
function compressImageToDataUrl(
  file: Blob,
  maxWidth = 256,
  quality = 0.75,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let canvas: HTMLCanvasElement | null = null;
        try {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 上下文不可用'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          img.onload = null;
          img.onerror = null;
          img.src = '';
        }
      };
      img.onerror = () => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        reject(new Error('图片加载失败'));
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 上传头像。使用 Canvas 压缩后以 base64 JSON 方式提交（兼容 Tauri HTTP 插件）。
 * POST /api/?action=upload_avatar
 *
 * 上传后进入审核流程（和壁纸一样），头像不会立即生效，
 * 需管理员审核通过后才更新到 app_users.avatar_url。
 * 因此本函数不再更新本地 authStore 中的 avatar。
 */
export async function uploadAvatar(
  file: Blob,
): Promise<{ status: 'pending' }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  // 前端压缩：256px 宽度，JPEG 质量 75%
  const avatarData = await compressImageToDataUrl(file, 256, 0.75);

  try {
    // 头像上传首次请求可能触发建表/ALTER TABLE，需要更长超时
    const TIMEOUT_MS = 60_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`请求超时（${TIMEOUT_MS / 1000}s），action=upload_avatar`));
      }, TIMEOUT_MS);
    });

    await Promise.race([
      requestAction<{ status?: string }>(
        'upload_avatar',
        {
          ciyuanxi_id: current.ciyuanxi_id ?? current.id,
          avatar_data: avatarData,
        },
        55_000, // fetch 超时 55s，留 5s 给外层
      ),
      timeoutPromise,
    ]);

    return { status: 'pending' };
  } catch (error) {
    console.error('[uploadAvatar] 上传失败:', error);
    throw new Error(getAuthErrorMessage(error, '头像上传失败'), { cause: error });
  }
}

/**
 * POST /api/?action=get_avatar_status
 *
 * 查询当前用户头像审核状态。
 * - 'pending'：审核中
 * - 'rejected'：审核未通过
 * - 'none'：无待处理记录（头像已生效或从未上传）
 */
export async function getAvatarStatus(): Promise<'pending' | 'rejected' | 'none'> {
  const current = getStoredUser();
  if (!current) return 'none';

  try {
    const data = await requestAction<{ status: string }>(
      'get_avatar_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const status = data.status ?? 'none';
    if (status === 'pending' || status === 'rejected') return status;
    return 'none';
  } catch (error) {
    console.warn('[getAvatarStatus] 查询失败:', error);
    return 'none';
  }
}

export async function getAvatarChangeLimitStatus(): Promise<ProfileChangeLimitStatus> {
  const current = getStoredUser();
  if (!current) return { status: 'none', todayBlocked: false, blockMessage: '' };

  try {
    const data = await requestAction<{ status: string; today_blocked?: boolean; block_message?: string }>(
      'get_avatar_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const rawStatus = data.status ?? 'none';
    const status: ProfileAuditStatus = rawStatus === 'pending' || rawStatus === 'rejected' ? rawStatus : 'none';
    return {
      status,
      todayBlocked: data.today_blocked === true,
      blockMessage: String(data.block_message || ''),
    };
  } catch (error) {
    console.warn('[getAvatarChangeLimitStatus] 查询失败:', error);
    return { status: 'none', todayBlocked: false, blockMessage: '' };
  }
}

/**
 * 检查当前用户账号/设备是否被封禁。
 * 调用服务器 check_ban_status 接口，传入 ciyuanxi_id 和 device_id。
 * 返回 { banned, type, reason }，若被封禁则同步清空本地凭证。
 */
export async function checkBanStatus(): Promise<{ banned: boolean; type: 'account' | 'device'; reason: string; ciyuanxiId: string; nickname: string }> {
  const current = getStoredUser();
  if (!current) return { banned: false, type: 'account', reason: '', ciyuanxiId: '', nickname: '' };
  try {
    const data = await requestAction<{ banned: boolean; type?: string; reason?: string }>(
      'check_ban_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
        device_id: getDeviceId(),
      },
      15_000,
    );
    return {
      banned: data.banned === true,
      type: (data.type as 'account' | 'device') || 'account',
      reason: data.reason || '',
      ciyuanxiId: current.ciyuanxi_id ?? current.id,
      nickname: current.nickname || '',
    };
  } catch {
    return { banned: false, type: 'account', reason: '', ciyuanxiId: '', nickname: '' };
  }
}