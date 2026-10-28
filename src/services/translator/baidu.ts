import { fetch } from "@tauri-apps/plugin-http";
import { md5 } from "js-md5";
import type {
  ProviderInfo,
  Segment,
} from "../../types";
import { LANGUAGES } from "./languages";
import type { TranslationProvider } from "./provider";

const ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const MAX_BYTES = 6000;

interface BaiduItem {
  src: string;
  dst: string;
}

interface BaiduResponse {
  from?: string;
  to?: string;
  trans_result?: BaiduItem[];
  error_code?: string | number;
  error_msg?: string;
}

const INFO: ProviderInfo = {
  id: "baidu",
  name: "百度翻译",
  description: "百度翻译通用文本翻译 API，需要 AppID 和密钥。",
  fields: [
    {
      key: "appId",
      label: "AppID",
      placeholder: "百度翻译开放平台的应用 AppID",
      secret: false,
    },
    {
      key: "appKey",
      label: "密钥",
      placeholder: "应用对应的密钥",
      secret: true,
    },
  ],
  languages: LANGUAGES,
  supportsAutoDetect: true,
};

/**
 * 百度接口只接受表单编码请求，且每次调用都用
 * md5(appId + 文本 + salt + appKey) 签名。接口不返回 CORS 头，
 * 因此请求走 Tauri HTTP 插件而不是 WebView 的 fetch。
 */
export const baiduProvider: TranslationProvider = {
  info: INFO,

  /** 校验输入与凭据、生成签名并调用百度翻译 API，返回分段译文。 */
  async translate(request, settings) {
    const text = request.text.trim();
    if (!text) {
      throw "请先输入要翻译的内容";
    }
    if (new TextEncoder().encode(text).length > MAX_BYTES) {
      throw `文本超出百度翻译的单次上限（${MAX_BYTES} 字节）`;
    }

    const appId = requiredSetting(settings, "appId", "AppID");
    const appKey = requiredSetting(settings, "appKey", "密钥");

    const from = toBaiduCode(request.from);
    if (!from) {
      throw `百度翻译不支持源语言「${request.from}」`;
    }
    const to = toBaiduCode(request.to);
    if (!to) {
      throw `百度翻译不支持目标语言「${request.to}」`;
    }
    if (to === "auto") {
      throw "目标语言不能设为自动检测";
    }

    // Salt 可以是任意数字；把时间戳与随机后缀组合起来，
    // 可避免并发请求复用同一个签名。
    const salt = `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;
    const sign = md5(`${appId}${text}${salt}${appKey}`);

    const body = new URLSearchParams({
      q: text,
      from,
      to,
      appid: appId,
      salt,
      sign,
    });

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (e) {
      throw `请求百度翻译失败：${String(e)}`;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw `百度翻译返回 HTTP ${response.status}`;
    }

    const raw = await response.text();
    let parsed: BaiduResponse;
    try {
      parsed = JSON.parse(raw) as BaiduResponse;
    } catch {
      throw "百度翻译返回了无法解析的响应";
    }

    if (parsed.error_code != null) {
      // 52000 是百度的“成功”返回码。
      const code = String(parsed.error_code);
      if (code !== "52000") {
        throw describeError(code, parsed.error_msg);
      }
    }

    const items = parsed.trans_result ?? [];
    if (items.length === 0) {
      throw "百度翻译未返回译文，请稍后重试";
    }

    const segments: Segment[] = items.map((item) => ({
      src: item.src,
      dst: item.dst,
    }));

    return {
      provider: "baidu",
      from: parsed.from || request.from,
      to: parsed.to || request.to,
      text: segments.map((segment) => segment.dst).join("\n"),
      segments,
    };
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
    throw `尚未配置百度翻译 ${label}，请到设置中填写`;
  }
  return value;
}

/** 把应用通用语言代码映射为百度 API 的语言代码，不支持时返回 null。 */
function toBaiduCode(code: string): string | null {
  switch (code) {
    case "auto":
      return "auto";
    case "zh":
      return "zh";
    case "zh-Hant":
      return "cht";
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
    case "de":
      return "de";
    case "it":
      return "it";
    case "pt":
      return "pt";
    case "ar":
      return "ara";
    case "th":
      return "th";
    case "vi":
      return "vie";
    default:
      return null;
  }
}

/** 把百度错误码转换为用户可读的提示，并附带原始错误信息。 */
function describeError(code: string, message?: string): string {
  let hint: string;
  switch (code) {
    case "52001":
      hint = "请求超时，请重试";
      break;
    case "52002":
      hint = "百度翻译系统错误，请重试";
      break;
    case "52003":
      hint = "未授权用户，请检查 AppID 是否正确";
      break;
    case "54000":
      hint = "必填参数为空";
      break;
    case "54001":
      hint = "签名错误，请检查密钥是否正确";
      break;
    case "54003":
      hint = "访问频率受限，请稍后再试";
      break;
    case "54004":
      hint = "账户余额不足，请前往百度翻译开放平台充值";
      break;
    case "54005":
      hint = "长文本请求过于频繁，请稍后再试";
      break;
    case "58000":
      hint = "客户端 IP 非法";
      break;
    case "58001":
      hint = "译文语言方向不支持";
      break;
    case "58002":
      hint = "服务已关闭";
      break;
    default:
      hint = "翻译失败";
      break;
  }
  return message ? `${hint}（${code}: ${message}）` : `${hint}（${code}）`;
}
