export interface LanguageInfo {
  code: string;
  label: string;
}

export interface SettingsField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  fields: SettingsField[];
  languages: LanguageInfo[];
  supportsAutoDetect: boolean;
}

/** 文本朗读引擎：优先使用系统语音，或始终使用在线语音。 */
export type SpeechEngine = "auto" | "system" | "online";

/** 各翻译源的凭据，结构为 `翻译源 ID -> 字段 key -> 值`。 */
export type ProviderCredentials = Record<string, Record<string, string>>;

export interface AppConfig {
  activeProvider: string;
  sourceLang: string;
  targetLang: string;
  /** 根据输入内容选择翻译方向：中英文互译，其他语言交给翻译源自动检测。 */
  autoDirection: boolean;
  /** 输入停止后自动触发翻译。 */
  autoTranslate: boolean;
  /** 朗读按钮使用的 TTS 引擎："auto" 在没有系统语音时回退到在线语音。 */
  speechEngine: SpeechEngine;
  /** 系统语音的播放速度，范围 0.6 - 1.4。 */
  speechRate: number;
  /** 译文返回后自动朗读。 */
  autoSpeak: boolean;
  /**
   * 系统钥匙串不可用时，退化为明文保存在配置文件中的凭据。
   * 钥匙串可用时该字段不会出现在配置文件中。
   */
  providerSettings?: ProviderCredentials;
}

export interface Segment {
  src: string;
  dst: string;
}

export interface TranslateRequest {
  provider: string;
  text: string;
  from: string;
  to: string;
}

export interface TranslateResponse {
  provider: string;
  from: string;
  to: string;
  text: string;
  segments: Segment[];
}
