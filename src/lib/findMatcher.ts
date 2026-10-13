/** 查找/替换的匹配引擎:代码视图(CodeMirror 文档)与预览视图(渲染后的 DOM 文本)共用。 */

export interface FindSpec {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface TextMatch {
  from: number;
  to: number;
}

/** 单次查找的匹配上限:超长文档里搜单个字母也不至于卡死。 */
export const MAX_MATCHES = 5000;

/** 把查找条件编译成全局正则;查询为空返回 null,正则语法错误返回 "invalid"。 */
export function buildFindRegex(spec: FindSpec): RegExp | null | "invalid" {
  if (!spec.query) return null;
  const pattern = spec.regexp ? spec.query : spec.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = `gm${spec.caseSensitive ? "" : "i"}`;
  try {
    if (!spec.wholeWord) return new RegExp(pattern, flags);
    // 全词匹配:按 Unicode 字母/数字判断边界(中日文也适用);用户正则在 u 模式下
    // 不合法时退回 ASCII 的 \b。
    try {
      return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, `${flags}u`);
    } catch {
      return new RegExp(`\\b(?:${pattern})\\b`, flags);
    }
  } catch {
    return "invalid";
  }
}

/** 在 text 中找出全部非空匹配(最多 MAX_MATCHES 个)。 */
export function findAllMatches(text: string, re: RegExp): TextMatch[] {
  const out: TextMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < MAX_MATCHES) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push({ from: m.index, to: m.index + m[0].length });
  }
  return out;
}

/** 计算某个匹配的替换文本:正则模式支持 $1 等分组引用;保留大小写模式跟随原文大小写。 */
export function replacementFor(
  matched: string,
  replacement: string,
  spec: FindSpec,
  preserveCase: boolean,
): string {
  let out = replacement;
  if (spec.regexp) {
    const re = buildFindRegex(spec);
    if (re instanceof RegExp) {
      out = matched.replace(new RegExp(re.source, re.flags.replace("g", "")), replacement);
    }
  }
  if (preserveCase && out) {
    if (matched.length > 1 && matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
      out = out.toUpperCase();
    } else if (matched[0] && matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()) {
      out = out[0].toUpperCase() + out.slice(1);
    } else if (matched === matched.toLowerCase()) {
      out = out.toLowerCase();
    }
  }
  return out;
}

/** 当前匹配序号:优先保持原序号(编辑后重算),否则取 anchor 之后的第一个。 */
export function pickCurrent(matches: TextMatch[], prev: number, keepIndex: boolean, anchor: number): number {
  if (matches.length === 0) return -1;
  if (keepIndex && prev >= 0) return Math.min(prev, matches.length - 1);
  const i = matches.findIndex((m) => m.from >= anchor);
  return i === -1 ? 0 : i;
}
