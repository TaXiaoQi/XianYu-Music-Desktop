
import type { PluginSearchResult } from '../../types';
import type { LxSearchResultItem } from './lxMusicSdkBase';

export type RecommendStrategyType = 'artist_search' | 'song_search' | 'keyword_search';

export interface DailyRecommendStrategy {
  id: string;
  type: RecommendStrategyType;
  weight: number;
  queries: string[];
  reason: string;
}

export interface DailyRecommendAlgorithm {
  version: number;
  date: string;
  daily_seed: number;
  target_count: number;
  profile: {
    top_artists: Array<{ name: string; play_count: number }>;
    top_songs: Array<{ name: string; singer: string; play_count: number }>;
    total_plays: number;
    active_days: number;
  };
  strategies: DailyRecommendStrategy[];
  exclusions: {
    match_mode: string;
    songs: Array<{ title: string; artist: string }>;
  };
  shuffle: { algorithm: string; seed: number };
}

export interface DailyRecommendItem {
  song: PluginSearchResult;
  reason: string;
  strategyId: string;
  pluginName: string;
  /** lx 源原始条目：存在时播放走 lx:// 链路（与移动端 pluginFormat='lx' 对齐） */
  lxItem?: LxSearchResultItem;
}

export interface DailyRecommendResult {
  algorithm: DailyRecommendAlgorithm;
  items: DailyRecommendItem[];
  batch: number;
}

export class DailyRecommendError extends Error {
  readonly kind: 'not_logged_in' | 'network';
  constructor(kind: 'not_logged_in' | 'network', message: string) {
    super(message);
    this.kind = kind;
  }
}