import type { ProviderInfo } from "../../types";
import { baiduImageProvider } from "./baidu-image";
import type { ImageTranslationProvider } from "./image-provider";

/** 在此注册所有可用的图片翻译源。 */
export const imageProviders: ImageTranslationProvider[] = [baiduImageProvider];

/** 返回所有图片翻译源的元信息，用于界面展示与凭据读写。 */
export function listImageProviders(): ProviderInfo[] {
  return imageProviders.map((provider) => provider.info);
}

/** 按 ID 查找图片翻译源实现，未找到时返回 undefined。 */
export function findImageProvider(
  id: string,
): ImageTranslationProvider | undefined {
  return imageProviders.find((provider) => provider.info.id === id);
}
