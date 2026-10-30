import { fetch } from "@tauri-apps/plugin-http";
import type {
  ImageSegment,
  ImageTranslateResponse,
  LanguageInfo,
  ProviderInfo,
} from "../../types";
import type { ImageTranslationProvider } from "./image-provider";

const ENDPOINT = "https://fanyi-api.baidu.com/ait/api/picture/translate";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 百度图片翻译 V2.0 支持的语言，代码与各 API 语言简写一一对应。 */
const IMAGE_LANGUAGES: LanguageInfo[] = [
  { code: "auto", label: "自动检测" },
  { code: "zh", label: "简体中文" },
  { code: "en", label: "英语" },
  { code: "ja", label: "日语" },
  { code: "ko", label: "韩语" },
  { code: "fr", label: "法语" },
  { code: "es", label: "西班牙语" },
  { code: "ru", label: "俄语" },
  { code: "pt", label: "葡萄牙语" },
  { code: "de", label: "德语" },
  { code: "it", label: "意大利语" },
  { code: "da", label: "丹麦语" },
  { code: "nl", label: "荷兰语" },
  { code: "ms", label: "马来语" },
  { code: "sv", label: "瑞典语" },
  { code: "id", label: "印尼语" },
  { code: "pl", label: "波兰语" },
  { code: "ro", label: "罗马尼亚语" },
  { code: "tr", label: "土耳其语" },
  { code: "el", label: "希腊语" },
  { code: "hu", label: "匈牙利语" },
];

interface BaiduContent {
  src?: string;
  dst?: string;
  rect?: string;
  line_count?: number;
  points?: { x?: number; y?: number }[];
  paste_img?: string;
}

interface BaiduImageResponse {
  error_code?: string | number;
  error_msg?: string;
  from?: string;
  to?: string;
  src?: string;
  dst?: string;
  paste_img?: string;
  contents?: BaiduContent[];
  /** 部分网关会把结果包在 data 中。 */
  data?: Omit<BaiduImageResponse, "data">;
}

const INFO: ProviderInfo = {
  id: "baidu-image",
  name: "百度大模型翻译（图片翻译）",
  description:
    "百度图片翻译 API V2.0，需额外配置 API Key。",
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "管理控制台 APIKey 管理中创建的 API Key",
      secret: true,
    },
  ],
  languages: IMAGE_LANGUAGES,
  supportsAutoDetect: true,
  helpLinks: [
    { label: "开通图片翻译", url: "https://fanyi-api.baidu.com/choose" },
    {
      label: "创建 API Key",
      url: "https://fanyi-api.baidu.com/manage/apiKey",
    },
    { label: "接口文档", url: "https://fanyi-api.baidu.com/product/233" },
  ],
};

/**
 * 百度图片翻译 V2.0 使用 JSON 请求体与 Bearer Token 鉴权，
 * Token 即管理控制台 APIKey 管理中的 API Key。接口不返回 CORS 头，
 * 因此请求走 Tauri HTTP 插件。
 */
export const baiduImageProvider: ImageTranslationProvider = {
  info: INFO,
  /** 图片翻译与百度文本翻译共用 AppID，AppID 取自文本翻译的凭据。 */
  credentialsFrom: "baidu",

  async translateImage(request, settings) {
    const image = stripDataUrl(request.image);
    if (!image) {
      throw "请先选择要翻译的图片";
    }
    if (estimateBase64Bytes(image) > MAX_IMAGE_BYTES) {
      throw "图片超出百度图片翻译的上限（5 MB）";
    }

    const appId = requiredSetting(settings, "appId", "百度翻译 AppID（与文本翻译共用）");
    const apiKey = requiredSetting(settings, "apiKey", "百度图片翻译 API Key");

    const from = toBaiduCode(request.from);
    if (!from) {
      throw `百度图片翻译不支持源语言「${request.from}」`;
    }
    const to = toBaiduCode(request.to);
    if (!to) {
      throw `百度图片翻译不支持目标语言「${request.to}」`;
    }
    if (to === "auto") {
      throw "目标语言不能设为自动检测";
    }

    const body = JSON.stringify({
      from,
      to,
      appid: appId,
      need_intervene: 0,
      paste: request.paste,
      content: image,
      view_type: request.viewType,
      model_type: "nmt",
    });

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      throw `请求百度图片翻译失败：${String(e)}`;
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let parsed: BaiduImageResponse;
    try {
      parsed = JSON.parse(raw) as BaiduImageResponse;
    } catch {
      if (!response.ok) {
        throw `百度图片翻译返回 HTTP ${response.status}`;
      }
      throw "百度图片翻译返回了无法解析的响应";
    }

    const code = parsed.error_code ?? parsed.data?.error_code;
    if (code != null && String(code) !== "0") {
      throw describeError(String(code), parsed.error_msg ?? parsed.data?.error_msg);
    }
    if (!response.ok) {
      throw `百度图片翻译返回 HTTP ${response.status}`;
    }

    const payload = parsed.data ?? parsed;
    const segments: ImageSegment[] = (payload.contents ?? []).map((item) => ({
      src: item.src ?? "",
      dst: item.dst ?? "",
      rect: item.rect,
      lineCount: item.line_count,
      points: (item.points ?? []).map((point) => ({
        x: point.x ?? 0,
        y: point.y ?? 0,
      })),
      blockImage: item.paste_img || undefined,
    }));

    const dst =
      payload.dst ?? segments.map((segment) => segment.dst).join("\n");
    const pasteImage = payload.paste_img
      ? toDataUrl(payload.paste_img)
      : undefined;

    if (!dst && !pasteImage) {
      throw "百度图片翻译未返回结果，请稍后重试";
    }

    return {
      provider: "baidu-image",
      from: fromDetected(payload.from, request.from),
      to: payload.to ?? request.to,
      src: payload.src ?? segments.map((segment) => segment.src).join("\n"),
      dst,
      segments,
      pasteImage,
    } satisfies ImageTranslateResponse;
  },
};

