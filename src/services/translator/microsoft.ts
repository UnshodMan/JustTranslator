import { fetch } from "@tauri-apps/plugin-http";
import type { ProviderInfo } from "../../types";
import { LANGUAGES } from "./languages";
import type { TranslationProvider } from "./provider";

const PAGE_ENDPOINT = "https://www.bing.com/translator";
const TRANSLATE_ENDPOINT = "https://www.bing.com/ttranslatev3";
const MAX_CHARS = 1000;
const TOKEN_TTL = 10 * 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface Session {
  key: string;
  token: string;
  ig: string;
  expiresAt: number;
}

interface BingTranslation {
  translations?: { text?: string; to?: string }[];
  detectedLanguage?: { language?: string };
  statusCode?: number;
  errorMessage?: string;
}

interface BingError {
  statusCode?: number;
  errorMessage?: string;
}

let sessionCache: Session | null = null;

const INFO: ProviderInfo = {
  id: "microsoft",
  name: "微软翻译",
  description: "Microsoft Bing 翻译网页接口，无需登录与密钥。",
  fields: [],
  languages: LANGUAGES,
  supportsAutoDetect: true,
};

/**
 * 微软面向消费者的翻译服务位于 bing.com 之后。每次加载页面都会
 * 暴露一对短时效的 key/token，用于给 `ttranslatev3` 表单请求签名，
 * 因此这里抓取一次这两个值并复用，直到它们过期。
 */
export const microsoftProvider: TranslationProvider = {
  info: INFO,

  /** 调用 Bing 网页翻译接口；令牌提前失效时刷新会话并重试一次。 */
  async translate(request, _settings) {
    const text = request.text.trim();
    if (!text) {
      throw "请先输入要翻译的内容";
    }
    if (text.length > MAX_CHARS) {
      throw `文本超出微软翻译的单次上限（${MAX_CHARS} 字符）`;
    }

    const from = toMicrosoftCode(request.from);
    if (!from) {
      throw `微软翻译不支持源语言「${request.from}」`;
    }
    const to = toMicrosoftCode(request.to);
    if (!to) {
      throw `微软翻译不支持目标语言「${request.to}」`;
    }
    if (to === "auto-detect") {
      throw "目标语言不能设为自动检测";
    }

    let response = await send(from, to, text, await getSession(false));
    if (response.status === 401 || response.status === 403) {
      // 抓取的令牌提前失效；获取新会话后重试一次。
      response = await send(from, to, text, await getSession(true));
    }

    if (!response.ok) {
      throw describeStatus(response.status);
    }

    const raw = await response.text();
    let parsed: BingTranslation[] | BingError;
    try {
      parsed = JSON.parse(raw) as BingTranslation[] | BingError;
    } catch {
      throw "微软翻译返回了无法解析的响应";
    }

    if (!Array.isArray(parsed)) {
      throw parsed.errorMessage
        ? `微软翻译失败：${parsed.errorMessage}`
        : `微软翻译失败（${parsed.statusCode ?? "未知错误"}）`;
    }

    const first = parsed[0];
    const translated = first?.translations?.[0]?.text;
    if (!translated) {
      throw "微软翻译未返回译文，请稍后重试";
    }

    return {
      provider: "microsoft",
      from: fromDetected(first?.detectedLanguage?.language, request.from),
      to: request.to,
      text: translated,
      segments: [{ src: text, dst: translated }],
    };
  },
};

/** 携带会话令牌向 ttranslatev3 发起表单 POST 请求。 */
async function send(
  from: string,
  to: string,
  text: string,
  session: Session,
): Promise<Response> {
  const params = new URLSearchParams({
    fromLang: from,
    to,
    text,
    token: session.token,
    key: session.key,
  });
  const url = `${TRANSLATE_ENDPOINT}?isVertical=1&&IG=${encodeURIComponent(session.ig)}&IID=translator.5028.1`;

  return request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: PAGE_ENDPOINT,
      Origin: "https://www.bing.com",
      "User-Agent": USER_AGENT,
    },
    body: params.toString(),
  });
}

/** 从 Bing 翻译页面抓取短时令牌与签名参数并缓存，过期或强制刷新时重新抓取。 */
async function getSession(force: boolean): Promise<Session> {
  if (!force && sessionCache && sessionCache.expiresAt > Date.now()) {
    return sessionCache;
  }

  const response = await request(PAGE_ENDPOINT, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw `获取微软翻译会话失败：HTTP ${response.status}`;
  }

  const html = await response.text();
  const credentials = html.match(
    /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)/,
  );
  const ig = html.match(/IG:"([^"]+)"/);

  if (!credentials || !ig) {
    throw "微软翻译页面结构已变化，暂时无法获取翻译凭据";
  }

  const ttl = Number(credentials[3]);
  sessionCache = {
    key: credentials[1],
    token: credentials[2],
    ig: ig[1],
    expiresAt:
      Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : TOKEN_TTL),
  };
  return sessionCache;
}

/** 带 20 秒超时的 HTTP 请求封装，网络错误统一转为中文提示。 */
async function request(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw `请求微软翻译失败：${String(e)}`;
  } finally {
    clearTimeout(timeout);
  }
}

/** 把常见 HTTP 状态码转换为用户可读的失败原因。 */
function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return "微软翻译拒绝了请求，请检查语言或内容";
    case 401:
    case 403:
      return "微软翻译访问被拒绝，可能需要更换网络环境";
    case 429:
      return "微软翻译请求过于频繁，请稍后再试";
    default:
      return `微软翻译返回 HTTP ${status}`;
  }
}

/** 把应用通用语言代码映射为 Bing API 的语言代码，不支持时返回 null。 */
function toMicrosoftCode(code: string): string | null {
  switch (code) {
    case "auto":
      return "auto-detect";
    case "zh":
      return "zh-Hans";
    case "zh-Hant":
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
      return null;
  }
}

/** 把 Bing 返回的检测语言归一化为应用内部代码，无法识别时回退到请求值。 */
function fromDetected(code: string | undefined, fallback: string): string {
  switch (code) {
    case "zh-Hans":
    case "zh":
      return "zh";
    case "zh-Hant":
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
