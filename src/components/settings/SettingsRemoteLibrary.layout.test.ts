import { describe, expect, it } from "vitest";
import * as nodeFs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";

// The remote-library form markup (and its scoped layout rules) now lives in
// remoteLibrary/RemoteSourceForm.vue, so the assertions below read that file.
const specDirectory = dirname(fileURLToPath(import.meta.url));

const readComponent = (relativePath: string): string =>
    nodeFs.readFileSync(join(specDirectory, relativePath), "utf8");

const extractStyleScoped = (componentSource: string): string =>
    componentSource.match(/<style scoped>([\s\S]*)<\/style>/)?.[1] ?? "";

const extractRuleBody = (styles: string, selector: string): string =>
    styles.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";

const formComponentSource = readComponent(
    "./remoteLibrary/RemoteSourceForm.vue",
);
const formStyles = extractStyleScoped(formComponentSource);
const gridRuleBody = extractRuleBody(formStyles, "\\.rl-grid(?![-\\w])");
const inputRuleBody = extractRuleBody(formStyles, "\\.rl-input(?![-\\w])");
const darkInputRuleBody = extractRuleBody(
    formStyles,
    "html\\.dark \\.rl-input(?![-\\w])",
);

describe("SettingsRemoteLibrary layout", () => {
    it("keeps the remote source fields in a single column", () => {
        expectSourceContains(
            gridRuleBody,
            "grid-template-columns: minmax(0, 1fr);",
        );
        expectSourceNotContains(gridRuleBody, "repeat(2");
        expectSourceNotContains(
            formComponentSource,
            "remote-field remote-field--wide",
        );
    });

    it("does not render the remote source form as a card container", () => {
        expect(formStyles).not.toMatch(
            /\.remote-form,\s*\.remote-source-list,/,
        );
        expect(formStyles).not.toMatch(/:global\(\.dark\) \.remote-form,/);
        expect(formStyles).not.toMatch(
            /\.remote-form\s*\{[\s\S]*(?:background|border-radius|padding)/,
        );
    });

    it("uses translucent input surfaces instead of solid white fields", () => {
        expectSourceContains(
            inputRuleBody,
            "background: rgba(255, 255, 255, 0.45);",
        );
        expectSourceContains(
            inputRuleBody,
            "border: 1px solid rgba(15, 23, 42, 0.1);",
        );
        expectSourceNotContains(
            inputRuleBody,
            "background: rgba(255, 255, 255, 0.72);",
        );
        expectSourceContains(
            darkInputRuleBody,
            "background: rgba(255, 255, 255, 0.05);",
        );
    });
});
