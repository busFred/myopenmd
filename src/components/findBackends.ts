import { EditorView } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";
import {
  buildFindRegex,
  findAllMatches,
  pickCurrent,
  replacementFor,
  type FindSpec,
  type TextMatch,
} from "../lib/findMatcher";
import { setFindMatches } from "./CodeEditor";

export interface FindResult {
  count: number;
  /** 当前匹配序号(0 起),无匹配为 -1。 */
  current: number;
  invalid: boolean;
  /** 每个匹配在整篇中的纵向位置(0–1),用于右缘标尺。 */
  ticks: number[];
}

export interface FindRunOptions {
  /** 内容变化后重算:尽量保持当前序号。 */
  keepIndex: boolean;
  /** 把当前匹配滚动到可见区域。 */
  reveal: boolean;
}

/** 查找栏与具体视图之间的接口:代码视图(CodeMirror)与预览视图(DOM)各一份实现。 */
export interface FindBackend {
  canReplace: boolean;
  run(spec: FindSpec, opts: FindRunOptions): FindResult;
  step(dir: 1 | -1): FindResult;
  replaceOne(spec: FindSpec, replacement: string, preserveCase: boolean): FindResult;
  /** 返回替换个数。 */
  replaceAll(spec: FindSpec, replacement: string, preserveCase: boolean): number;
  clear(): void;
  selectionText(): string;
  focus(): void;
}

const EMPTY: FindResult = { count: 0, current: -1, invalid: false, ticks: [] };

// ---------------------------------------------------------------------------
// 代码视图:在 CodeMirror 文档上匹配,装饰高亮;替换走编辑事务(进入撤销栈,全部替换一步撤销)。
// ---------------------------------------------------------------------------
export function createCodeFindBackend(view: EditorView, canReplace: boolean): FindBackend {
  let matches: TextMatch[] = [];
  let current = -1;
  let invalid = false;

  const result = (): FindResult => {
    const h = Math.max(1, view.contentHeight);
    return { count: matches.length, current, invalid, ticks: matches.map((m) => view.lineBlockAt(m.from).top / h) };
  };
  const apply = (reveal: boolean, select: boolean) => {
    const m = matches[current];
    const effects: StateEffect<unknown>[] = [setFindMatches.of({ matches, current })];
    if (reveal && m) effects.push(EditorView.scrollIntoView(m.from, { y: "nearest", yMargin: 120 }));
    view.dispatch({ effects, selection: select && m ? { anchor: m.from, head: m.to } : undefined });
  };
  const search = (spec: FindSpec, keepIndex: boolean, anchor: number) => {
    const re = buildFindRegex(spec);
    invalid = re === "invalid";
    matches = re instanceof RegExp ? findAllMatches(view.state.doc.toString(), re) : [];
    current = pickCurrent(matches, current, keepIndex, anchor);
  };

  return {
    canReplace,
    run(spec, { keepIndex, reveal }) {
      search(spec, keepIndex, view.state.selection.main.from);
      apply(reveal, false);
      return result();
    },
    step(dir) {
      if (matches.length === 0) return result();
      current = (current + dir + matches.length) % matches.length;
      apply(true, true);
      return result();
    },
    replaceOne(spec, replacement, preserveCase) {
      const m = matches[current];
      if (!canReplace || !m) return result();
      const insert = replacementFor(view.state.doc.sliceString(m.from, m.to), replacement, spec, preserveCase);
      view.dispatch({
        changes: { from: m.from, to: m.to, insert },
        selection: { anchor: m.from + insert.length },
        userEvent: "input.replace",
      });
      // 跳到被替换位置之后的下一个匹配(VS Code 行为)
      search(spec, false, m.from + insert.length);
      apply(true, true);
      return result();
    },
    replaceAll(spec, replacement, preserveCase) {
      if (!canReplace || matches.length === 0) return 0;
      const n = matches.length;
      const doc = view.state.doc;
      view.dispatch({
        changes: matches.map((m) => ({
          from: m.from,
          to: m.to,
          insert: replacementFor(doc.sliceString(m.from, m.to), replacement, spec, preserveCase),
        })),
        userEvent: "input.replace.all",
      });
      search(spec, false, 0);
      apply(false, false);
      return n;
    },
    clear() {
      matches = [];
      current = -1;
      view.dispatch({ effects: setFindMatches.of({ matches: [], current: -1 }) });
    },
    selectionText() {
      const sel = view.state.selection.main;
      return view.state.doc.sliceString(sel.from, sel.to);
    },
    focus() {
      view.focus();
    },
  };
}

// ---------------------------------------------------------------------------
// 预览视图:在渲染后的文字上匹配,用 CSS Custom Highlight API 高亮(不改动 DOM,
// 不会触发预览编辑的 MutationObserver)。编辑模式下替换走 execCommand("insertText"),
// 与手动打字同一路径映射回源码,并进入浏览器撤销栈。
// ---------------------------------------------------------------------------
const BLOCK_SEL = "p,li,h1,h2,h3,h4,h5,h6,td,th,pre,dt,dd,figcaption,blockquote,summary,div,article";
/** 渲染产物(图表、公式)不是可查找的正文。 */
const SKIP_SEL = "script,style,svg,.code-copy-btn,.md-mermaid,.md-rich,.katex-mathml";
const HL_ALL = "openmd-find";
const HL_CURRENT = "openmd-find-current";

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

