/**
 * 根据输入文本判断翻译方向：中文译成英语，英语译回中文。
 * 其他文字类型故意返回 `null`，以保留用户自己选择的语言。
 */
export interface LanguageDirection {
  from: "zh" | "en";
  to: "zh" | "en";
}

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\u3005\u3007]/g;
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/;
const LATIN = /[A-Za-z]/g;
/** 与中文、英文完全无关的文字类型；遇到它们时从不自动切换。 */
const OTHER_SCRIPT =
  /[\u0400-\u04ff\u0530-\u058f\u0590-\u05ff\u0600-\u06ff\u0e00-\u0e7f\uac00-\ud7af]/;

/**
 * 根据输入文本中汉字与拉丁字母的占比判断翻译方向。
 * 含日文假名或其他文字时返回 null，保留用户手动选择的语言。
 */
export function detectDirection(text: string): LanguageDirection | null {
  const sample = text.trim();
  if (!sample) return null;

  if (KANA.test(sample) || OTHER_SCRIPT.test(sample)) return null;

  const hanCount = sample.match(HAN)?.length ?? 0;
  const latinCount = sample.match(LATIN)?.length ?? 0;

  if (hanCount === 0 && latinCount === 0) return null;
  return hanCount >= latinCount ? { from: "zh", to: "en" } : { from: "en", to: "zh" };
}
