import { describe, expect, it } from "vitest";

import { isPointerNearVerticalScrollbar } from "./scrollbarActivity";

// 假想容器：左缘 100px、右缘 500px。
const containerRect = { left: 100, right: 500 } as DOMRect;

describe("scrollbarActivity", () => {
    it("指针落在右缘热区之内（含右边界）时判定命中", () => {
        expect(isPointerNearVerticalScrollbar(452, containerRect, 48)).toBe(
            true,
        );
        expect(isPointerNearVerticalScrollbar(500, containerRect, 48)).toBe(
            true,
        );
    });

    it("热区之外或容器之外的指针位置一律不命中", () => {
        expect(isPointerNearVerticalScrollbar(451, containerRect, 48)).toBe(
            false,
        );
        expect(isPointerNearVerticalScrollbar(520, containerRect, 48)).toBe(
            false,
        );
        expect(isPointerNearVerticalScrollbar(99, containerRect, 48)).toBe(
            false,
        );
    });
});
