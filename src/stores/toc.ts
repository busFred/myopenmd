import { create } from "zustand";

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

interface TocState {
  entries: TocEntry[];
  activeId: string | null;
  setEntries: (entries: TocEntry[]) => void;
  setActive: (id: string | null) => void;
}

export const useToc = create<TocState>((set) => ({
  entries: [],
  activeId: null,
  setEntries: (entries) => set({ entries }),
  setActive: (id) => set({ activeId: id }),
}));

/** Extract h1–h6 with anchor ids from the rendered container. */
export function extractToc(container: HTMLElement): TocEntry[] {
  const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const entries: TocEntry[] = [];

  headings.forEach((el) => {
    const id = el.id;
    if (!id) return;
    const level = parseInt(el.tagName[1], 10);
    const text = el.textContent?.trim() ?? "";
    if (text) {
      entries.push({ id, text, level });
    }
  });

  return entries;
}

let observerPaused = false;

/** 代码视图注册的跳转器:编辑器只渲染可见行,标题元素不一定在 DOM 里。 */
let tocNavigator: ((id: string) => boolean) | null = null;
export function setTocNavigator(fn: ((id: string) => boolean) | null): void {
  tocNavigator = fn;
}

/** 目录点击跳转:优先交给注册的跳转器,否则滚动到同 id 元素。 */
export function navigateToHeading(id: string): void {
  setActiveHeading(id);
  if (tocNavigator?.(id)) return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Navigate via TOC click: pause the observer so the smooth scroll doesn't
 *  fight it, then resume once the scroll has settled. */
export function setActiveHeading(id: string): void {
  observerPaused = true;
  useToc.getState().setActive(id);
  setTimeout(() => {
    observerPaused = false;
  }, 800);
}

export function isObserverPaused(): boolean {
  return observerPaused;
}
