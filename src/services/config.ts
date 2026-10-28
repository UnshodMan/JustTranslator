import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { AppConfig } from "../types";

/** 持久化的应用设置。凭据优先保存在系统钥匙串中。 */
export const DEFAULT_CONFIG: AppConfig = {
  activeProvider: "baidu",
  sourceLang: "auto",
  targetLang: "zh",
  autoDirection: true,
  autoTranslate: true,
  speechEngine: "auto",
  speechRate: 1.0,
  autoSpeak: false,
};

let configPath: Promise<string> | null = null;

/** 解析配置文件路径并缓存；失败时清空缓存以便下次重试。 */
export function getConfigFilePath(): Promise<string> {
  if (!configPath) {
    configPath = appConfigDir()
      .then((dir) => join(dir, "config.json"))
      .catch((e) => {
        configPath = null;
        throw e;
      });
  }
  return configPath;
}

/**
 * 文件缺失或无法读取时直接回退到默认值，因此全新安装
 * 无需任何初始化步骤即可使用。配置文件中的凭据可能是
 * 钥匙串不可用时的明文降级数据，由上层决定是否迁移。
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const path = await getConfigFilePath();
    if (!(await exists(path))) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 将配置写入配置文件，必要时先创建配置目录。 */
export async function persistConfig(config: AppConfig): Promise<AppConfig> {
  const path = await getConfigFilePath();
  const dir = await appConfigDir();

  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    throw `创建配置目录失败：${String(e)}`;
  }

  try {
    await writeTextFile(path, JSON.stringify(config, null, 2));
  } catch (e) {
    throw `写入配置文件失败：${String(e)}`;
  }

  return config;
}
