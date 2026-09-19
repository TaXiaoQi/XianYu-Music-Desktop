import type { Song } from '../../types';


export interface ImportedPlaylist {
  name: string;
  songs: Song[];
}

export type BackupFormat = 'bakamusic' | 'musicfree' | 'unknown';