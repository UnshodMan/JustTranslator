use keyring::Entry;

/// 钥匙串条目的服务名，与应用的 bundle identifier 保持一致。
const KEYCHAIN_SERVICE: &str = "com.justtranslator.desktop";

/// 读取系统钥匙串中的凭据；条目不存在时返回 null 而不是报错。
#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &account).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取系统钥匙串失败：{error}")),
    }
}

/// 把凭据写入系统钥匙串，已存在的同名条目会被覆盖。
#[tauri::command]
fn keychain_set(account: String, value: String) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &account).map_err(|error| error.to_string())?;
    entry
        .set_password(&value)
        .map_err(|error| format!("写入系统钥匙串失败：{error}"))
}

/// 删除系统钥匙串中的凭据；条目不存在时视为成功。
#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &account).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("删除系统钥匙串凭据失败：{error}")),
    }
}

/// 仅负责 Tauri 启动。所有应用逻辑都位于 TypeScript 前端（`src/`），
/// Rust 侧只保留访问系统钥匙串所需的命令。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            keychain_get,
            keychain_set,
            keychain_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running JustTranslator");
}
