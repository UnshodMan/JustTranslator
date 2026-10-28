import type {
  ProviderInfo,
  TranslateRequest,
  TranslateResponse,
} from "../../types";

/**
 * 所有翻译后端都实现该接口。新增翻译源只需在本目录下
 * 新建模块，并在 `index.ts` 中注册。
 */
export interface TranslationProvider {
  info: ProviderInfo;
  translate(
    request: TranslateRequest,
    settings: Record<string, string>,
  ): Promise<TranslateResponse>;
}
