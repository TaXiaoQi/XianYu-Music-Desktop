import { storeToRefs } from "pinia";

import { useCollectionsStore } from "../features/collections/store";
import { useLibraryStore } from "../features/library/store";
import { useNavigationStore } from "../shared/stores/navigation";
import { useUiStore } from "../shared/stores/ui";

type FolderSortChoice =
    | "title"
    | "name"
    | "artist"
    | "track_number"
    | "added_at"
    | "added_at_asc"
    | "custom";
type LocalSortChoice =
    | "title"
    | "artist"
    | "added_at"
    | "added_at_asc"
    | "file_modified_at"
    | "file_modified_at_asc"
    | "custom";
type AlbumDetailSortChoice =
    | "track_number"
    | "track_number_desc"
    | "title"
    | "artist"
    | "added_at"
    | "added_at_asc"
    | "file_modified_at"
    | "file_modified_at_asc";
type PlaylistSortChoice =
    "title" | "name" | "artist" | "added_at" | "added_at_asc" | "custom";

export function usePlayerViewState() {
    const navigation = useNavigationStore();
    const { setSearch } = navigation;
    const { folderSortMode, localSortMode, albumDetailSortMode } =
        storeToRefs(useLibraryStore());
    const { playlistSortMode } = storeToRefs(useCollectionsStore());
    const { isMiniMode } = storeToRefs(useUiStore());

    const applyFolderSort = (mode: FolderSortChoice) => {
        folderSortMode.value = mode;
    };
    const applyLocalSort = (mode: LocalSortChoice) => {
        localSortMode.value = mode;
    };
    const applyAlbumDetailSort = (mode: AlbumDetailSortChoice) => {
        albumDetailSortMode.value = mode;
    };
    const applyPlaylistSort = (mode: PlaylistSortChoice) => {
        playlistSortMode.value = mode;
    };

    return {
        ...storeToRefs(navigation),
        isMiniMode,
        folderSortMode,
        localSortMode,
        albumDetailSortMode,
        playlistSortMode,
        setSearch,
        setFolderSortMode: applyFolderSort,
        setLocalSortMode: applyLocalSort,
        setAlbumDetailSortMode: applyAlbumDetailSort,
        setPlaylistSortMode: applyPlaylistSort,
    };
}
