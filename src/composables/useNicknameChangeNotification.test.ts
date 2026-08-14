import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signedRequestMock, getStoredAuthMock, saveAuthMock, setUserMock } = vi.hoisted(() => ({
  signedRequestMock: vi.fn(),
  getStoredAuthMock: vi.fn(),
  saveAuthMock: vi.fn(),
  setUserMock: vi.fn(),
}));

vi.mock('../services/auth/authService', () => ({
  signedRequest: signedRequestMock,
  getStoredAuth: getStoredAuthMock,
  saveAuth: saveAuthMock,
}));

vi.mock('../features/auth/store', () => ({
  useAuthStore: () => ({ setUser: setUserMock }),
}));

import { useNicknameChangeNotification, resetNicknameChangeNotificationState } from './useNicknameChangeNotification';

const baseUser = {
  id: '9',
  username: 'old',
  nickname: 'OldNick',
  email: 'a@b.c',
  ciyuanxi_id: '2784213157',
};

describe('useNicknameChangeNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNicknameChangeNotificationState();
  });

  it('拉取到未确认通知后展示公告弹窗', async () => {
    getStoredAuthMock.mockReturnValue({ token: 't', user: baseUser });
    signedRequestMock.mockResolvedValue({
      list: [{
        id: 1,
        ciyuanxi_id: '2784213157',
        old_nickname: 'OldNick',
        new_nickname: 'NewNick',
        reason: '违规昵称',
        changed_by: 'admin',
        created_at: '2026-08-14 20:00:00',
      }],
    });

    const { nicknameVisible, currentNicknameNotification, checkNicknameChangeNotification } =
      useNicknameChangeNotification();
    await checkNicknameChangeNotification();

    expect(signedRequestMock).toHaveBeenCalledWith(
      'get_nickname_change_notices',
      { ciyuanxi_id: '2784213157' },
      expect.any(Object),
    );
    expect(nicknameVisible.value).toBe(true);
    expect(currentNicknameNotification.value?.title).toBe('昵称已被修改');
    expect(currentNicknameNotification.value?.content).toContain('NewNick');
    expect(currentNicknameNotification.value?.content).toContain('违规昵称');
  });

  it('有公告在展示时跳过弹窗', async () => {
    getStoredAuthMock.mockReturnValue({ token: 't', user: baseUser });
    signedRequestMock.mockResolvedValue({
      list: [{ id: 1, new_nickname: 'NewNick' }],
    });

    const { nicknameVisible, checkNicknameChangeNotification } = useNicknameChangeNotification();
    await checkNicknameChangeNotification(true);

    expect(signedRequestMock).not.toHaveBeenCalled();
    expect(nicknameVisible.value).toBe(false);
  });

  it('关闭时确认通知并同步本地昵称', async () => {
    getStoredAuthMock.mockReturnValue({ token: 't', user: baseUser });
    signedRequestMock
      .mockResolvedValueOnce({
        list: [{
          id: 7,
          ciyuanxi_id: '2784213157',
          old_nickname: 'OldNick',
          new_nickname: 'NewNick',
          reason: '管理员修改',
          changed_by: 'admin',
          created_at: '',
        }],
      })
      .mockResolvedValueOnce({ id: 7 });

    const { checkNicknameChangeNotification, closeNicknameChangeNotification } =
      useNicknameChangeNotification();
    await checkNicknameChangeNotification();
    await closeNicknameChangeNotification();

    // 确认接口
    expect(signedRequestMock).toHaveBeenLastCalledWith(
      'confirm_nickname_change_notice',
      { id: 7, ciyuanxi_id: '2784213157' },
      expect.any(Object),
    );
    // 本地昵称同步 + 持久化
    expect(saveAuthMock).toHaveBeenCalledWith({
      token: 't',
      user: expect.objectContaining({ nickname: 'NewNick' }),
    });
    expect(setUserMock).toHaveBeenCalledWith(expect.objectContaining({ nickname: 'NewNick' }));
  });
});