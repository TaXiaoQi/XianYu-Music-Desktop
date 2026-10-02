import type { Song } from "../types";

type AsyncImportTask = () => Promise<unknown>;
type FolderSongLookup = (folderPath: string) => Song[];

interface FileImportHandlers {
    addFolder: AsyncImportTask;
    addFoldersFromStructure: AsyncImportTask;
    getSongsInFolder: FolderSongLookup;
    clearLocalMusic: VoidFunction;
}

export function useFileImport(handlers: FileImportHandlers) {
    const wiredActions = {
        addFolder: handlers.addFolder,
        addFoldersFromStructure: handlers.addFoldersFromStructure,
        getSongsInFolder: handlers.getSongsInFolder,
        clearLocalMusic: handlers.clearLocalMusic,
    };

    return wiredActions;
}
