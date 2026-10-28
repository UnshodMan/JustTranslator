import type { ProviderInfo } from "../../types";
import { baiduProvider } from "./baidu";
import { googleProvider } from "./google";
import { microsoftProvider } from "./microsoft";
import type { TranslationProvider } from "./provider";

/** 在此注册所有可用的翻译源。 */
export const providers: TranslationProvider[] = [
  baiduProvider,
  googleProvider,
  microsoftProvider,
];

/** 返回所有翻译源的元信息，用于界面展示。 */
export function listProviders(): ProviderInfo[] {
  return providers.map((provider) => provider.info);
}

/** 按 ID 查找翻译源实现，未找到时返回 undefined。 */
export function findProvider(id: string): TranslationProvider | undefined {
  return providers.find((provider) => provider.info.id === id);
}
