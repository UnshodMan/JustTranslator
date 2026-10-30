import type {
  ImageTranslateRequest,
  ImageTranslateResponse,
  ProviderInfo,
} from "../../types";

/** 图片翻译后端接口，与文本翻译源分开注册。 */
export interface ImageTranslationProvider {
  info: ProviderInfo;
  translateImage(
    request: ImageTranslateRequest,
    settings: Record<string, string>,
  ): Promise<ImageTranslateResponse>;
}
