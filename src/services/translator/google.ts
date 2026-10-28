import { fetch } from "@tauri-apps/plugin-http";
import type { ProviderInfo, Segment } from "../../types";
import { LANGUAGES } from "./languages";
import type { TranslationProvider } from "./provider";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_CHARS = 5000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface GoogleSentence {
  trans?: string;
  orig?: string;
}

interface GoogleResponse {
  sentences?: GoogleSentence[];
  src?: string;
}

const INFO: ProviderInfo = {
  id: "google",
  name: "Google 翻译",
  description: "Google 翻译网页接口，无需登录与密钥，但需要可以访问 Google 服务。",
  fields: [],
  languages: LANGUAGES,
  supportsAutoDetect: true,
};

/**
 * translate.google.com 背后的公开网页接口无需凭据。
 * `dj=1` 返回扁平的 `sentences` 数组，而不是旧版 `gtx` 客户端使用的
 * 嵌套数组，更方便映射为我们的分段结构。
 */
export const googleProvider: TranslationProvider = {
  info: INFO,

  /** 调用 Google 网页翻译接口，把返回的句子数组拼装为分段译文。 */
  async translate(request, _settings) {
    const text = request.text.trim();
    if (!text) {
      throw "请先输入要翻译的内容";
    }
    if (text.length > MAX_CHARS) {
      throw `文本超出 Google 翻译的单次上限（${MAX_CHARS} 字符）`;
    }

    const from = toGoogleCode(request.from);
    if (!from) {
      throw `Google 翻译不支持源语言「${request.from}」`;
    }
    const to = toGoogleCode(request.to);
    if (!to) {
      throw `Google 翻译不支持目标语言「${request.to}」`;
    }
    if (to === "auto") {
      throw "目标语言不能设为自动检测";
    }

    const body = new URLSearchParams({
      client: "gtx",
      sl: from,
      tl: to,
      dt: "t",
      dj: "1",
      q: text,
    });

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      // 使用 POST 可避免长文本出现在 URL 中，该接口同样接受这种请求。
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (e) {
      throw `请求 Google 翻译失败：${String(e)}`;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw describeStatus(response.status);
    }

    const raw = await response.text();
    let parsed: GoogleResponse;
    try {
      parsed = JSON.parse(raw) as GoogleResponse;
    } catch {
      throw "Google 翻译返回了无法解析的响应";
    }

    const segments: Segment[] = (parsed.sentences ?? [])
      .filter((item) => typeof item.trans === "string" && item.trans.length > 0)
      .map((item) => ({
        src: item.orig ?? "",
        dst: item.trans as string,
      }));

    if (segments.length === 0) {
      throw "Google 翻译未返回译文，请稍后重试";
    }

    return {
      provider: "google",
      from: fromDetected(parsed.src, request.from),
      to: request.to,
      text: segments.map((segment) => segment.dst).join(""),
      segments,
    };
  },
};

/** 把常见 HTTP 状态码转换为用户可读的失败原因。 */
function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return "Google 翻译拒绝了请求，请检查语言或内容";
    case 429:
      return "Google 翻译请求过于频繁，请稍后再试";
    case 403:
      return "Google 翻译拒绝了访问，可能需要更换网络环境";
    default:
      return `Google 翻译返回 HTTP ${status}`;
  }
}

/** 把应用通用语言代码映射为 Google API 的语言代码，不支持时返回 null。 */
function toGoogleCode(code: string): string | null {
  switch (code) {
    case "auto":
      return "auto";
    case "zh":
      return "zh-CN";
    case "zh-Hant":
      return "zh-TW";
    case "en":
    case "ja":
    case "ko":
    case "fr":
    case "es":
    case "ru":
    case "de":
    case "it":
    case "pt":
    case "ar":
    case "th":
    case "vi":
      return code;
    default:
      return null;
  }
}

/** 把 Google 返回的检测语言归一化为应用内部代码，无法识别时回退到请求值。 */
function fromDetected(code: string | undefined, fallback: string): string {
  switch (code) {
    case "zh-CN":
    case "zh":
      return "zh";
    case "zh-TW":
      return "zh-Hant";
    case "en":
    case "ja":
    case "ko":
    case "fr":
    case "es":
    case "ru":
    case "de":
    case "it":
    case "pt":
    case "ar":
    case "th":
    case "vi":
      return code;
    default:
      return fallback;
  }
}
