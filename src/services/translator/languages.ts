import type { LanguageInfo } from "../../types";

/**
 * 全应用共用的语言代码。各翻译源在自己的模块内把这些中立代码转换为各自 API 的语言代码。
 */
export const LANGUAGES: LanguageInfo[] = [
  { code: "auto", label: "自动检测" },
  { code: "zh", label: "简体中文" },
  { code: "zh-Hant", label: "繁体中文" },
  { code: "en", label: "英语" },
  { code: "ja", label: "日语" },
  { code: "ko", label: "韩语" },
  { code: "fr", label: "法语" },
  { code: "es", label: "西班牙语" },
  { code: "ru", label: "俄语" },
  { code: "de", label: "德语" },
  { code: "it", label: "意大利语" },
  { code: "pt", label: "葡萄牙语" },
  { code: "ar", label: "阿拉伯语" },
  { code: "th", label: "泰语" },
  { code: "vi", label: "越南语" },
];
