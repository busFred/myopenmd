import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { styleTags, tags as t } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { showMinimap } from "@replit/codemirror-minimap";
import { useEditorStatus } from "../stores/editorStatus";

/** 外部写入(磁盘重载等)的事务:不回调 onChange、不进撤销栈。 */
const External = Annotation.define<boolean>();

const MONO = `"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, "SF Mono", Menlo, "Droid Sans Mono", "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", monospace`;

// ---------------------------------------------------------------------------
// 查找高亮:匹配集合由 MarkdownView 的查找后端算出后经 effect 写入。
// ---------------------------------------------------------------------------
export interface FindDecoState {
  matches: { from: number; to: number }[];
  current: number;
}
export const setFindMatches = StateEffect.define<FindDecoState>();
const findMatchMark = Decoration.mark({ class: "cm-find-match" });
const findCurrentMark = Decoration.mark({ class: "cm-find-match cm-find-current" });
const findField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFindMatches)) {
        const { matches, current } = e.value;
        deco = Decoration.set(
          matches.map((m, i) => (i === current ? findCurrentMark : findMatchMark).range(m.from, m.to)),
        );
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Markdown 语法:YAML frontmatter 整块着色;列表/任务标记、围栏代码文本单独打标签。
// ---------------------------------------------------------------------------
const frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true, style: t.meta },
    { name: "FrontmatterMark", style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        const marks = [cx.elt("FrontmatterMark", 0, line.text.length)];
        let end = line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            marks.push(cx.elt("FrontmatterMark", cx.lineStart, end));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("Frontmatter", 0, end, marks));
        return true;
      },
    },
  ],
};
const markTags: MarkdownConfig = {
  props: [styleTags({ ListMark: t.atom, TaskMarker: t.atom, CodeText: t.content, QuoteMark: t.quote })],
};

interface Palette {
  /** 编辑器外观 */
  ui: {
    fg: string; gutter: string; gutterActive: string; active: string; activeBorder: string; sel: string;
    selBlur: string; caret: string; bracket: string; bracketBorder: string; find: string; findCur: string;
    findCurFg: string; fold: string; minimapBorder: string; minimapOverlay: string; guide: string; guideActive: string;
  };
  /** 语法高亮 */
  syn: {
    h: string; mark: string; strong: string; link: string; url: string; code: string; codeBg: string; bullet: string;
    quote: string; lang: string; meta: string; kw: string; ctl: string; str: string; num: string; com: string;
    fn: string; type: string; prop: string; tag: string; attr: string; vari: string;
  };
}

type ThemeVariant = "light" | "dark";
const variantOf = (dark: boolean): ThemeVariant => (dark ? "dark" : "light");

// GitHub 亮/暗配色,与 md.css 预览里的代码块一致。
const PALETTES: Record<ThemeVariant, Palette> = {
  dark: {
    ui: {
      fg: "#d4d4d8", gutter: "#52525b", gutterActive: "#e4e4e7", active: "rgba(255,255,255,0.04)",
      activeBorder: "rgba(255,255,255,0.05)", sel: "#264f78", selBlur: "rgba(38,79,120,0.6)", caret: "#e4e4e7",
      bracket: "rgba(88,166,255,0.14)", bracketBorder: "#71717a", find: "rgba(187,128,9,0.42)", findCur: "#f97316",
      findCurFg: "#111", fold: "#27272a", minimapBorder: "#1c1c1f", minimapOverlay: "rgba(255,255,255,0.12)",
      guide: "#27272a", guideActive: "#52525b",
    },
    syn: {
      h: "#58a6ff", mark: "#6e7681", strong: "#f0f6fc", link: "#79c0ff", url: "#8b949e", code: "#a5d6ff",
      codeBg: "rgba(110,118,129,0.22)", bullet: "#f2cc60", quote: "#7ee787", lang: "#d2a8ff", meta: "#8b949e",
      kw: "#ff7b72", ctl: "#ff7b72", str: "#a5d6ff", num: "#79c0ff", com: "#8b949e", fn: "#d2a8ff", type: "#ffa657",
      prop: "#79c0ff", tag: "#7ee787", attr: "#79c0ff", vari: "#d4d4d8",
    },
  },
  light: {
    ui: {
      fg: "#1f2328", gutter: "#a1a1aa", gutterActive: "#18181b", active: "rgba(0,0,0,0.035)",
      activeBorder: "rgba(0,0,0,0.04)", sel: "#add6ff", selBlur: "#d9e8f8", caret: "#09090b",
      bracket: "rgba(9,105,218,0.10)", bracketBorder: "#a1a1aa", find: "rgba(250,204,21,0.38)", findCur: "#f97316",
      findCurFg: "#fff", fold: "#e4e4e7", minimapBorder: "#f0f0f2", minimapOverlay: "rgba(0,0,0,0.10)",
      guide: "#e4e4e7", guideActive: "#a1a1aa",
    },
    syn: {
      h: "#0550ae", mark: "#8c959f", strong: "#1f2328", link: "#0969da", url: "#57606a", code: "#0a3069",
      codeBg: "rgba(175,184,193,0.18)", bullet: "#953800", quote: "#116329", lang: "#8250df", meta: "#57606a",
      kw: "#cf222e", ctl: "#cf222e", str: "#0a3069", num: "#0550ae", com: "#6e7781", fn: "#8250df", type: "#953800",
      prop: "#0550ae", tag: "#116329", attr: "#0550ae", vari: "#1f2328",
    },
  },
};

