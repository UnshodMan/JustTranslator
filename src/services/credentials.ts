import { invoke } from "@tauri-apps/api/core";
import type { ProviderCredentials, ProviderInfo } from "../types";

/**
 * 系统钥匙串中的条目标识：`<翻译源 ID>.<字段 key>`。
 * 服务名由 Rust 侧固定为应用标识，前端无需关心。
 */
function accountName(providerId: string, fieldKey: string): string {
  return `${providerId}.${fieldKey}`;
}

/** 读取单个凭据；钥匙串中没有该条目时返回空字符串。 */
export async function readCredential(
  providerId: string,
  fieldKey: string,
): Promise<string> {
  const value = await invoke<string | null>("keychain_get", {
    account: accountName(providerId, fieldKey),
  });
  return value ?? "";
}

/** 读取某个翻译源定义的全部凭据字段。 */
export async function readProviderCredentials(
  provider: ProviderInfo,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    provider.fields.map(
      async (field) =>
        [field.key, await readCredential(provider.id, field.key)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** 读取全部已注册翻译源的凭据。 */
export async function readAllCredentials(
  providers: ProviderInfo[],
): Promise<ProviderCredentials> {
  const entries = await Promise.all(
    providers.map(
      async (provider) =>
        [provider.id, await readProviderCredentials(provider)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** 写入单个凭据；空值会从钥匙串中删除对应条目。 */
export async function writeCredential(
  providerId: string,
  fieldKey: string,
  value: string,
): Promise<void> {
  const account = accountName(providerId, fieldKey);
  if (value) {
    await invoke("keychain_set", { account, value });
  } else {
    await invoke("keychain_delete", { account });
  }
}

/**
 * 把界面提交的全部凭据写入系统钥匙串。
 * 只处理翻译源定义中存在的字段，避免脏数据残留。
 */
export async function writeAllCredentials(
  providers: ProviderInfo[],
  credentials: ProviderCredentials,
): Promise<void> {
  for (const provider of providers) {
    const values = credentials[provider.id] ?? {};
    for (const field of provider.fields) {
      await writeCredential(provider.id, field.key, values[field.key] ?? "");
    }
  }
}

/**
 * 把配置文件中的明文凭据同步到系统钥匙串。
 * 明文是钥匙串不可用期间的最新数据，因此会覆盖已有条目，
 * 空值则删除钥匙串中的旧条目。
 */
export async function syncPlaintextCredentials(
  plaintext: ProviderCredentials,
): Promise<void> {
  for (const [providerId, values] of Object.entries(plaintext)) {
    for (const [fieldKey, value] of Object.entries(values ?? {})) {
      await writeCredential(providerId, fieldKey, value ?? "");
    }
  }
}
