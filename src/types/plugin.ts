export interface PluginInfo { // 实现
    id: string;
    name: string;
    version: string;
    author?: string;
    platform?: string;
    description?: string;
    enabled: boolean;
    updateAvailable?: boolean;
    iconUrl?: string;
}

export type PluginSearchType = "track" | "artist" | "album" | "playlist";

export interface PluginTrack { // 实现
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

export interface PluginArtist { // 实现
    id: string;
    name: string;
    avatarUrl?: string;
    description?: string;
    songCount?: number;
    albumCount?: number;
}

export interface PluginAlbum { // 实现
    id: string;
    name: string;
    artist: string;
    coverUrl?: string;
    description?: string;
    year?: string;
    songCount?: number;
}

export interface PluginPlaylist { // 实现
    id: string;
    name: string;
    creator?: string;
    coverUrl?: string;
    description?: string;
    songCount?: number;
    playCount?: number;
}

export interface PluginSearchResponse { // 实现
    tracks: PluginTrack[];
    artists: PluginArtist[];
    albums: PluginAlbum[];
    playlists: PluginPlaylist[];
}

export interface PluginSearchRequest { // 实现
    pluginId: string;
    query: string;
    type?: PluginSearchType;
    page?: number;
    pageSize?: number;
}
