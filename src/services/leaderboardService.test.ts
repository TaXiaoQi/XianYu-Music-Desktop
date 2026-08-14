import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signedRequestMock, getCiyuanxiIdMock } = vi.hoisted(() => ({
  signedRequestMock: vi.fn(),
  getCiyuanxiIdMock: vi.fn(),
}));

vi.mock('./auth/authService', () => ({ signedRequest: signedRequestMock }));
vi.mock('./playlistSync', () => ({ getCiyuanxiId: getCiyuanxiIdMock }));

import { fetchLeaderboard } from './leaderboardService';

describe('fetchLeaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedRequestMock.mockResolvedValue({
      leaderboard: [{
        rank: 1,
        username: 'listener',
        nickname: 'Listener',
        avatar: '',
        duration: 3600,
        is_me: false,
      }],
      me: null,
      total_users: 1,
    });
  });

  it('loads the public ranking without a logged-in user', async () => {
    getCiyuanxiIdMock.mockReturnValue(null);

    const result = await fetchLeaderboard(50, { daily: 100, weekly: 300, total: 600 });

    expect(signedRequestMock).toHaveBeenCalledTimes(1);
    expect(signedRequestMock).toHaveBeenCalledWith(
      'get_leaderboard',
      { limit: 50, period: 'total' },
      expect.any(Object),
    );
    expect(result.leaderboard).toHaveLength(1);
    expect(result.me).toBeNull();
  });
});
