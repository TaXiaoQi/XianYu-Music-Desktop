import { describe, expect, it } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import { useScopedBatchSelection } from "./useScopedBatchSelection";

const INITIAL_SCOPE = "home::folder::/music/live";
const SWITCHED_SCOPE = "home::all";

type SelectionController = ReturnType<typeof useScopedBatchSelection>;

/** 在独立 effectScope 内挂载批量选择状态，返回控制器与作用域 */
const mountSelection = (initialScope: string) => {
    const scopeKey = ref(initialScope);
    const scope = effectScope();
    const selection = scope.run(() =>
        useScopedBatchSelection(scopeKey),
    ) as SelectionController;
    return { scopeKey, scope, selection };
};

/** 打开批量模式 */
const enterBatchMode = (controller: SelectionController) => {
    controller.isBatchMode.value = true;
};

describe("useScopedBatchSelection 批量选择", () => {
    it("clears marked paths once batch mode is switched off", async () => {
        const { scope, selection } = mountSelection(INITIAL_SCOPE);

        enterBatchMode(selection);
        const seededPaths = new Set(["a.flac", "b.flac"]);
        selection.selectedPaths.value = seededPaths;
        selection.isBatchMode.value = false;

        await nextTick();

        expect(selection.selectedPaths.value.size).toBe(0);

        scope.stop();
    });

    it("leaves batch mode and wipes marked paths when the scope switches", async () => {
        const { scope, scopeKey, selection } = mountSelection(INITIAL_SCOPE);

        enterBatchMode(selection);
        selection.selectedPaths.value = new Set(["folder-song.flac"]);

        scopeKey.value = SWITCHED_SCOPE;
        await nextTick();

        expect(selection.isBatchMode.value).toBe(false);
        expect(selection.selectedPaths.value.size).toBe(0);

        scope.stop();
    });
});
