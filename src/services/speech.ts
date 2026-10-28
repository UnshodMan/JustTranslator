import { fetch } from "@tauri-apps/plugin-http";
import type { SpeechEngine } from "../types";

/**
 * 文本朗读服务：一个入口背后支持两种引擎：
 * - 系统语音：Web Speech API，离线可用，遵循配置的语速；
 * - 在线语音：Google 翻译的公开 TTS 接口，音色自然，按约 200 字符
 *   切分为多段并连续播放。
 *
 * 同一时间只播放一段语音；`speak` 会先停掉之前的内容。
 */

export interface SpeakOptions {
  text: string;
  /** 应用内部的中立语言代码，例如 "en"、"zh"、"zh-Hant"。 */
  lang: string;
  engine: SpeechEngine;
  /** 系统引擎的播放语速；在线引擎会忽略该值。 */
  rate: number;
  /** 播放结束或被停止时调用。 */
  onEnd?: () => void;
  /** 播放失败时调用；同时意味着播放已结束。 */
  onError?: (message: string) => void;
}

const TTS_ENDPOINT = "https://translate.google.com/translate_tts";
const MAX_CHUNK_CHARS = 200;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 应用语言代码 -> 两种引擎都能识别的 BCP-47 标签。 */
const LANG_TAGS: Record<string, string> = {
  zh: "zh-CN",
  "zh-Hant": "zh-TW",
};

/** 把应用内部语言代码转换为两种引擎都能识别的 BCP-47 标签。 */
function toLangTag(code: string): string {
  return LANG_TAGS[code] ?? code;
}

interface Session {
  kind: "system" | "online";
  cancelled: boolean;
  finished: boolean;
  audio: HTMLAudioElement | null;
  /** 手动停止播放时，用于结束当前分段的等待。 */
  interrupt: (() => void) | null;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

let session: Session | null = null;

/** 确保会话只结算一次，并通知调用方。 */
function finish(current: Session, error?: string) {
  if (current.finished) return;
  current.finished = true;
  if (session === current) session = null;
  if (error) current.onError?.(error);
  else current.onEnd?.();
}

/** 停止当前会话：系统引擎走 cancel，在线引擎中断分句等待并暂停音频。 */
export function stopSpeaking(): void {
  const current = session;
  if (!current) return;
  current.cancelled = true;
  if (current.kind === "system") {
    window.speechSynthesis?.cancel();
  } else {
    current.interrupt?.();
    current.audio?.pause();
  }
  finish(current);
}

/**
 * 朗读入口：先停掉上一段，再按引擎设置选择系统语音或 Google 在线语音。
 * 自动模式下系统没有对应语言音色时回退到在线引擎。
 */
export function speak(options: SpeakOptions): void {
  stopSpeaking();
  const text = options.text.trim();
  if (!text) return;

  const langTag = toLangTag(options.lang);
  const voice = findSystemVoice(langTag);
  const synthSupported =
    typeof window !== "undefined" && !!window.speechSynthesis;
  const useSystem =
    synthSupported &&
    (options.engine === "system" || (options.engine === "auto" && !!voice));

  const current: Session = {
    kind: useSystem ? "system" : "online",
    cancelled: false,
    finished: false,
    audio: null,
    interrupt: null,
    onEnd: options.onEnd,
    onError: options.onError,
  };
  session = current;

  if (useSystem) {
    speakSystem(current, options, langTag, voice);
  } else if (options.engine === "system") {
    // 用户明确选择了离线引擎，但该引擎无法支持当前语言。
    finish(
      current,
      synthSupported
        ? `系统没有「${langTag}」的可用语音，可在设置中改用自动或在线语音`
        : "当前环境不支持系统语音，可在设置中改用在线语音",
    );
  } else {
    void speakOnline(current, text, langTag);
  }
}

/* ---------------- 系统引擎（Web Speech API） ---------------- */

/** 在系统音色列表中查找匹配语言，先精确匹配，再按语言前缀兜底。 */
function findSystemVoice(langTag: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const want = langTag.toLowerCase();
  const prefix = want.split("-")[0];
  const normalize = (lang: string) => lang.toLowerCase().replace("_", "-");
  return (
    voices.find((voice) => normalize(voice.lang) === want) ??
    voices.find((voice) => normalize(voice.lang).startsWith(prefix)) ??
    null
  );
}

/** 使用 Web Speech API 播放整段文本，语速限制在 0.5–2 倍之间。 */
function speakSystem(
  current: Session,
  options: SpeakOptions,
  langTag: string,
  voice: SpeechSynthesisVoice | null,
) {
  const utterance = new SpeechSynthesisUtterance(options.text);
  utterance.lang = langTag;
  if (voice) utterance.voice = voice;
  utterance.rate = Math.min(2, Math.max(0.5, options.rate));
  utterance.onend = () => finish(current);
  utterance.onerror = (event) => {
    // 部分引擎中，取消播放也会触发 error 事件。
    if (current.cancelled || event.error === "canceled") {
      finish(current);
    } else {
      finish(current, `系统语音播放失败：${event.error}`);
    }
  };
  window.speechSynthesis.speak(utterance);
}

/* ---------------- 在线引擎（Google 翻译 TTS） ---------------- */

/** 按句子边界切分文本，使每个分段不超过接口上限。 */
function splitIntoChunks(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?;。！？；\n]+[.!?;。！？；\n]*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current.trim()) chunks.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += max) {
        chunks.push(sentence.slice(i, i + max));
      }
      continue;
    }
    if ((current + sentence).length > max && current.trim()) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

/** 请求 Google TTS 接口获取单个分段的音频，15 秒超时。 */
async function fetchChunk(text: string, langTag: string): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    ie: "UTF-8",
    client: "tw-ob",
    tl: langTag,
    q: text,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(`${TTS_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } catch (e) {
    throw `请求在线语音失败：${String(e)}`;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw `在线语音接口返回 HTTP ${response.status}`;
  }
  return response.arrayBuffer();
}

/** 拉取一个分段的音频并包装成可播放的 Audio 对象。 */
async function loadAudio(chunk: string, langTag: string): Promise<HTMLAudioElement> {
  const buffer = await fetchChunk(chunk, langTag);
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
  const audio = new Audio(url);
  audio.preload = "auto";
  return audio;
}

/** 按顺序播放各分段，并在当前分段播放时预取下一段。 */
async function speakOnline(current: Session, text: string, langTag: string) {
  try {
    const chunks = splitIntoChunks(text, MAX_CHUNK_CHARS);
    if (!chunks.length) {
      finish(current);
      return;
    }

    let next: Promise<HTMLAudioElement> | null = loadAudio(chunks[0], langTag);
    for (let i = 0; i < chunks.length; i++) {
      const pending = next;
      if (!pending) break;
      const audio = await pending;
      next = i + 1 < chunks.length ? loadAudio(chunks[i + 1], langTag) : null;
      if (current.cancelled) {
        URL.revokeObjectURL(audio.src);
        break;
      }
      current.audio = audio;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          current.interrupt = null;
        };
        current.interrupt = () => {
          cleanup();
          resolve();
        };
        audio.onended = () => {
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          cleanup();
          reject(new Error("音频播放失败"));
        };
        audio.play().catch((e: unknown) => {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      current.audio = null;
      URL.revokeObjectURL(audio.src);
      if (current.cancelled) break;
    }

    // 预取的分段可能在手动停止后才返回，这里释放它的 URL。
    next?.then((audio) => URL.revokeObjectURL(audio.src)).catch(() => undefined);
    finish(current);
  } catch (e) {
    finish(current, `在线语音播放失败：${String(e)}`);
  }
}
