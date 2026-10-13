import { describe, expect, it } from "vitest";
import { buildFindRegex, findAllMatches, pickCurrent, replacementFor, type FindSpec } from "./findMatcher";

const spec = (query: string, o: Partial<FindSpec> = {}): FindSpec => ({
  query,
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  ...o,
});
const find = (text: string, s: FindSpec) => {
  const re = buildFindRegex(s);
  if (!(re instanceof RegExp)) return re;
  return findAllMatches(text, re).map((m) => text.slice(m.from, m.to));
};

describe("findMatcher", () => {
  it("escapes plain queries and ignores case by default", () => {
    expect(find("a.b A.B axb", spec("a.b"))).toEqual(["a.b", "A.B"]);
    expect(find("Render render", spec("render", { caseSensitive: true }))).toEqual(["render"]);
  });

  it("matches whole words, including CJK boundaries", () => {
    expect(find("render renderer rerender render.", spec("render", { wholeWord: true }))).toEqual(["render", "render"]);
    expect(find("文档 文档库", spec("文档", { wholeWord: true }))).toEqual(["文档"]);
  });

  it("supports regex and reports invalid patterns", () => {
    expect(find("v1 v22 v", spec("v\\d+", { regexp: true }))).toEqual(["v1", "v22"]);
    expect(buildFindRegex(spec("(", { regexp: true }))).toBe("invalid");
    expect(buildFindRegex(spec(""))).toBeNull();
  });

  it("skips empty regex matches", () => {
    expect(find("abc", spec("x*", { regexp: true }))).toEqual([]);
  });

  it("expands regex groups and preserves case in replacements", () => {
    expect(replacementFor("v12", "ver$1", spec("v(\\d+)", { regexp: true }), false)).toBe("ver12");
    expect(replacementFor("Render", "draw", spec("render"), true)).toBe("Draw");
    expect(replacementFor("RENDER", "draw", spec("render"), true)).toBe("DRAW");
    expect(replacementFor("render", "Draw", spec("render"), true)).toBe("draw");
    expect(replacementFor("Render", "draw", spec("render"), false)).toBe("draw");
  });

  it("picks the current match", () => {
    const ms = [{ from: 0, to: 1 }, { from: 10, to: 11 }, { from: 20, to: 21 }];
    expect(pickCurrent(ms, -1, false, 5)).toBe(1);
    expect(pickCurrent(ms, -1, false, 25)).toBe(0);
    expect(pickCurrent(ms, 5, true, 0)).toBe(2);
    expect(pickCurrent([], 0, true, 0)).toBe(-1);
  });
});
