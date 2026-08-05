import { playerStorage } from '../../services/storage/playerStorage';
import type { Song } from '../../types';

export const PLAYER_PLAYLIST_PATHS_KEY = 'player_playlist_paths';
export const PLAYER_QUEUE_PATHS_KEY = 'player_queue_paths';
export const PLAYER_LAST_SONG_PATH_KEY = 'player_last_song_path';
export const LEGACY_PLAYER_PLAYLIST_KEY = 'player_playlist';
export const LEGACY_PLAYER_QUEUE_KEY = 'player_queue';
export const LEGACY_PLAYER_HISTORY_KEY = 'player_history';
export const LEGACY_PLAYER_LAST_SONG_KEY = 'player_last_song';

export const readStoredStringArray = (key: string): string[] | null => playerStorage.readStringArray(key);
export const readStoredSongArray = (key: string): Song[] => playerStorage.readSongArray(key);
export const readStoredSong = (key: string): Song | null => playerStorage.readSong(key);
