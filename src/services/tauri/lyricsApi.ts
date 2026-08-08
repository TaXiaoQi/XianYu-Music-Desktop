import { tauriInvoke } from './invoke';
import type { LyricsStorageSource, TauriCommandMap } from './contracts';

type SongInfoEditPayload = TauriCommandMap['save_song_info']['payload']['payload'];
type LyricSongInfoContract = TauriCommandMap['fetch_lyric_from_source']['payload']['songInfo'];

export const lyricsApi = {
  getSongLyricsForEdit: (path: string) =>
    tauriInvoke('get_song_lyrics_for_edit', { path }),
  saveSongLyrics: (
    path: string,
    lyrics: string,
    source: LyricsStorageSource,
    sourcePath: string | null,
  ) => tauriInvoke('save_song_lyrics', { path, lyrics, source, sourcePath }),
  readLyricsFile: (path: string) =>
    tauriInvoke('read_lyrics_file', { path }),
  fetchLyricFromSource: (source: string, songInfo: LyricSongInfoContract) =>
    tauriInvoke('fetch_lyric_from_source', { source, songInfo }),
  saveSongInfo: (path: string, payload: SongInfoEditPayload) =>
    tauriInvoke('save_song_info', { path, payload }),
  parseLyricsText: (text: string) =>
    tauriInvoke('parse_lyrics_text', { text }),
  getSongLyricsPayload: (path: string) =>
    tauriInvoke('get_song_lyrics_payload', { path }),
  readLyricsFontDataUrl: (fontPath: string) =>
    tauriInvoke('read_lyrics_font_data_url', { fontPath }),
  importLyricsFont: (sourcePath: string) =>
    tauriInvoke('import_lyrics_font', { sourcePath }),
  getSystemFonts: () => tauriInvoke('get_system_fonts'),
};
