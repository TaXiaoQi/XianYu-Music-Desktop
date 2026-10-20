export const isPluginSong = (
    song: { path?: string; source_type?: string } | null | undefined,
) =>
    song?.source_type === "plugin" ||
    song?.path?.startsWith("plugin://") === true;
