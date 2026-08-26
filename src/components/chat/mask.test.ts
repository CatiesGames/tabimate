import { describe, expect, test } from "bun:test";

import { maskUnfinishedImage } from "./blocks";

describe("maskUnfinishedImage", () => {
  test("未閉合的圖片語法尾巴 → 佔位", () => {
    expect(maskUnfinishedImage("上圖:![ねぎし](gphoto:places/abc/photos/AVoNo")).toBe("上圖:(附圖…)");
    expect(maskUnfinishedImage("看這 ![ねぎ")).toBe("看這 (附圖…)");
    expect(maskUnfinishedImage("![")).toBe("(附圖…)");
  });
  test("已閉合或無圖片語法 → 原文", () => {
    expect(maskUnfinishedImage("![a](gphoto:x) 後文")).toBe("![a](gphoto:x) 後文");
    expect(maskUnfinishedImage("純文字")).toBe("純文字");
  });
  test("前面已閉合、結尾未閉合 → 只遮結尾", () => {
    expect(maskUnfinishedImage("![a](gphoto:x) next ![b](gph")).toBe("![a](gphoto:x) next (附圖…)");
  });
});
