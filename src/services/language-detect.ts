/**
 * 自动方向的判断结果。
 * - 中文 / 英文：给出明确的中英互译方向，目标语言随之切换。
 * - 其他语言：`from` 为 `auto`、`to` 为 `null`，即把源语言交给翻译源自动检测，
 *   目标语言保持用户当前的选择。
 * - 无法判断（空文本等）：返回 `null`，保留用户自己选择的语言。
 */
export interface LanguageDirection {
  from: "zh" | "en" | "auto";
  /** 源语言为 auto 时目标语言保持不变，因此为 null。 */
  to: "zh" | "en" | null;
}

const HAN = /\p{Script=Han}/gu;
const LATIN = /\p{Script=Latin}/gu;
/** 汉字、拉丁字母以外的任意字母：假名、谚文、西里尔、希腊、天城文等。 */
const LETTER = /\p{L}/u;

/**
 * 根据输入文本中汉字与拉丁字母的占比判断翻译方向。
 * 出现汉字、拉丁字母以外的文字时，说明输入既不是中文也不是英文，
 * 源语言交给翻译源自动检测。
 */
export function detectDirection(text: string): LanguageDirection | null {
  const sample = text.trim();
  if (!sample) return null;

  const hanCount = sample.match(HAN)?.length ?? 0;
  const latinCount = sample.match(LATIN)?.length ?? 0;

  if (LETTER.test(sample.replace(HAN, "").replace(LATIN, ""))) {
    return { from: "auto", to: null };
  }

  if (hanCount === 0 && latinCount === 0) return null;
  return hanCount >= latinCount ? { from: "zh", to: "en" } : { from: "en", to: "zh" };
}