function buildIndex(root: HTMLElement): TextIndex {
  const nodes: TextIndex["nodes"] = [];
  let text = "";
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP_SEL) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (!node.data) continue;
    const block = node.parentElement?.closest(BLOCK_SEL) ?? null;
    // 不同块之间插入换行,避免跨段落拼出假匹配
    if (lastBlock && block !== lastBlock) text += "\n";
    lastBlock = block;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

/** 索引偏移 → (文本节点, 节点内偏移)。end 为 true 时取区间右端所在节点。 */
function locate(index: TextIndex, offset: number, end: boolean): [Text, number] | null {
  const { nodes } = index;
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const s = nodes[mid].start;
    if (s < offset || (!end && s === offset)) lo = mid;
    else hi = mid - 1;
  }
  const entry = nodes[lo];
  if (!entry) return null;
  return [entry.node, Math.min(offset - entry.start, entry.node.data.length)];
}

export function createPreviewFindBackend(
  article: HTMLElement,
  scroller: HTMLElement,
  canReplace: boolean,
): FindBackend {
  let ranges: Range[] = [];
  let current = -1;
  let invalid = false;
  const hasHighlightApi = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
  // HighlightRegistry 是 maplike,但 TS 的 DOM 类型没带上 set/delete
  const registry = hasHighlightApi ? (CSS.highlights as unknown as Map<string, Highlight>) : null;

  const ticks = () => {
    const s = scroller.getBoundingClientRect();
    const h = Math.max(1, scroller.scrollHeight);
    return ranges.map((r) => (r.getBoundingClientRect().top - s.top + scroller.scrollTop) / h);
  };
  const result = (): FindResult => ({ count: ranges.length, current, invalid, ticks: ticks() });
  const paint = () => {
    if (!registry) return;
    registry.set(HL_ALL, new Highlight(...ranges.filter((_, i) => i !== current)));
    if (ranges[current]) registry.set(HL_CURRENT, new Highlight(ranges[current]));
    else registry.delete(HL_CURRENT);
  };
  const reveal = () => {
    const r = ranges[current];
    if (!r) return;
    const rect = r.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (rect.top < s.top + 60 || rect.bottom > s.bottom - 30) {
      scroller.scrollBy({ top: rect.top - s.top - s.height / 3 });
    }
    if (!hasHighlightApi) {
      // 不支持 Highlight API 的 WebView:至少用选区标出当前匹配
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r.cloneRange());
    }
  };
  const search = (spec: FindSpec, keepIndex: boolean) => {
    const re = buildFindRegex(spec);
    invalid = re === "invalid";
    const prev = current;
    ranges = [];
    current = -1;
    if (!(re instanceof RegExp)) return;
    const index = buildIndex(article);
    for (const m of findAllMatches(index.text, re)) {
      const a = locate(index, m.from, false);
      const b = locate(index, m.to, true);
      if (!a || !b) continue;
      const r = document.createRange();
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
      ranges.push(r);
    }
    if (ranges.length === 0) return;
    if (keepIndex && prev >= 0) {
      current = Math.min(prev, ranges.length - 1);
      return;
    }
    // 从视口顶部开始找第一个匹配
    const top = scroller.getBoundingClientRect().top;
    const i = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
    current = i === -1 ? 0 : i;
  };
  /** 选中 range 后以原生输入替换,结束后把焦点还给查找栏。 */
  const replaceRange = (r: Range, insert: string) => {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
    if (insert) document.execCommand("insertText", false, insert);
    else document.execCommand("delete");
  };
  const withArticleFocus = (fn: () => void) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    article.focus({ preventScroll: true });
    fn();
    prevFocus?.focus({ preventScroll: true });
  };

  return {
    canReplace,
    run(spec, opts) {
      search(spec, opts.keepIndex);
      paint();
      if (opts.reveal) reveal();
      return result();
    },
    step(dir) {
      if (ranges.length === 0) return result();
      current = (current + dir + ranges.length) % ranges.length;
      paint();
      reveal();
      return result();
    },
    replaceOne(spec, replacement, preserveCase) {
      const r = ranges[current];
      if (!canReplace || !r) return result();
      const insert = replacementFor(r.toString(), replacement, spec, preserveCase);
      withArticleFocus(() => replaceRange(r, insert));
      search(spec, true);
      paint();
      reveal();
      return result();
    },
    replaceAll(spec, replacement, preserveCase) {
      if (!canReplace || ranges.length === 0) return 0;
      const n = ranges.length;
      // Range 是活对象,倒序替换时前面的匹配位置不受影响
      const work = ranges.map((r) => [r, replacementFor(r.toString(), replacement, spec, preserveCase)] as const);
      withArticleFocus(() => {
        for (let i = work.length - 1; i >= 0; i--) replaceRange(work[i][0], work[i][1]);
      });
      search(spec, false);
      paint();
      return n;
    },
    clear() {
      ranges = [];
      current = -1;
      registry?.delete(HL_ALL);
      registry?.delete(HL_CURRENT);
    },
    selectionText() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !article.contains(sel.anchorNode)) return "";
      return sel.toString();
    },
    focus() {
      if (canReplace) article.focus({ preventScroll: true });
    },
  };
}

export { EMPTY as EMPTY_FIND_RESULT };