function highlightStyle(variant: ThemeVariant): HighlightStyle {
  const c = PALETTES[variant].syn;
  return HighlightStyle.define([
    { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: c.h, fontWeight: "700" },
    { tag: t.processingInstruction, color: c.mark },
    { tag: t.strong, color: c.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: c.link },
    { tag: t.url, color: c.url, textDecoration: "underline", textUnderlineOffset: "2px" },
    { tag: t.monospace, color: c.code, backgroundColor: c.codeBg, borderRadius: "3px" },
    { tag: t.atom, color: c.bullet, fontWeight: "600" },
    { tag: t.quote, color: c.quote, fontStyle: "italic" },
    { tag: t.labelName, color: c.lang },
    { tag: t.contentSeparator, color: c.mark },
    { tag: t.meta, color: c.meta },
    // 围栏代码块内部(各语言)与 HTML
    { tag: [t.keyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: c.kw },
    { tag: t.controlKeyword, color: c.ctl },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], color: c.str },
    { tag: [t.number, t.bool, t.null], color: c.num },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.com, fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: c.fn },
    { tag: [t.typeName, t.className, t.namespace], color: c.type },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: c.prop },
    { tag: [t.variableName, t.definition(t.variableName)], color: c.vari },
    { tag: [t.tagName, t.angleBracket], color: c.tag },
    { tag: t.attributeName, color: c.attr },
    { tag: t.attributeValue, color: c.str },
    { tag: t.invalid, color: "#f85149" },
  ]);
}

function editorTheme(variant: ThemeVariant, fontSize: number): Extension {
  const c = PALETTES[variant].ui;
  const dark = variant === "dark";
  return EditorView.theme(
    {
      "&": { height: "100%", fontSize: `${fontSize}px`, color: c.fg, backgroundColor: "transparent" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: MONO, lineHeight: "1.6", overflow: "auto" },
      // 末行之后留出半屏空白(VS Code 的 scrollBeyondLastLine)
      ".cm-content": { padding: "10px 0 45vh", caretColor: c.caret },
      ".cm-line": { padding: "0 24px 0 4px" },
      ".cm-gutters": { backgroundColor: "transparent", border: "none", color: c.gutter, userSelect: "none" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 20px", minWidth: "4ch", fontVariantNumeric: "tabular-nums" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: c.gutterActive },
      ".cm-activeLine": { backgroundColor: c.active, boxShadow: `inset 0 1px 0 ${c.activeBorder}, inset 0 -1px 0 ${c.activeBorder}` },
      "&:not(.cm-focused) .cm-activeLine": { backgroundColor: "transparent", boxShadow: "none" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: c.caret, borderLeftWidth: "2px" },
      ".cm-selectionBackground": { backgroundColor: `${c.selBlur} !important` },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: `${c.sel} !important` },
      ".cm-matchingBracket": { backgroundColor: c.bracket, outline: `1px solid ${c.bracketBorder}`, borderRadius: "2px" },
      ".cm-nonmatchingBracket": { outline: "1px solid #f85149", borderRadius: "2px" },
      ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", opacity: "0", transition: "opacity .15s", cursor: "pointer" },
      ".cm-gutters:hover .cm-foldGutter .cm-gutterElement": { opacity: "1" },
      ".cm-foldPlaceholder": { backgroundColor: c.fold, border: "none", color: c.gutter, padding: "0 6px", margin: "0 4px" },
      ".cm-find-match": { backgroundColor: c.find, borderRadius: "2px" },
      ".cm-find-current": { backgroundColor: c.findCur, color: c.findCurFg, borderRadius: "2px" },
      ".cm-find-current *": { color: `${c.findCurFg} !important` },
      ".cm-minimap-gutter": { borderLeft: `1px solid ${c.minimapBorder}` },
      ".cm-minimap-overlay-container .cm-minimap-overlay": { backgroundColor: c.minimapOverlay },
    },
    { dark },
  );
}

function guidesExt(variant: ThemeVariant): Extension {
  const { guide, guideActive } = PALETTES[variant].ui;
  return indentationMarkers({
    highlightActiveBlock: true,
    hideFirstIndent: false,
    markerType: "fullScope",
    thickness: 1,
    colors: { light: guide, dark: guide, activeLight: guideActive, activeDark: guideActive },
  });
}

function minimapExt(enabled: boolean): Extension {
  return enabled
    ? showMinimap.compute([], () => ({
        create: () => ({ dom: document.createElement("div") }),
        displayText: "characters",
        showOverlay: "always",
      }))
    : [];
}

/** 每个标签页在代码视图里的滚动/光标位置(切换预览/代码、切换标签后恢复)。 */
const viewMemory = new Map<string, { scrollTop: number; anchor: number; head: number }>();

