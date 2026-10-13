import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CaseSensitive,
  CaseUpper,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Lock,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import { useFind } from "../stores/find";
import { EMPTY_FIND_RESULT, type FindBackend, type FindResult } from "./findBackends";

function IconToggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="find-opt"
      aria-pressed={on}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * VS Code 风格的查找/替换浮层(Ctrl+F / Ctrl+H)。匹配与高亮由 backend 完成;
 * version 变化(内容被编辑/重渲染)时保持当前序号重算。
 */
export function FindBar({
  backend,
  version,
  top,
}: {
  backend: FindBackend | null;
  version: unknown;
  top: number;
}) {
  const { t } = useTranslation();
  const find = useFind();
  const { open, replaceOpen, query, replacement, caseSensitive, wholeWord, regexp, preserveCase, focusTick } = find;
  const [res, setRes] = useState<FindResult>(EMPTY_FIND_RESULT);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const canReplace = !!backend?.canReplace;
  const showReplace = replaceOpen && canReplace;
  const spec = { query, caseSensitive, wholeWord, regexp };

  // 打开 / 再次按 Ctrl+F|H:用选中文字作查询,聚焦输入框。
  useEffect(() => {
    if (!open || focusTick === 0) return;
    const sel = backend?.selectionText() ?? "";
    if (sel && sel.length < 200 && !sel.includes("\n")) useFind.getState().setQuery(sel);
    requestAnimationFrame(() => {
      const input = useFind.getState().replaceOpen && canReplace && sel ? replaceInputRef.current : findInputRef.current;
      input?.focus();
      input?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只响应快捷键
  }, [focusTick]);

  // 查询或选项变化:从视口/光标处重新定位并滚动到当前匹配。
  const specKey = JSON.stringify(spec);
  useEffect(() => {
    if (!open || !backend) return;
    setRes(backend.run(spec, { keepIndex: false, reveal: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, backend, specKey]);
  // 内容变化:保持序号重算,不跳动。
  const firstVersion = useRef(true);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    if (!open || !backend) return;
    setRes(backend.run(spec, { keepIndex: true, reveal: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  // 关闭/卸载时清除高亮。
  useEffect(() => {
    if (open && backend) return () => backend.clear();
  }, [open, backend]);

  const step = useCallback((dir: 1 | -1) => backend && setRes(backend.step(dir)), [backend]);
  const close = useCallback(() => {
    useFind.getState().close();
    backend?.focus();
  }, [backend]);
  const replaceOne = () => backend && setRes(backend.replaceOne(spec, replacement, preserveCase));
  const replaceAll = () => {
    if (!backend) return;
    backend.replaceAll(spec, replacement, preserveCase);
    setRes(backend.run(spec, { keepIndex: false, reveal: false }));
  };

  // 焦点在正文里时:Esc 关闭,F3 / Shift+F3 跳转。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3") {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest(".md-view-root")) close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, close]);

  if (!open) return null;

  const onWidgetKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "Enter" && (e.ctrlKey || e.metaKey) && e.altKey) {
      e.preventDefault();
      replaceAll();
    } else if (k === "Enter" && e.target === replaceInputRef.current) {
      e.preventDefault();
      replaceOne();
    } else if (k === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (k === "Escape") {
      e.preventDefault();
      close();
    } else if (e.altKey && !e.ctrlKey) {
      const key = ({ c: "caseSensitive", w: "wholeWord", r: "regexp", p: "preserveCase" } as const)[k.toLowerCase() as "c"];
      if (key) {
        e.preventDefault();
        find.toggle(key);
      }
    }
    // 输入框里的撤销/重做属于输入框本身,不能被预览编辑的全局撤销接管
    if (k === "Escape" || ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(k))) e.stopPropagation();
  };

  const countText = !query
    ? ""
    : res.invalid
      ? t("viewer.find.invalid")
      : res.count === 0
        ? t("viewer.find.noResults")
        : t("viewer.find.count", { current: res.current + 1, total: res.count });

  return (
    <>
      <div
        className={`find-widget${showReplace ? " expanded" : ""}`}
        style={{ top }}
        role="dialog"
        aria-label={t("viewer.find.find")}
        onKeyDown={onWidgetKey}
      >
        <button
          type="button"
          className="find-expander"
          disabled={!canReplace}
          title={canReplace ? t("viewer.find.toggleReplace") : t("viewer.find.replaceNeedsEdit")}
          aria-expanded={showReplace}
          onClick={() => find.setReplaceOpen(!replaceOpen)}
        >
          <ChevronRight size={14} />
        </button>
        <div className="find-rows">
          <div className="find-row">
            <div className={`find-field${res.invalid || (query && res.count === 0) ? " nomatch" : ""}`}>
              <Search size={13} className="find-field-icon" />
              <input
                ref={findInputRef}
                value={query}
                placeholder={t("viewer.find.find")}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => find.setQuery(e.target.value)}
              />
              <IconToggle on={caseSensitive} title={t("viewer.find.matchCase")} onClick={() => find.toggle("caseSensitive")}>
                <CaseSensitive size={15} />
              </IconToggle>
              <IconToggle on={wholeWord} title={t("viewer.find.wholeWord")} onClick={() => find.toggle("wholeWord")}>
                <WholeWord size={15} />
              </IconToggle>
              <IconToggle on={regexp} title={t("viewer.find.regex")} onClick={() => find.toggle("regexp")}>
                <Regex size={14} />
              </IconToggle>
            </div>
            <span className={`find-count${query && (res.invalid || res.count === 0) ? " none" : ""}`}>{countText}</span>
            <button type="button" className="find-icon-btn" disabled={res.count === 0} title={t("viewer.find.prev")} onClick={() => step(-1)}>
              <ChevronUp size={15} />
            </button>
            <button type="button" className="find-icon-btn" disabled={res.count === 0} title={t("viewer.find.next")} onClick={() => step(1)}>
              <ChevronDown size={15} />
            </button>
            <span className="find-sep" />
            <button type="button" className="find-icon-btn" title={t("viewer.find.close")} onClick={close}>
              <X size={14} />
            </button>
          </div>
          {showReplace && (
            <div className="find-row">
              <div className="find-field">
                <Replace size={13} className="find-field-icon" />
                <input
                  ref={replaceInputRef}
                  value={replacement}
                  placeholder={t("viewer.find.replace")}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => find.setReplacement(e.target.value)}
                />
                <IconToggle on={preserveCase} title={t("viewer.find.preserveCase")} onClick={() => find.toggle("preserveCase")}>
                  <CaseUpper size={15} />
                </IconToggle>
              </div>
              <button type="button" className="find-btn" disabled={res.count === 0} title={t("viewer.find.replaceTitle")} onClick={replaceOne}>
                {t("viewer.find.replace")}
              </button>
              <button
                type="button"
                className="find-btn primary"
                disabled={res.count === 0}
                title={t("viewer.find.replaceAllTitle")}
                onClick={replaceAll}
              >
                <ReplaceAll size={13} />
                {t("viewer.find.replaceAll")}
              </button>
            </div>
          )}
          {!canReplace && replaceOpen && (
            <div className="find-note">
              <Lock size={11} />
              {t("viewer.find.readOnly")}
            </div>
          )}
        </div>
      </div>
      {res.ticks.length > 0 && (
        <div className="find-ruler" aria-hidden>
          {res.ticks.map((y, i) => (
            <i key={i} className={i === res.current ? "cur" : undefined} style={{ top: `${Math.min(99.5, y * 100)}%` }} />
          ))}
        </div>
      )}
    </>
  );
}
