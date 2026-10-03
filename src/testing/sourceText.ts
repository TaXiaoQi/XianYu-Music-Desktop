import { expect } from "vitest";

/**
 * 源码文本断言（「源码钉」测试）的共享规范形。
 *
 * 根因史：2f20de2（prettier 全库重排：单引号→双引号、折行）与 5fced71（行级「// 实现」尾注）
 * 曾两次打坏一批逐字 toContain 的源码钉测试。本规范形让断言与排版解耦：
 *   1. 去行级「//」尾注与整行注释（保护 URL 的「://」）；
 *   2. 去全部空白；
 *   3. 引号无关（' 与 " 归一）。
 * 断言双方（源码与片段）都过同一规范形，emit 名、调用链等语义仍逐字冻结，
 * 只是排版（折行 / 引号风格 / 尾注）不再影响匹配。
 */
export const condense = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("")
    .replace(/\s+/g, "")
    .replace(/["']/g, '"');

/** 片段是否出现在源码中（规范形下）。 */
export const sourceContains = (source: string, snippet: string): boolean =>
  condense(source).includes(condense(snippet));

/** 断言源码包含片段（规范形下）。 */
export const expectSourceContains = (source: string, snippet: string): void => {
  expect(condense(source)).toContain(condense(snippet));
};

/** 断言源码不包含片段（规范形下）。 */
export const expectSourceNotContains = (source: string, snippet: string): void => {
  expect(condense(source)).not.toContain(condense(snippet));
};

/** 片段在源码（规范形）中的下标；-1 表示不存在。用于顺序 / 存在性断言。 */
export const sourceIndexOf = (source: string, snippet: string): number =>
  condense(source).indexOf(condense(snippet));

/** 片段在源码（规范形）中的出现次数。 */
export const sourceCountOf = (source: string, snippet: string): number =>
  condense(source).split(condense(snippet)).length - 1;
