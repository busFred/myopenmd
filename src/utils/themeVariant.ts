/** 界面主题:亮色、暗色,以及参照 VS Code「MyGreyout」(Light+ 配色 + 灰调外壳)的灰调主题。 */
export type ThemeVariant = "light" | "dark" | "greyout";

export const THEMES: ThemeVariant[] = ["light", "dark", "greyout"];

/** next-themes 的 resolvedTheme → 主题变体;首帧为 undefined 时按暗色处理(默认主题)。 */
export function themeVariant(resolved: string | undefined): ThemeVariant {
  return resolved === "light" || resolved === "greyout" ? resolved : "dark";
}

/** 是否暗色(灰调主题属于亮色系)。 */
export function isDarkTheme(resolved: string | undefined): boolean {
  return themeVariant(resolved) === "dark";
}

const LIGHT_VARIANT_KEY = "openmd-light-variant";

/** 顶栏日/月切换:从暗色切回时回到上次用的亮色系主题(亮色或灰调)。 */
export function lastLightVariant(): ThemeVariant {
  return localStorage.getItem(LIGHT_VARIANT_KEY) === "greyout" ? "greyout" : "light";
}
export function rememberLightVariant(v: string | undefined): void {
  if (v === "light" || v === "greyout") localStorage.setItem(LIGHT_VARIANT_KEY, v);
}
