<script setup lang="ts"> // 实现
import {
    computed,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    shallowRef,
} from "vue";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Plus } from "lucide-vue-next";
import { useToast as useToastNotifications } from "../../composables/toast";
import { remoteLibraryApi as remoteLibraryService } from "../../services/tauri/remoteLibraryApi";
import type {
    RemoteCacheUsage as CacheUsageSnapshot,
    RemoteFileEntry,
} from "../../types";
import type { RemoteSource, RemoteSyncProgress } from "../../types";
import { useLibraryRuntimeActions as useRuntimeLibraryActions } from "../../features/library/useLibraryRuntimeActions";
import { default as RemovalDialog } from "../overlays/ConfirmModal.vue";
import RemoteBrowserPanel from "./remoteLibrary/RemoteBrowserPanel.vue";
import RemoteCacheUsage from "./remoteLibrary/RemoteCacheUsage.vue";
import RemoteSectionHeader from "./remoteLibrary/RemoteSectionHeader.vue";
import RemoteSourceForm from "./remoteLibrary/RemoteSourceForm.vue";
import RemoteSourceList from "./remoteLibrary/RemoteSourceList.vue";

const { showToast: notify } = useToastNotifications();
const { loadLibrarySongsFromCache: refreshSongsFromCache } =
    useRuntimeLibraryActions();

const sourceList = ref<RemoteSource[]>([]);
const fetchingSources = ref(false);
const persisting = ref(false);
const probing = ref(false);
const syncingId = shallowRef<string | null>(null);
const removalCandidate = shallowRef<RemoteSource | null>(null);
const syncStatus = shallowRef<RemoteSyncProgress | null>(null);
const cacheMeter = shallowRef<CacheUsageSnapshot | null>(null);
const wipingCache = ref(false);
const explorerTargetId = shallowRef<string | null>(null);
const explorerLocation = ref("/");
const explorerEntries = shallowRef<RemoteFileEntry[]>([]);
const explorerBusy = ref(false);
const drafting = ref(false);

const blankDraft = () => ({
    id: "",
    name: "",
    baseUrl: "",
    username: "",
    password: "",
    rootPath: "/",
});

const draft = reactive(blankDraft());

const wipeDraft = () => {
    Object.assign(draft, blankDraft());
};

const percentComplete = computed(() => {
    const status = syncStatus.value;
    if (!status || status.total <= 0) {
        return 0;
    }
    return Math.min(
        100,
        Math.max(0, Math.round((status.current / status.total) * 100)),
    );
});

const progressCaption = computed(() => {
    const status = syncStatus.value;
    if (!status) {
        return "";
    }
    return status.total > 0
        ? `${status.message} ${status.current}/${status.total}`
        : status.message;
});

const parentPathOf = (location: string): string => {
    const trimmed = location.replace(/\/+$/, "");
    const boundary = trimmed.lastIndexOf("/");
    return boundary <= 0 ? "/" : trimmed.slice(0, boundary);
};

const composeSourceInput = () => {
    const identifier = draft.id.trim();
    const handle = draft.username.trim();
    const base = draft.rootPath.trim();
    return {
        id: identifier.length > 0 ? identifier : undefined,
        name: draft.name.trim(),
        provider: "webdav" as const,
        baseUrl: draft.baseUrl.trim(),
        username: handle.length > 0 ? handle : null,
        password: draft.password.length > 0 ? draft.password : null,
        rootPath: base.length > 0 ? base : "/",
    };
};

const refreshSources = async () => {
    fetchingSources.value = true;
    const catalog = await remoteLibraryService
        .getRemoteSources()
        .catch((failure: unknown) => {
            console.error("[remote-library] failed to list sources", failure);
            notify("加载远程音乐库失败", "error");
            return null;
        });
    if (catalog !== null) {
        sourceList.value = catalog;
    }
    fetchingSources.value = false;
};

