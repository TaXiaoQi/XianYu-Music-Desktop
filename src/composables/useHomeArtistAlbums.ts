import { computed, watch, type Ref } from "vue";

import type { Song } from "../types";
import {
    groupSongsIntoAlbumEntries,
    makeAlbumEntryComparator,
    type AlbumCatalogEntry,
    type AlbumSortMode,
} from "./artistAlbumCatalog";

/** 歌手页专辑区的输入上下文 */
interface ArtistAlbumsPageContext {
    /** 本地视图过滤条件（优先于全局条件） */
    localFilterCondition: Ref<string>;
    /** 全局过滤条件 */
    filterCondition: Ref<string>;
    /** 曲库全量歌曲 */
    librarySongs: Ref<Song[]>;
    /** 专辑排序模式 */
    albumSortMode: Ref<AlbumSortMode>;
    /** 专辑自定义排序键序列 */
    albumCustomOrder: Ref<string[]>;
    /** 封面预载回调 */
    preloadCovers: (paths: string[]) => void;
}

/** 歌手页专辑列表：聚合当前歌手的专辑并按所选模式排序 */
export function useHomeArtistAlbums(page: ArtistAlbumsPageContext) {
    /** 当前生效的歌手名：本地条件优先，其次全局条件 */
    const resolveActiveArtist = () =>
        page.localFilterCondition.value || page.filterCondition.value;

    const artistAlbumList = computed<AlbumCatalogEntry[]>(() => {
        const activeArtist = resolveActiveArtist();
        if (!activeArtist) {
            return [];
        }

        return groupSongsIntoAlbumEntries(
            page.librarySongs.value,
            activeArtist,
        ).sort(
            makeAlbumEntryComparator(
                page.albumSortMode.value,
                page.albumCustomOrder.value,
            ),
        );
    });

    // 条目一旦就绪，立即预载各专辑首曲的封面
    watch(
        artistAlbumList,
        (entries) => {
            const coverSeedPaths = entries
                .map((entry) => entry.firstSongPath)
                .filter((path) => path.length > 0);
            page.preloadCovers(coverSeedPaths);
        },
        { immediate: true },
    );

    return {
        artistAlbumList,
    };
}
