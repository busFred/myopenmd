import { create } from "zustand";
import type { FindSpec } from "../lib/findMatcher";

/** 查找/替换栏的会话状态(不落盘)。具体匹配与高亮由 MarkdownView 的后端完成。 */
interface FindState extends FindSpec {
  open: boolean;
  replaceOpen: boolean;
  replacement: string;
  preserveCase: boolean;
  /** 每次 Ctrl+F / Ctrl+H 自增:查找栏据此重新聚焦并用选中文字作为查询。 */
  focusTick: number;
  openFind: (withReplace: boolean) => void;
  close: () => void;
  setReplaceOpen: (v: boolean) => void;
  setQuery: (q: string) => void;
  setReplacement: (r: string) => void;
  toggle: (key: "caseSensitive" | "wholeWord" | "regexp" | "preserveCase") => void;
}

export const useFind = create<FindState>((set) => ({
  open: false,
  replaceOpen: false,
  query: "",
  replacement: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  preserveCase: false,
  focusTick: 0,
  openFind: (withReplace) =>
    set((s) => ({ open: true, replaceOpen: withReplace || (s.open && s.replaceOpen), focusTick: s.focusTick + 1 })),
  close: () => set({ open: false }),
  setReplaceOpen: (v) => set({ replaceOpen: v }),
  setQuery: (q) => set({ query: q }),
  setReplacement: (r) => set({ replacement: r }),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<FindState>),
}));