export interface CodeEditorProps {
  /** 标签页 id:用于记住滚动与光标位置。 */
  docKey: string;
  value: string;
  editable: boolean;
  isDark: boolean;
  fontSize: number;
  minimap: boolean;
  wrap: boolean;
  onChange: (value: string) => void;
  onReady: (view: EditorView | null) => void;
  /** 光标所在行(0 起)变化:面包屑显示当前章节。 */
  onCursorLine?: (line: number) => void;
  /** 视口顶部所在行(0 起)变化:目录高亮跟随滚动。 */
  onTopLine?: (line: number) => void;
}

/**
 * 代码视图编辑器(CodeMirror 6):行号、折叠、Markdown 与围栏代码高亮、当前行、
 * 括号匹配、缩进参考线、可选 minimap 与自动换行。非编辑模式下只读(仍可选择/查找)。
 */
export function CodeEditor(props: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;
  const comps = useRef({
    theme: new Compartment(),
    highlight: new Compartment(),
    readOnly: new Compartment(),
    minimap: new Compartment(),
    wrap: new Compartment(),
    guides: new Compartment(),
  });

  // 挂载:创建 EditorView(依赖变化通过 Compartment 重配置,不重建)。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = cbRef.current;
    const c = comps.current;
    const crlf = p.value.includes("\r\n");
    const mem = viewMemory.get(p.docKey);
    const docLen = p.value.replace(/\r\n/g, "\n").length;
    let lastCursorLine = -1;
    let lastTopLine = -1;

    const reportCursor = (view: EditorView) => {
      const sel = view.state.selection.main;
      const line = view.state.doc.lineAt(sel.head);
      useEditorStatus.getState().set({
        line: line.number,
        col: sel.head - line.from + 1,
        selected: Math.abs(sel.to - sel.from),
        eol: crlf ? "CRLF" : "LF",
      });
      if (line.number - 1 !== lastCursorLine) {
        lastCursorLine = line.number - 1;
        cbRef.current.onCursorLine?.(lastCursorLine);
      }
    };
    const reportTop = (view: EditorView) => {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 40);
      const line = view.state.doc.lineAt(block.from).number - 1;
      if (line !== lastTopLine) {
        lastTopLine = line;
        cbRef.current.onTopLine?.(line);
      }
    };

    const state = EditorState.create({
      doc: p.value,
      selection: mem ? { anchor: Math.min(mem.anchor, docLen), head: Math.min(mem.head, docLen) } : undefined,
      extensions: [
        crlf ? EditorState.lineSeparator.of("\r\n") : [],
        lineNumbers(),
        foldGutter({ openText: "⌄", closedText: "›" }),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        c.guides.of(guidesExt(variantOf(p.isDark))),
        markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [frontmatter, markTags] }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        findField,
        c.theme.of(editorTheme(variantOf(p.isDark), p.fontSize)),
        c.highlight.of(syntaxHighlighting(highlightStyle(variantOf(p.isDark)))),
        c.readOnly.of(EditorState.readOnly.of(!p.editable)),
        c.minimap.of(minimapExt(p.minimap)),
        c.wrap.of(p.wrap ? EditorView.lineWrapping : []),
        EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) {
            cbRef.current.onChange(u.state.sliceDoc());
          }
          if (u.docChanged || u.selectionSet || u.focusChanged) reportCursor(u.view);
          if (u.viewportChanged || u.geometryChanged) reportTop(u.view);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    const onScroll = () => reportTop(view);
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    if (mem) {
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = mem.scrollTop;
      });
    }
    reportCursor(view);
    cbRef.current.onReady(view);
    if (p.editable) view.focus();

    return () => {
      const sel = view.state.selection.main;
      viewMemory.set(p.docKey, { scrollTop: view.scrollDOM.scrollTop, anchor: sel.anchor, head: sel.head });
      view.scrollDOM.removeEventListener("scroll", onScroll);
      cbRef.current.onReady(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 外部内容变化(磁盘重载、预览编辑写回):整篇替换,保留光标位置。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || props.value === view.state.sliceDoc()) return;
    const next = view.state.toText(props.value);
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: Math.min(sel.anchor, next.length), head: Math.min(sel.head, next.length) },
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
  }, [props.value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        comps.current.theme.reconfigure(editorTheme(variantOf(props.isDark), props.fontSize)),
        comps.current.highlight.reconfigure(syntaxHighlighting(highlightStyle(variantOf(props.isDark)))),
        comps.current.guides.reconfigure(guidesExt(variantOf(props.isDark))),
      ],
    });
  }, [props.isDark, props.fontSize]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: comps.current.readOnly.reconfigure(EditorState.readOnly.of(!props.editable)),
    });
  }, [props.editable]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: comps.current.minimap.reconfigure(minimapExt(props.minimap)) });
  }, [props.minimap]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: comps.current.wrap.reconfigure(props.wrap ? EditorView.lineWrapping : []),
    });
  }, [props.wrap]);

  return <div ref={hostRef} className="md-cm-host" />;
}