const readCacheMeter = async () => {
    cacheMeter.value = await remoteLibraryService.getRemoteCacheUsage();
};

const wipeRemoteCache = async () => {
    wipingCache.value = true;
    const snapshot = await remoteLibraryService
        .clearRemoteCache()
        .catch((failure: unknown) => {
            console.error("[remote-library] failed to clear cache", failure);
            notify("清理远程缓存失败", "error");
            return null;
        });
    if (snapshot !== null) {
        cacheMeter.value = snapshot;
        notify("远程缓存已清理", "success");
    }
    wipingCache.value = false;
};

const openExplorerAt = async (source: RemoteSource, target?: string) => {
    const destination = target || source.rootPath || "/";
    explorerTargetId.value = source.id;
    explorerLocation.value = destination;
    explorerBusy.value = true;
    const found = await remoteLibraryService
        .listRemoteDirectory(source.id, destination)
        .catch((failure: unknown) => {
            console.error("[remote-library] failed to list directory", failure);
            notify("读取远程目录失败", "error");
            return [] as RemoteFileEntry[];
        });
    explorerEntries.value = found;
    explorerBusy.value = false;
};

const ascendExplorer = async () => {
    const source = sourceList.value.find(
        (item) => item.id === explorerTargetId.value,
    );
    if (!source) {
        return;
    }
    await openExplorerAt(source, parentPathOf(explorerLocation.value));
};

const descendExplorer = async (entry: RemoteFileEntry) => {
    if (!entry.isDir) {
        return;
    }
    const source = sourceList.value.find(
        (item) => item.id === explorerTargetId.value,
    );
    if (source) {
        await openExplorerAt(source, entry.remotePath);
    }
};

const probeConnection = async () => {
    probing.value = true;
    const verdict = await remoteLibraryService
        .testRemoteSource(composeSourceInput())
        .catch((failure: unknown) => {
            console.error("[remote-library] connection test failed", failure);
            notify("连接测试失败", "error");
            return null;
        });
    if (verdict !== null) {
        notify(verdict.message, verdict.ok ? "success" : "error");
    }
    probing.value = false;
};

const submitDraft = async () => {
    if (draft.name.trim().length === 0 || draft.baseUrl.trim().length === 0) {
        notify("名称和服务器地址不能为空", "error");
        return;
    }

    persisting.value = true;
    const payload = composeSourceInput();
    const saved = await (
        draft.id.length > 0
            ? remoteLibraryService.updateRemoteSource(payload)
            : remoteLibraryService.addRemoteSource(payload)
    ).catch((failure: unknown) => {
        console.error("[remote-library] failed to save source", failure);
        notify("保存远程音乐库失败", "error");
        return null;
    });
    if (saved !== null) {
        wipeDraft();
        await refreshSources();
        notify("远程音乐库已保存", "success");
        drafting.value = false;
    }
    persisting.value = false;
};

const openDraft = () => {
    wipeDraft();
    drafting.value = true;
};

const closeDraft = () => {
    wipeDraft();
    drafting.value = false;
};

const startEditing = (source: RemoteSource) => {
    Object.assign(draft, {
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        username: source.username ?? "",
        password: "",
        rootPath: source.rootPath || "/",
    });
    drafting.value = true;
};

const startSync = async (source: RemoteSource) => {
    syncingId.value = source.id;
    syncStatus.value = {
        sourceId: source.id,
        phase: "scanning",
        current: 0,
        total: 0,
        message: "正在读取远程目录",
        done: false,
        failed: false,
    };
    const outcome = await remoteLibraryService
        .syncRemoteSource(source.id)
        .catch(async (failure: unknown) => {
            console.error("[remote-library] failed to sync source", failure);
            await refreshSources();
            notify("同步远程音乐库失败", "error");
            return null;
        });
    if (outcome !== null) {
        await refreshSongsFromCache();
        await refreshSources();
        notify(`已同步 ${outcome.audioFiles} 首远程歌曲`, "success");
    }
    syncingId.value = null;
};

