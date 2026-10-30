import type { ThemeMode } from "../types";

/** 当前主题设置；配置加载完成前先跟随系统。 */
let currentMode: ThemeMode = "system";

const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/** 把主题设置解析为实际渲染的明暗模式；未知值按跟随系统处理。 */
function resolveEffectiveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return systemDarkQuery.matches ? "dark" : "light";
}

/** 把主题写到文档根节点，由 CSS 变量切换明暗配色。 */
function renderTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveEffectiveTheme(mode);
}

/** 跟随系统时，系统明暗变化会实时同步到界面。 */
systemDarkQuery.addEventListener("change", () => {
  if (currentMode === "system") renderTheme("system");
});

/** 应用并记录当前主题设置。 */
export function applyTheme(mode: ThemeMode) {
  currentMode = mode;
  renderTheme(mode);
}

// 模块加载时立即跟随系统，避免读取配置期间界面闪烁；
// 配置加载完成后由 App.vue 调用 applyTheme 应用用户保存的主题。
applyTheme("system");
