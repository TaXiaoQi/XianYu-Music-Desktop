import { describe, expect, it } from 'vitest';

import consumerSource from './FooterControlItem.vue?raw';
import source from './PlayerFooter.vue?raw';

/**
 * 底栏通过 provide('footerContext') 与 FooterControlItem 隐式耦合。
 * 拆分成 composable 后没有挂载测试可用，这里用源码扫描把契约钉住：
 * 提供方的键集合必须与冻结基线一致，且覆盖消费方声明的全部键。
 */

function sliceBetween(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `未找到起始标记: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(end, `未找到结束标记: ${endMarker}`).toBeGreaterThan(start);
  return text.slice(start + startMarker.length, end);
}

/** 取出对象字面量/类型字面量里的顶层键名。 */
function collectKeys(block: string): string[] {
  const keys: string[] = [];
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_$][\w$]*)\s*[:,]?\s*$/);
    if (match) {
      keys.push(match[1]);
      continue;
    }
    const withValue = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (withValue) keys.push(withValue[1]);
  }
  return keys;
}

const providedKeys = collectKeys(sliceBetween(source, "provide('footerContext', {", '\n});'));
const consumedKeys = collectKeys(sliceBetween(consumerSource, 'inject<{', "}>('footerContext')"));

const EXPECTED_PROVIDED_KEYS = [
  'DOWNLOAD_QUALITY_OPTIONS',
  'QUALITY_OPTIONS',
  'activeDownloadQualityKey',
  'activeQualityKey',
  'audioLockTooltip',
  'currentSong',
  'downloadButtonTitle',
  'downloadQualityButtonRef',
  'downloadQualityMenuRef',
  'downloadedRecord',
  'effectLockTooltip',
  'footerQualityExtraText',
  'handleDownloadClick',
  'handleVolumeEnter',
  'handleVolumeLeave',
  'handleVolumeWheel',
  'isAudioControlLocked',
  'isDownloading',
  'isDraggingVolume',
  'isEffectLocked',
  'isFavorite',
  'isFooterQualityInfoProbing',
  'isMvVideoDownloading',
  'isOnlineSong',
  'isPinned',
  'isPluginSong',
  'isProgressHidden',
  'isQualitySelectableSong',
  'isVisualizerEnabled',
  'mvActive',
  'mvBufferedSec',
  'mvLoading',
  'mvPhase',
  'mvSupport',
  'openDlnaCastDialog',
  'openShareDialog',
  'playMode',
  'qualityButtonLabel',
  'qualityButtonRef',
  'qualityMenuRef',
  'selectQuality',
  'selectedDownloadQuality',
  'showComment',
  'showDesktopLyrics',
  'showDownloadQualityMenu',
  'showEqPanel',
  'showLyricsPlayerSettingsPanel',
  'showPlayerDetail',
  'showPlaylist',
  'showQualityMenu',
  'showVolumeSlider',
  'startDownload',
  'startDrag',
  'toggleComment',
  'toggleEqPanel',
  'toggleFavorite',
  'toggleLyrics',
  'toggleLyricsPlayerSettings',
  'toggleMode',
  'toggleMute',
  'toggleMv',
  'togglePin',
  'togglePlaylist',
  'toggleProgressVisibility',
  'toggleQualityMenu',
  'toggleVisualizer',
  'volume',
  'volumeBarRef',
];

describe('底栏 footerContext 契约', () => {
  it('提供的键集合与冻结基线一致', () => {
    expect([...providedKeys].sort()).toEqual(EXPECTED_PROVIDED_KEYS);
  });

  it('覆盖 FooterControlItem 注入类型声明的全部键', () => {
    const missing = consumedKeys.filter(key => !providedKeys.includes(key));
    expect(missing).toEqual([]);
  });

  it('消费方声明的键都来自提供方（无拼写漂移）', () => {
    const extra = consumedKeys.filter(key => !EXPECTED_PROVIDED_KEYS.includes(key));
    expect(extra).toEqual([]);
  });
});
