import {
  getConfigFilePath as getConfigPath,
  loadConfig,
  persistConfig,
} from "./services/config";
import {
  readAllCredentials,
  readProviderCredentials,
  syncPlaintextCredentials,
  writeAllCredentials,
} from "./services/credentials";
import {
  speak as speakService,
  stopSpeaking as stopSpeakingService,
} from "./services/speech";
import {
  findProvider,
  listProviders as listProviderInfos,
} from "./services/translator";
import {
  findImageProvider,
  listImageProviders as listImageProviderInfos,
} from "./services/translator/image-index";
import type {
  AppConfig,
  ImageTranslateRequest,
  ImageTranslateResponse,
  ProviderCredentials,
  ProviderInfo,
  TranslateRequest,
  TranslateResponse,
} from "./types";

/** 列出全部已注册翻译源的元信息，供界面展示与语言列表使用。 */
export const listProviders = async (): Promise<ProviderInfo[]> =>
  listProviderInfos();

/** 列出全部已注册图片翻译源的元信息。 */
export const listImageProviders = async (): Promise<ProviderInfo[]> =>
  listImageProviderInfos();

/** 文本与图片翻译源的合集，用于统一读写凭据。 */
function allProviderInfos(): ProviderInfo[] {
  return [...listProviderInfos(), ...listImageProviderInfos()];
}

/** 应用启动时解析出的配置与凭据。 */
export interface AppState {
  config: AppConfig;
  credentials: ProviderCredentials;
  /** 系统钥匙串是否可用；不可用时凭据来自配置文件明文。 */
  keychainAvailable: boolean;
}

/**
 * 读取配置与凭据。优先使用系统钥匙串；钥匙串不可用时
 * 回退到配置文件中的明文凭据。钥匙串恢复可用后会自动
 * 同步明文凭据并清除配置文件中的明文。
 */
export async function loadAppState(): Promise<AppState> {
  const providers = allProviderInfos();
  let config = await loadConfig();
  const plaintext = config.providerSettings;

  let credentials: ProviderCredentials;
  try {
    if (plaintext) {
      await syncPlaintextCredentials(plaintext);
    }
    credentials = await readAllCredentials(providers);
  } catch {
    return {
      config,
      credentials: plaintext ?? {},
      keychainAvailable: false,
    };
  }

  if (plaintext) {
    const { providerSettings: _dropped, ...rest } = config;
    try {
      config = await persistConfig(rest);
    } catch {
      // 钥匙串已可用但配置文件暂时无法改写，保留明文待下次启动清理。
    }
  }
  return { config, credentials, keychainAvailable: true };
}

/** 设置保存结果；钥匙串不可用时配置中会保留明文凭据。 */
export interface SaveSettingsResult {
  config: AppConfig;
  keychainAvailable: boolean;
}

/**
 * 保存设置：把凭据写入系统钥匙串。
 * 钥匙串不可用时降级为配置文件明文，确保翻译功能仍可使用。
 */
export async function saveSettings(
  config: AppConfig,
  credentials: ProviderCredentials,
): Promise<SaveSettingsResult> {
  let keychainAvailable = true;
  try {
    await writeAllCredentials(allProviderInfos(), credentials);
  } catch {
    keychainAvailable = false;
  }

  if (keychainAvailable) {
    const { providerSettings: _dropped, ...rest } = config;
    return { config: await persistConfig(rest), keychainAvailable };
  }
  return {
    config: await persistConfig({ ...config, providerSettings: credentials }),
    keychainAvailable,
  };
}

/** 持久化应用配置。 */
export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  return persistConfig(config);
}

/**
 * 读取某个翻译源的凭据：优先使用钥匙串，钥匙串不可用或
 * 部分字段为空时，用配置文件明文补齐。
 */
async function resolveSettings(
  info: ProviderInfo,
): Promise<Record<string, string>> {
  const config = await loadConfig();
  const settings: Record<string, string> = {
    ...(config.providerSettings?.[info.id] ?? {}),
  };
  try {
    const keychainSettings = await readProviderCredentials(info);
    for (const [key, value] of Object.entries(keychainSettings)) {
      if (value.trim()) settings[key] = value;
    }
  } catch {
    // 钥匙串不可用，直接使用配置文件中的明文凭据。
  }
  return settings;
}

/** 按请求中的翻译源 ID 找到对应实现并执行文本翻译。 */
export async function translate(
  request: TranslateRequest,
): Promise<TranslateResponse> {
  const provider = findProvider(request.provider);
  if (!provider) {
    throw `未知的翻译源：${request.provider}`;
  }
  return provider.translate(request, await resolveSettings(provider.info));
}

/** 按请求中的图片翻译源 ID 找到对应实现并执行图片翻译。 */
export async function translateImage(
  request: ImageTranslateRequest,
): Promise<ImageTranslateResponse> {
  const provider = findImageProvider(request.provider);
  if (!provider) {
    throw `未知的图片翻译源：${request.provider}`;
  }
  const own = await resolveSettings(provider.info);
  // 图片翻译源可与某个文本翻译源共用凭据（如百度图片翻译共用
  // 文本翻译的 AppID）；同名凭据以文本翻译源的设置为准。
  if (provider.credentialsFrom) {
    const source = findProvider(provider.credentialsFrom);
    if (source) {
      Object.assign(own, await resolveSettings(source.info));
    }
  }
  return provider.translateImage(request, own);
}

/** 返回配置文件的完整路径（系统应用配置目录下的 config.json）。 */
export const getConfigFilePath = () => getConfigPath();

export interface SpeakRequest {
  text: string;
  /** 中立语言代码，例如 "en"、"zh"、"zh-Hant"。 */
  lang: string;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** 使用已保存配置中的引擎和语速朗读文本。 */
export async function speak(request: SpeakRequest): Promise<void> {
  const config = await loadConfig();
  speakService({
    ...request,
    engine: config.speechEngine,
    rate: config.speechRate,
  });
}

/** 停止当前正在进行的朗读（若有）。 */
export const stopSpeaking = (): void => stopSpeakingService();
