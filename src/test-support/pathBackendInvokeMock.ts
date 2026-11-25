import { vi } from "vitest";

// 与后端 Core music::utils 一致的归一化语义：\ → /、去尾部连续 /、转小写。
// 供测试桩模拟 path_queries 的四个命令，验证前端转发调用的接线是否正确。
const normalize = (path: string) =>
    (path || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const withinRootScope = (candidate: string, root: string) => {
    const scopedRoot = normalize(root);
    const normalized = normalize(candidate);
    return (
        normalized === scopedRoot || normalized.startsWith(`${scopedRoot}/`)
    );
};

/** 返回一个模拟后端路径查询命令的 invoke 桩；未登记的命令直接报错暴露 */
export const createPathBackendInvoke = () =>
    vi.fn((command: string, args?: Record<string, unknown>): Promise<unknown> => {
        switch (command) {
            case "filter_paths_within_folder": {
                const { folderPath, paths } = (args ?? {}) as {
                    folderPath: string;
                    paths: string[];
                };
                return Promise.resolve(
                    (paths ?? []).filter((path) => withinRootScope(path, folderPath)),
                );
            }
            case "find_deepest_owning_root": {
                const { rootPaths, targetPath } = (args ?? {}) as {
                    rootPaths: string[];
                    targetPath: string;
                };
                let deepest: string | null = null;
                let deepestLength = -1;
                for (const root of rootPaths ?? []) {
                    if (!withinRootScope(targetPath, root)) continue;
                    const length = normalize(root).length;
                    if (length > deepestLength) {
                        deepest = root;
                        deepestLength = length;
                    }
                }
                return Promise.resolve(deepest);
            }
            case "path_within_root_scope": {
                const { candidate, root } = (args ?? {}) as {
                    candidate: string;
                    root: string;
                };
                return Promise.resolve(withinRootScope(candidate, root));
            }
            case "path_under_root_prefix": {
                const { candidate, root } = (args ?? {}) as {
                    candidate: string;
                    root: string;
                };
                return Promise.resolve(
                    normalize(candidate).startsWith(normalize(root)),
                );
            }
            default:
                return Promise.reject(
                    new Error(`[pathBackendInvoke] 未模拟的命令: ${command}`),
                );
        }
    });
