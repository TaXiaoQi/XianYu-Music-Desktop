
export interface PluginTrack {
    id: string;
    title: string;
    artist: string;
    artists?: string[];
    album?: string;
    duration?: number;
    coverUrl?: string;
    streamUrl?: string;
    lyricsUrl?: string;
    year?: string;
    quality?: string;
}
