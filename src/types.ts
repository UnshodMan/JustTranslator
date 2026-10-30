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

export interface ProviderHelpLink {
  label: string;
  url: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  fields: SettingsField[];
  languages: LanguageInfo[];
  supportsAutoDetect: boolean;
  /** 凭据申请、密钥管理与接口文档链接。 */
  helpLinks?: ProviderHelpLink[];
}

/** 文本朗读引擎：优先使用系统语音，或始终使用在线语音。 */
export type SpeechEngine = "auto" | "system" | "online";

/** 界面主题：明亮、暗黑或跟随系统。 */
export type ThemeMode = "light" | "dark" | "system";

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
  /** 界面主题：明亮、暗黑或跟随系统。 */
  theme: ThemeMode;
  /** 朗读按钮使用的 TTS 引擎："auto" 在没有系统语音时回退到在线语音。 */
  speechEngine: SpeechEngine;
  /** 系统语音的播放速度，范围 0.6 - 1.4。 */
  speechRate: number;
  /** 译文返回后自动朗读。 */
  autoSpeak: boolean;
  /** 图片翻译的源语言。 */
  imageSourceLang: string;
  /** 图片翻译的目标语言。 */
  imageTargetLang: string;
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

/** 图片贴合方式：0 仅返回文本，1 返回整图贴合，2 返回分块贴合，3 仅返回坐标。 */
export type ImagePasteMode = 0 | 1 | 2 | 3;

export interface ImageTranslateRequest {
  provider: string;
  /** 原始图片的 Base64 数据，不带 data URL 前缀。 */
  image: string;
  from: string;
  to: string;
  paste: ImagePasteMode;
  /** 0 通用擦除，1 高精擦除。 */
  viewType: 0 | 1;
}

export interface ImagePoint {
  x: number;
  y: number;
}

export interface ImageSegment {
  src: string;
  dst: string;
  /** 文字区域坐标：left,top,width,height。 */
  rect?: string;
  lineCount?: number;
  points?: ImagePoint[];
  /** 分块贴合的 Base64 图片，仅 paste=2 时返回。 */
  blockImage?: string;
}

export interface ImageTranslateResponse {
  provider: string;
  from: string;
  to: string;
  /** 全文原文。 */
  src: string;
  /** 全文译文。 */
  dst: string;
  segments: ImageSegment[];
  /** 整图贴合的 data URL，仅 paste=1 时返回。 */
  pasteImage?: string;
}