const markForRemoval = (source: RemoteSource) => {
    removalCandidate.value = source;
};

const destroyCandidate = async () => {
    const candidate = removalCandidate.value;
    if (!candidate) {
        return;
    }
    const removed = await remoteLibraryService
        .removeRemoteSource(candidate.id)
        .catch((failure: unknown) => {
            console.error("[remote-library] failed to remove source", failure);
            notify("删除远程音乐库失败", "error");
            return null;
        });
    if (removed !== null) {
        removalCandidate.value = null;
        await refreshSources();
        notify("远程音乐库已删除", "success");
    }
};

let detachSyncListener: UnlistenFn | null = null;

const bootstrapPanel = async () => {
    await Promise.all([refreshSources(), readCacheMeter()]);
    detachSyncListener = await listen<RemoteSyncProgress>(
        "remote-sync-progress",
        (envelope) => {
            syncStatus.value = envelope.payload;
            if (envelope.payload.done) {
                syncingId.value = null;
            }
        },
    );
};

onMounted(() => {
    void bootstrapPanel();
});

onBeforeUnmount(() => {
    detachSyncListener?.();
    detachSyncListener = null;
});
</script>

<template>
    <div class="mt-8 flex w-full flex-col gap-8">
        <RemoteSourceForm
            v-if="drafting"
            v-model:base-url="draft.baseUrl"
            v-model:name="draft.name"
            v-model:password="draft.password"
            v-model:root-path="draft.rootPath"
            v-model:username="draft.username"
            :editing="draft.id.length > 0"
            :persisting="persisting"
            :probing="probing"
            @cancel="closeDraft"
            @probe="probeConnection"
            @submit="submitDraft"
        />

        <template v-else>
            <section class="flex flex-col gap-3">
                <RemoteSectionHeader>添加远程音乐库</RemoteSectionHeader>
                <button
                    type="button"
                    class="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-transparent py-5 text-sm font-bold transition-all duration-200 border-gray-300 text-gray-500 hover:border-[#EC4141] hover:bg-[#EC4141]/5 hover:text-[#EC4141] dark:border-gray-600/50 dark:text-gray-400"
                    @click="openDraft"
                >
                    <Plus :size="18" :stroke-width="2.5" aria-hidden="true" />
                    添加 WebDAV 音乐库
                </button>
            </section>

            <section class="flex flex-col gap-3">
                <RemoteSectionHeader>已添加</RemoteSectionHeader>
                <RemoteSourceList
                    :loading="fetchingSources"
                    :percent="percentComplete"
                    :progress="syncStatus"
                    :progress-caption="progressCaption"
                    :sources="sourceList"
                    :syncing-id="syncingId"
                    @browse="openExplorerAt"
                    @edit="startEditing"
                    @remove="markForRemoval"
                    @sync="startSync"
                />
            </section>

            <section class="flex flex-col gap-3">
                <RemoteSectionHeader>远程缓存</RemoteSectionHeader>
                <RemoteCacheUsage
                    :busy="wipingCache"
                    :usage="cacheMeter"
                    @clear="wipeRemoteCache"
                />
            </section>

            <section v-if="explorerTargetId" class="flex flex-col gap-3">
                <RemoteSectionHeader>远程目录</RemoteSectionHeader>
                <RemoteBrowserPanel
                    :busy="explorerBusy"
                    :items="explorerEntries"
                    :location="explorerLocation"
                    @ascend="ascendExplorer"
                    @enter="descendExplorer"
                />
            </section>
        </template>

        <RemovalDialog
            :content="`确定要删除“${removalCandidate?.name ?? ''}”吗？远程歌曲索引会从音乐库中移除。`"
            :visible="!!removalCandidate"
            title="删除远程音乐库"
            @cancel="removalCandidate = null"
            @confirm="destroyCandidate"
        />
    </div>
</template>
