import { beforeEach, it, describe, expect, vi } from "vitest";
import type { ImportedLyricsFont } from "./types";

const invokeStub = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeStub }));

/** 伪造 document.head：记录被塞进来的样式节点。 */
function createHeadStub() {
    const appended: Array<{
        textContent: string;
        setAttribute: (name: string, value: string) => void;
    }> = [];
    return {
        appended,
        appendChild(node: {
            textContent: string;
            setAttribute: (name: string, value: string) => void;
        }) {
            appended.push(node);
        },
    };
}

describe("导入歌词字体的注册流程", () => {
    beforeEach(() => {
        vi.resetModules();
        invokeStub.mockReset();

        // FontFace 桩：构造即返回实例，load() 立刻兑现。
        vi.stubGlobal(
            "FontFace",
            vi.fn(function MockedFontFace(this: {
                load: () => Promise<unknown>;
            }) {
                this.load = vi.fn(() => Promise.resolve(this));
            }),
        );

        vi.stubGlobal("document", {
            head: createHeadStub(),
            fonts: {
                add: vi.fn(),
                delete: vi.fn(),
            },
            createElement: () => ({
                textContent: "",
                setAttribute: vi.fn(),
            }),
        });
    });

    it("以 data URL 走 FontFace API 完成导入字体加载", async () => {
        invokeStub.mockResolvedValue("data:font/ttf;base64,AAECAw==");
        const { importedLyricsFontsRevision, registerImportedLyricsFonts } =
            await import("./fontUtils");

        const importedFontRecord: ImportedLyricsFont = {
            id: "font-id",
            name: "Long Custom Font",
            family: "XianYu Imported Lyrics Font font-id",
            filePath:
                "C:\\Users\\lover\\AppData\\Roaming\\com.lover.xianyuplayer\\custom-lyrics-fonts\\font-id.ttf",
            importedAt: 1,
            format: "truetype",
        };
        await registerImportedLyricsFonts([importedFontRecord]);

        expect(invokeStub).toHaveBeenCalledWith("read_lyrics_font_data_url", {
            fontPath:
                "C:\\Users\\lover\\AppData\\Roaming\\com.lover.xianyuplayer\\custom-lyrics-fonts\\font-id.ttf",
        });
        expect(FontFace).toHaveBeenCalledWith(
            "XianYu Imported Lyrics Font font-id",
            'url("data:font/ttf;base64,AAECAw==")',
            { display: "swap" },
        );
        expect(document.fonts.add).toHaveBeenCalled();
        expect(importedLyricsFontsRevision.value).toBe(1);
    });
});
