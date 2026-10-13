import { create } from "zustand";

/** 代码视图光标状态,供状态栏显示「行 / 列」。 */
interface EditorStatusState {
  line: number;
  col: number;
  selected: number;
  eol: "LF" | "CRLF";
  set: (s: Partial<Omit<EditorStatusState, "set">>) => void;
}

export const useEditorStatus = create<EditorStatusState>((set) => ({
  line: 1,
  col: 1,
  selected: 0,
  eol: "LF",
  set: (s) => set(s),
}));
