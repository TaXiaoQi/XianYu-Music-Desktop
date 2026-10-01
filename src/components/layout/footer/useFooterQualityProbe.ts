import { ref } from 'vue';

import { isDownloadableOnlineSong } from '../../../services/domain/downloadService';
import {
  ensureSharedQualityProbe,
  ensureProbeRequestedUrls,
  onSharedProbeUpdate,
  sharedProbeAvailable,
  getSongKey,
} from '../../../services/domain/qualitySharedProbe';
import { probeSizesForKeys } from '../../../services/domain/qualitySizeMeta';
import { getOnlineAvailableQualities } from '../../../features/playback/onlinePlaybackResolver';
import type { QualityKey, Song } from '../../../types';

interface QualityProbeDeps {
  getCurrentSong: () => Song | null;
  getCurrentPlayingQuality: () => QualityKey | null | undefined;
}

/**
 * 底栏音质探测：可用档位、直链、体积与探测中状态。
 * 探测结果由共享探测订阅驱动，切歌时由调用方按原顺序重置。
 */
export const useFooterQualityProbe = ({
  getCurrentSong,
  getCurrentPlayingQuality,
}: QualityProbeDeps) => {
  const footerAvailableQualityKeys = ref<QualityKey[] | null>(null);
  const footerQualityUrls = ref<Partial<Record<QualityKey, string>>>({});
  const footerQualitySizes = ref<Partial<Record<QualityKey, number>>>({});
  const isFooterQualityInfoProbing = ref(false);
  const footerQualityInfoSongPath = ref('');
  let footerSharedProbeOff: (() => void) | null = null;
  const footerQualitySizesProbed = new Set<QualityKey>();

  const releaseFooterSharedProbe = () => {
    footerSharedProbeOff?.();
    footerSharedProbeOff = null;
  };

  const abortFooterQualityInfoProbe = () => {
    releaseFooterSharedProbe();
    isFooterQualityInfoProbing.value = false;
  };

  /** 取消订阅并清空当前歌曲的音质探测结果。 */
  const resetQualityInfo = () => {
    abortFooterQualityInfoProbe();
    footerQualityInfoSongPath.value = '';
    footerAvailableQualityKeys.value = null;
    footerQualityUrls.value = {};
    footerQualitySizes.value = {};
    footerQualitySizesProbed.clear();
  };

  const probeFooterQualitySizes = async (
    song: Song,
    keys: QualityKey[],
    urlFor: (q: QualityKey) => string | undefined,
  ) => {
    const targets = keys.filter(k => !footerQualitySizesProbed.has(k));
    targets.forEach(k => footerQualitySizesProbed.add(k));
    // 只有真正拿到体积的档位才算探测完成，失败的等直链到位后重试
    const sized = await probeSizesForKeys(song, targets, urlFor, (q, bytes) => {
      footerQualitySizes.value = { ...footerQualitySizes.value, [q]: bytes };
    });
    targets.forEach(k => {
      if (!sized.has(k)) footerQualitySizesProbed.delete(k);
    });
  };

  const ensureFooterQualityInfo = async () => {
    const song = getCurrentSong();
    const songPath = song?.cue_source_path || song?.path || '';
    if (!song || !isDownloadableOnlineSong(song) || !songPath) return;
    const songKey = getSongKey(song);
    if (
      footerQualityInfoSongPath.value === songKey
      && (isFooterQualityInfoProbing.value || footerAvailableQualityKeys.value !== null)
    ) {
      return;
    }

    releaseFooterSharedProbe();
    footerQualityInfoSongPath.value = songKey;
    footerAvailableQualityKeys.value = null;
    footerQualityUrls.value = {};
    footerQualitySizes.value = {};
    footerQualitySizesProbed.clear();
    isFooterQualityInfoProbing.value = true;

    const isCurrent = () => {
      const current = getCurrentSong();
      return current ? getSongKey(current) === songKey : false;
    };

    let declaredQualities: QualityKey[] | null = null;
    try {
      declaredQualities = await getOnlineAvailableQualities(songPath, song);
    } catch {
      declaredQualities = null;
    }
    if (!isCurrent()) return;

    const probe = await ensureSharedQualityProbe(song, declaredQualities, { full: true });
    if (!probe || !isCurrent()) {
      if (isCurrent()) isFooterQualityInfoProbing.value = false;
      return;
    }

    const apply = () => {
      const shown = sharedProbeAvailable(probe);
      footerAvailableQualityKeys.value = shown;
      footerQualityUrls.value = { ...probe.resolvedUrls };
      const urlFor = (q: QualityKey) => probe.requestedUrls?.[q] ?? probe.resolvedUrls[q];
      void probeFooterQualitySizes(song, shown, urlFor);
      if (probe.done) {
        isFooterQualityInfoProbing.value = false;
        // 主探测已收尾：等补解析与体积探测补齐后再释放订阅，
        // 避免晚到的直链（主探测失败档位的补解析）没机会补体积
        void (async () => {
          try {
            await ensureProbeRequestedUrls(probe, song, sharedProbeAvailable(probe));
            const lateUrlFor = (q: QualityKey) => probe.requestedUrls?.[q] ?? probe.resolvedUrls[q];
            await probeFooterQualitySizes(song, sharedProbeAvailable(probe), lateUrlFor);
            // 收尾后仍无体积的档位视为假音质，从菜单剔除（保留当前播放档）
            const keep = getCurrentPlayingQuality();
            footerAvailableQualityKeys.value = sharedProbeAvailable(probe).filter(k =>
              k === keep
              || (typeof footerQualitySizes.value[k] === 'number' && footerQualitySizes.value[k]! > 0),
            );
          } finally {
            releaseFooterSharedProbe();
          }
        })();
      } else {
        void ensureProbeRequestedUrls(probe, song, shown);
      }
    };

    footerSharedProbeOff = onSharedProbeUpdate(probe, apply);
    if (isCurrent()) apply();
  };

  return {
    footerAvailableQualityKeys,
    footerQualityUrls,
    footerQualitySizes,
    isFooterQualityInfoProbing,
    abortFooterQualityInfoProbe,
    resetQualityInfo,
    ensureFooterQualityInfo,
  };
};
