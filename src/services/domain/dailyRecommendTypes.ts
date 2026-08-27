/**
 * 每日推荐 · 类型与错误（叶子）。
 */

import type { PluginSearchResult } from '../../types';

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
  /** 推荐理由（来自命中的策略） */
  reason: string;
  strategyId: string;
  pluginName: string;
}

export interface DailyRecommendResult {
  algorithm: DailyRecommendAlgorithm;
  items: DailyRecommendItem[];
  batch: number;
}

/** 获取每日推荐失败（未登录 / 网络异常等） */
export class DailyRecommendError extends Error {
  readonly kind: 'not_logged_in' | 'network';
  constructor(kind: 'not_logged_in' | 'network', message: string) {
    super(message);
    this.kind = kind;
  }
}