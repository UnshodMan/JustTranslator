import type {
  ImageTranslateRequest,
  ImageTranslateResponse,
  ProviderInfo,
} from "../../types";

/** 图片翻译后端接口，与文本翻译源分开注册。 */
export interface ImageTranslationProvider {
  info: ProviderInfo;
  /**
   * 关联的文本翻译源 ID。该翻译源的凭据会并入 translateImage
   * 收到的 settings（同名时以文本翻译源为准），供共用凭据的
   * 图片翻译源使用，例如与文本翻译共用 AppID 的百度图片翻译。
   */
  credentialsFrom?: string;
  translateImage(
    request: ImageTranslateRequest,
    settings: Record<string, string>,
  ): Promise<ImageTranslateResponse>;
}
