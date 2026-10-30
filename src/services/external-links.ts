import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * 用系统默认浏览器打开外部链接；浏览器预览环境下
 * 没有 Tauri 运行时，退回 window.open。
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
