import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { usePlaybackStore } from './store';
import { useUiStore } from '../../shared/stores/ui';

const demoSong = {
  path: '/music/demo.flac', name: 'demo.flac', title: 'Demo',
  artist: 'Artist', artist_names: ['Artist'], effective_artist_names: ['Artist'],
  album: 'Album', album_artist: 'Artist', album_key: 'Album::Artist',
  is_various_artists_album: false, collapse_artist_credits: false, duration: 120,
};

describe('usePlaybackStore', () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it('persists transport and queue fields as plain writable state', () => {
    const playback = usePlaybackStore();

    playback.isPlaying = true;
    playback.volume = 72;
    playback.currentSong = demoSong;
    playback.playQueue = [demoSong];

    expect(playback.isPlaying).toBe(true);
    expect(playback.volume).toBe(72);
    expect(playback.currentSong).toEqual(demoSong);
    expect(playback.playQueue).toEqual([demoSong]);
  });

  it('boots with idle transport state and an empty queue', () => {
    const playback = usePlaybackStore();

    expect(playback.isPlaying).toBe(false);
    expect(playback.playQueue).toEqual([]);
  });
});

describe('useUiStore', () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it('persists queue visibility, palette and mini-mode flags as plain writable state', () => {
    const ui = useUiStore();

    ui.showQueue = true;
    ui.dominantColors = ['#111111', '#222222', '#333333', '#444444'];
    ui.isMiniMode = true;

    expect(ui.showQueue).toBe(true);
    expect(ui.dominantColors).toEqual(['#111111', '#222222', '#333333', '#444444']);
    expect(ui.isMiniMode).toBe(true);
  });

  it('boots with the overlay panels closed', () => {
    const ui = useUiStore();

    expect(ui.showQueue).toBe(false);
    expect(ui.showPlayerDetail).toBe(false);
  });
});