/** 读取必需的凭据字段，缺失时抛出引导用户去设置的提示。 */
function requiredSetting(
  settings: Record<string, string>,
  key: string,
  label: string,
): string {
  const value = settings[key]?.trim();
  if (!value) {
    throw `尚未配置${label}，请到设置中填写`;
  }
  return value;
}

/** 去掉可能存在的 data URL 前缀。 */
function stripDataUrl(image: string): string {
  const comma = image.indexOf(",");
  return image.startsWith("data:") && comma >= 0
    ? image.slice(comma + 1)
    : image;
}

/** 根据 Base64 长度估算原始图片字节数。 */
function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** 把接口返回的 Base64 图片转换为可直接展示的 data URL。 */
function toDataUrl(base64: string): string {
  if (base64.startsWith("data:")) return base64;
  return `data:${imageMime(base64)};base64,${base64}`;
}

function imageMime(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

/** 把应用语言代码映射为百度图片翻译的语言简写。 */
function toBaiduCode(code: string): string | null {
  switch (code) {
    case "auto":
      return "auto";
    case "zh":
      return "zh";
    case "en":
      return "en";
    case "ja":
      return "jp";
    case "ko":
      return "kor";
    case "fr":
      return "fra";
    case "es":
      return "spa";
    case "ru":
      return "ru";
    case "pt":
      return "pt";
    case "de":
      return "de";
    case "it":
      return "it";
    case "da":
      return "dan";
    case "nl":
      return "nl";
    case "ms":
      return "may";
    case "sv":
      return "swe";
    case "id":
      return "id";
    case "pl":
      return "pl";
    case "ro":
      return "rom";
    case "tr":
      return "tr";
    case "el":
      return "el";
    case "hu":
      return "hu";
    default:
      return null;
  }
}

/** 把百度返回的源语言简写归一化为应用内部代码。 */
function fromDetected(code: string | undefined, fallback: string): string {
  switch (code) {
    case "zh":
      return "zh";
    case "en":
      return "en";
    case "jp":
      return "ja";
    case "kor":
      return "ko";
    case "fra":
      return "fr";
    case "spa":
      return "es";
    case "ru":
    case "pt":
    case "de":
    case "it":
    case "nl":
    case "id":
    case "pl":
    case "tr":
    case "el":
    case "hu":
      return code;
    case "dan":
      return "da";
    case "may":
      return "ms";
    case "swe":
      return "sv";
    case "rom":
      return "ro";
    default:
      return fallback;
  }
}

/** 把百度图片翻译错误码转换为用户可读的提示。 */
function describeError(code: string, message?: string): string {
  let hint: string;
  switch (code) {
    case "53001":
      hint = "百度图片翻译服务内部错误，请稍后重试";
      break;
    case "54000":
      hint = "必填参数为空或参数有误";
      break;
    case "54001":
      hint = "鉴权失败，请检查 AppID 与 API Key 是否正确";
      break;
    case "54004":
      hint = "账户余额不足，请前往百度翻译开放平台充值";
      break;
    case "55001":
      hint = "参数校验失败，请检查语言或图片";
      break;
    case "55002":
      hint = "API Key 校验失败，请重新创建或检查 API Key";
      break;
    case "55003":
      hint = "图片解析失败，请换一张更清晰的图片";
      break;
    case "55004":
      hint = "图片翻译或贴合失败，请稍后重试";
      break;
    case "55005":
      hint = "图片大小超过 5 MB 上限";
      break;
    case "55006":
      hint = "图片翻译服务未开通或已停用";
      break;
    case "55007":
      hint = "签名校验失败";
      break;
    case "59004":
      hint = "请求过于频繁，请稍后再试";
      break;
    default:
      hint = "图片翻译失败";
      break;
  }
  return message ? `${hint}（${code}: ${message}）` : `${hint}（${code}）`;
}
